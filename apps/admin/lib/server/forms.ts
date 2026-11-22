import { cache } from "react";

import type {
  InstanceOutcome,
  PreviewOutcome,
  PreviewReason,
  PreviewRoster,
} from "../forms/builder-state.ts";
import { parseIssues } from "../forms/issues.ts";
import { messageForFormCode } from "../forms/errors.ts";
import { parseContrastFailures, type ContrastFailureView } from "../forms/appearance-report.ts";
import { parseDraftAppearance } from "../forms/preview-appearance.ts";
import { readDraftRules, readDraftSteps } from "../forms/draft-payload.ts";
import { FORM_AVAILABILITIES } from "../forms/types.ts";
import type {
  CompiledStep,
  DraftForm,
  DraftPreview,
  FormAvailability,
  FormDetail,
  FormPublishingWorkflow,
  FormIssue,
  FormListItem,
  FormSettings,
  FormSort,
  FormVersionSnapshot,
  FormVersionSummary,
  PinnableQuestion,
} from "../forms/types.ts";
import type { QuestionListItem } from "../questions/types.ts";

import { proposalHeaders, type AgentProposalRef } from "./agent-proposal.ts";
import { adminApiFetch } from "./api.ts";
import type { AssistConversationRelay, AssistParamsRelay } from "./assist-request.ts";
import type { ApiResult } from "./api-result.ts";
import { HELD, readResult as read } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Read API payloads for presentation without validating domain legality. Preserve unfamiliar issue codes so newer API verdicts remain visible. */

export type { ApiResult };

/** Pass filters and ordering to the API; local filtering would be wrong once the list spans responses. */
export async function listForms(
  session: AdminSession,
  filters: {
    readonly status?: FormAvailability;
    readonly search?: string;
    readonly sort?: FormSort;
    /** The current workspace: a form never belongs to two, so one list never spans two. */
    readonly workspaceId?: string;
  } = {},
): Promise<ApiResult<readonly FormListItem[]>> {
  const query = new URLSearchParams();
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.workspaceId !== undefined) query.set("workspaceId", filters.workspaceId);
  if (filters.search !== undefined && filters.search.trim() !== "") {
    query.set("search", filters.search.trim());
  }
  if (filters.sort !== undefined) query.set("sort", filters.sort);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const result = await read<{ forms: FormListItem[] }>(
    await adminApiFetch(session, `/forms${suffix}`),
  );
  return result.ok ? { ok: true, data: result.data.forms } : result;
}

/** Use a separate unfiltered reader because React cache keys filter objects by identity. Page and rail share this request-only read. */
export const listAllForms: (
  session: AdminSession,
  workspaceId?: string,
) => Promise<ApiResult<readonly FormListItem[]>> = cache(
  async (
    session: AdminSession,
    workspaceId?: string,
  ): Promise<ApiResult<readonly FormListItem[]>> =>
    listForms(session, workspaceId === undefined ? {} : { workspaceId }),
);

export async function createForm(
  session: AdminSession,
  body: {
    readonly formId: string;
    readonly slug: string;
    readonly defaultLocale: string;
    readonly title?: string;
    readonly workspaceId?: string;
  },
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ readonly formId: string }>> {
  return read<{ formId: string }>(
    await adminApiFetch(session, "/forms", {
      method: "POST",
      body,
      headers: proposalHeaders(proposal),
    }),
  );
}

// An unreadable reading falls back to open rather than unreleased: unreleased hides both
// acts, and the API refuses a close it cannot perform anyway.
function parseAvailability(raw: unknown): FormAvailability {
  return FORM_AVAILABILITIES.find((value) => value === raw) ?? "open";
}

/** False challengeEnforceable warns instead of promising protection the API did not report. React cache is request-only and depends on callers sharing the memoized session object. */
export const getForm: (session: AdminSession, formId: string) => Promise<ApiResult<FormDetail>> =
  cache(async (session: AdminSession, formId: string): Promise<ApiResult<FormDetail>> => {
    const result = await read<Record<string, unknown>>(
      await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}`),
    );
    if (!result.ok) return result;
    const raw = result.data;
    const defaultLocale = asString(raw["defaultLocale"], "en");
    return {
      ok: true,
      data: {
        formId: asString(raw["formId"], formId),
        slug: asString(raw["slug"], formId),
        workspaceId: asString(raw["workspaceId"], ""),
        defaultLocale,
        status: parseAvailability(raw["status"]),
        draft: parseDraft(raw["draft"], formId, defaultLocale),
        draftSource: parseDraftSource(raw["draftSource"]),
        releasedDefinition: parseDraft(raw["releasedDefinition"], formId, defaultLocale),
        versions: parseVersions(raw["versions"]),
        settings: parseSettings(raw["settings"]),
        challengeEnforceable: raw["challengeEnforceable"] === true,
        /** Absent provenance must not claim an API disclosure the response never made. */
        draftAgentAssisted: raw["draftAgentAssisted"] === true,
        draftUpdatedAt: typeof raw["draftUpdatedAt"] === "string" ? raw["draftUpdatedAt"] : null,
        /** Absent two-person enforcement must not promise protection the API did not report. */
        requiresSecondApprover: raw["requiresSecondApprover"] === true,

        canWriteDraft: raw["canWriteDraft"] === true,
        appearance: parseDraftAppearance(raw["appearance"]),
        appearanceLocked: raw["appearanceLocked"] === true,
        ...readWorkflow(raw["workflow"]),
      },
    };
  });

export const AGENT_ACCEPT_HEADER = "x-qcms-agent-accept";

export const AGENT_ADOPT_HEADER = "x-qcms-agent-adopt";

/** The docked assistant's accepted proposal: the token its apply-draft step carried and the questions it invents. */
export interface AgentAccept {
  readonly token: string;
  readonly newQuestions: readonly unknown[];
}

/**
 * A proposal the accept route refused, which the user chose to keep as their own edit: the same
 * token on a plain save, where it records the attribution and creates no question.
 */
export interface AgentAdopt {
  readonly token: string;
}

/**
 * An accepted proposal goes through the accept route under its token, which writes its audit row
 * and creates any new questions in the same transaction; every other save is a plain PUT.
 */
export async function saveDraft(
  session: AdminSession,
  formId: string,
  definition: DraftForm,
  accept?: AgentAccept,
  proposal?: AgentProposalRef,
  adopt?: AgentAdopt,
): Promise<
  ApiResult<{
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
    readonly agentAssisted: boolean;
    readonly updatedAt: string;
  }>
> {
  const draftPath = `/forms/${encodeURIComponent(formId)}/draft` as const;

  const result = await read<{
    issues?: unknown;
    warnings?: unknown;
    agentAssisted?: unknown;
    updatedAt?: unknown;
  }>(
    accept !== undefined
      ? await adminApiFetch(session, `${draftPath}/assist/accept`, {
          method: "POST",
          headers: { [AGENT_ACCEPT_HEADER]: accept.token },
          body: {
            definition,
            newQuestions: accept.newQuestions.map((question) => ({ definition: question })),
          },
        })
      : await adminApiFetch(session, draftPath, {
          method: "PUT",
          headers: {
            ...proposalHeaders(proposal),
            ...(adopt === undefined ? {} : { [AGENT_ADOPT_HEADER]: adopt.token }),
          },
          body: { definition },
        }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      issues: parseIssues(result.data.issues),
      warnings: parseIssues(result.data.warnings),
      agentAssisted: result.data.agentAssisted === true,
      updatedAt: asString(result.data.updatedAt, ""),
    },
  };
}

export type AppearanceSaveResult =
  | { readonly ok: true; readonly updatedAt: string; readonly held?: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      /** 107's correction report, which the shared reader drops because no other refusal carries it. */
      readonly failures: readonly ContrastFailureView[];
    };

/**
 * An appearance change, sent on the one draft save path with the definition the screen holds,
 * so it takes one revision like any other edit. The envelope is read here rather than through
 * the shared reader, which keeps no detail beyond the issue list.
 */
export async function saveDraftAppearance(
  session: AdminSession,
  formId: string,
  definition: DraftForm,
  appearance: unknown,
): Promise<AppearanceSaveResult> {
  const response = await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft`, {
    method: "PUT",
    body: { definition, appearance },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    return {
      ok: true,
      updatedAt: asString((body as { updatedAt?: unknown })?.updatedAt, ""),
      ...(response.status === HELD ? { held: true as const } : {}),
    };
  }
  const envelope = (body as { error?: { code?: unknown; details?: unknown } } | undefined)?.error;
  const code =
    typeof envelope?.code === "string" ? envelope.code : `http_${String(response.status)}`;
  return {
    ok: false,
    code,
    message: messageForFormCode(code),
    failures: parseContrastFailures(envelope?.details),
  };
}

export const AGENT_EDIT_HEADER = "x-qcms-agent-edit";

/**
 * One card-less builder edit or its Undo. The definition is sent exactly as the turn produced
 * it: the token binds that post-state, so any normalising here would be refused.
 */
export async function applyAgentEdit(
  session: AdminSession,
  formId: string,
  definition: unknown,
  token: string,
): Promise<ApiResult<{ readonly updatedAt: string; readonly undoToken: string | null }>> {
  const result = await read<{ updatedAt?: unknown; agentEdit?: { undoToken?: unknown } }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft`, {
      method: "PUT",
      headers: { [AGENT_EDIT_HEADER]: token },
      body: { definition },
    }),
  );
  if (!result.ok) return result;
  const undoToken = result.data.agentEdit?.undoToken;
  return {
    ok: true,
    data: {
      updatedAt: asString(result.data.updatedAt, ""),
      undoToken: typeof undoToken === "string" && undoToken !== "" ? undoToken : null,
    },
  };
}

/** The open draft's definition exactly as stored, which an Undo of a turn's first edit restores. */
export async function readStoredDraft(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<unknown>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}`),
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data["draft"] ?? null };
}

export interface AgentChange {
  readonly kind: string;
  readonly revision: number | null;
  readonly confirmedAt: string;
}

/** What the publish wizard compares: the newest publish against the draft, and the assistant's steps since. */
export interface AgentChanges {
  readonly base: DraftForm | null;
  readonly draft: DraftForm | null;
  readonly agentAssisted: boolean;
  readonly changes: readonly AgentChange[];
}

export async function getAgentChanges(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<AgentChanges>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/agent-changes`),
  );
  if (!result.ok) return result;
  const raw = result.data;
  const definitionOf = (side: unknown): DraftForm | null => {
    if (typeof side !== "object" || side === null) return null;
    const draft = parseDraft((side as Record<string, unknown>)["definition"], formId, "en");
    return draft ?? null;
  };
  const changes = Array.isArray(raw["changes"]) ? raw["changes"] : [];
  return {
    ok: true,
    data: {
      base: definitionOf(raw["base"]),
      draft: definitionOf(raw["draft"]),
      agentAssisted: raw["agentAssisted"] === true,
      changes: changes.flatMap((entry): AgentChange[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const change = entry as Record<string, unknown>;
        const kind = change["kind"];
        const revision = change["revision"];
        if (typeof kind !== "string" || kind === "") return [];
        return [
          {
            kind,
            revision: typeof revision === "number" && Number.isInteger(revision) ? revision : null,
            confirmedAt: asString(change["confirmedAt"], ""),
          },
        ];
      }),
    },
  };
}

/** Relay the raw SSE response without buffering; parsing and diffing happen in the browser. */
export function assist(
  session: AdminSession,
  formId: string,
  body: {
    readonly conversation: readonly AssistConversationRelay[];
    readonly clientState?: string;
    readonly screen?: string;
    readonly params?: AssistParamsRelay;
    readonly conversationId?: string;
    readonly visitId?: string;
    readonly viewerToday?: string;
  },
): Promise<Response> {
  return adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/assist`, {
    method: "POST",
    body,
  });
}

/** Send route IDs and conversation ID, never context content; the API builds facts under the caller grants. */
export function screenAssist(
  session: AdminSession,
  body: {
    readonly conversation: readonly AssistConversationRelay[];
    readonly screen: string;
    readonly params?: AssistParamsRelay;
    readonly conversationId: string;
    readonly visitId?: string;
    readonly viewerToday?: string;
  },
): Promise<Response> {
  return adminApiFetch(session, "/assist", { method: "POST", body });
}

export async function validateDraft(
  session: AdminSession,
  formId: string,
  definition: DraftForm,
): Promise<
  ApiResult<{
    readonly valid: boolean;
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
  }>
> {
  const result = await read<{ valid?: unknown; issues?: unknown; warnings?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/validate`, {
      method: "POST",
      body: { definition },
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      valid: result.data.valid === true,
      issues: parseIssues(result.data.issues),

      warnings: parseIssues(result.data.warnings),
    },
  };
}

/** Null resets minSubmitMs to the deployment floor; omission leaves it unchanged. Send only touched settings because the API rejects an empty patch. */
export async function updateSettings(
  session: AdminSession,
  formId: string,
  patch: { readonly challengeRequired?: boolean; readonly minSubmitMs?: number | null },
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ readonly settings: FormSettings; readonly challengeEnforceable: boolean }>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/settings`, {
      method: "PATCH",
      body: patch,
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      settings: parseSettings(result.data["settings"]),
      challengeEnforceable: result.data["challengeEnforceable"] === true,
    },
  };
}

/** Send the unsaved draft so the bench answers the visible edit. Hypothetical answers must never be logged, stored or echoed here. */
export async function previewCondition(
  session: AdminSession,
  formId: string,
  request: {
    readonly definition: DraftForm;
    readonly ruleId: string;
    readonly answers: Readonly<Record<string, unknown>>;
    /** Preview has no session roster; mint hypothetical instance IDs and qualify this request answer keys with them. */
    readonly instances?: Readonly<Record<string, readonly string[]>>;
  },
): Promise<
  ApiResult<{
    readonly outcome: PreviewOutcome;
    readonly reason: PreviewReason | undefined;
    readonly references: readonly string[];
    readonly rosters: readonly PreviewRoster[];
    readonly targetGroupId: string | undefined;
    readonly instanceOutcomes: readonly InstanceOutcome[] | undefined;
  }>
> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/preview-condition`, {
      method: "POST",
      body: request,
    }),
  );
  if (!result.ok) return result;
  const targetGroupId = result.data["targetGroupId"];
  return {
    ok: true,
    data: {
      outcome: parseOutcome(result.data["outcome"]),
      reason: parseReason(result.data["reason"]),
      references: asStringList(result.data["references"]),
      rosters: parseRosters(result.data["rosters"]),
      targetGroupId: typeof targetGroupId === "string" ? targetGroupId : undefined,
      /** Undefined means not per-instance; an empty list means a per-instance rule over zero instances. Keep those outcomes distinct. */
      instanceOutcomes: parseInstanceOutcomes(result.data["instanceOutcomes"]),
    },
  };
}

function parseRosters(raw: unknown): readonly PreviewRoster[] {
  if (!Array.isArray(raw)) return [];
  const parsed: PreviewRoster[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as { groupId?: unknown; instances?: unknown };
    if (typeof row.groupId !== "string") continue;
    parsed.push({ groupId: row.groupId, instances: asStringList(row.instances) });
  }
  return parsed;
}

function parseInstanceOutcomes(raw: unknown): readonly InstanceOutcome[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: InstanceOutcome[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as { instanceId?: unknown; outcome?: unknown };
    if (typeof row.instanceId !== "string") continue;
    parsed.push({
      instanceId: row.instanceId,
      outcome: row.outcome === "match" ? "match" : "noMatch",
    });
  }
  return parsed;
}

/** Preview the unsaved edit; walk-through answers are forwarded only, never logged, stored or echoed here. */
export async function previewDraft(
  session: AdminSession,
  formId: string,
  request: {
    readonly definition: DraftForm;
    readonly answers: Readonly<Record<string, unknown>>;
    /** Preview has no session roster; mint hypothetical instance IDs from each group count and qualify answers with them. */
    readonly instances?: Readonly<Record<string, readonly string[]>>;
  },
): Promise<ApiResult<DraftPreview>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/preview`, {
      method: "POST",
      body: request,
    }),
  );
  if (!result.ok) return result;
  const raw = result.data;
  const flow = (raw["flow"] ?? {}) as Record<string, unknown>;
  const views = parseStepViews(flow["visibleStepViews"]);
  return {
    ok: true,
    data: {
      documents: parseCompiledSteps(raw["documents"]),
      compilerVersion: asString(raw["compilerVersion"], ""),
      a2uiSpecVersion: asString(raw["a2uiSpecVersion"], ""),
      flow: {
        visibleSteps: asStringList(flow["visibleSteps"]),
        visibleQuestions: asStringList(flow["visibleQuestions"]),
        complete: flow["complete"] === true,
        rosters: parseRosters(flow["rosters"]),
        ...(views === undefined ? {} : { visibleStepViews: views }),
      },
    },
  };
}

/** Absent views means walk visible steps; empty views means no pages. Preserve the distinction for non-repeating drafts. */
function parseStepViews(
  raw: unknown,
): readonly { readonly stepId: string; readonly instanceId: string | null }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: { stepId: string; instanceId: string | null }[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as { stepId?: unknown; instanceId?: unknown };
    if (typeof row.stepId !== "string") continue;
    if (typeof row.instanceId !== "string" && row.instanceId !== null) continue;
    parsed.push({ stepId: row.stepId, instanceId: row.instanceId });
  }
  return parsed;
}

/** Render stored compiled snapshots, never a fresh draft compilation: history must show what respondents saw. */
export async function getFormVersion(
  session: AdminSession,
  formId: string,
  version: number,
): Promise<ApiResult<FormVersionSnapshot>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(String(version))}`,
    ),
  );
  if (!result.ok) return result;
  const raw = result.data;
  const compiled = (raw["compiled"] ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      formId: asString(raw["formId"], formId),
      version: typeof raw["version"] === "number" ? raw["version"] : version,
      publishedAt: asString(raw["publishedAt"], ""),
      compilerVersion: asString(raw["compilerVersion"], ""),
      a2uiSpecVersion: asString(raw["a2uiSpecVersion"], ""),
      semanticsVersion: asString(raw["semanticsVersion"], ""),
      definition: raw["definition"],
      documents: parseCompiledSteps(compiled["documents"]),
    },
  };
}

/** Closing affects new sessions only in the explicit body environment. Existing sessions remain pinned; never inherit this consequential target only from a switcher header. */
export async function setFormStatus(
  session: AdminSession,
  formId: string,
  action: "close" | "reopen",
  environment: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ readonly status: "open" | "closed"; readonly environment: string }>> {
  const result = await read<{ status?: unknown; environment?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/${action}`, {
      method: "POST",
      body: { environment },
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      status: result.data.status === "closed" ? "closed" : "open",
      environment:
        typeof result.data.environment === "string" ? result.data.environment : environment,
    },
  };
}

/**
 * Ask for versions=all in one read: a newer draft must not hide an older published,
 * pinnable version. Drop unreadable entries rather than failing a usable library.
 *
 * Scoped to the form's own workspace plus the shared library, which is exactly what may
 * be pinned here (ADR-41); the API re-decides every pin at save and publish.
 */
export async function loadPinnableQuestions(
  session: AdminSession,
  workspaceId?: string,
): Promise<ApiResult<readonly PinnableQuestion[]>> {
  const query = new URLSearchParams({ versions: "all" });
  if (workspaceId !== undefined) {
    query.set("workspaceId", workspaceId);
    query.set("shared", "include");
  }
  const list = await read<{ questions: QuestionListItem[] }>(
    await adminApiFetch(session, `/questions?${query.toString()}`),
  );
  if (!list.ok) return list;

  const pinnable: PinnableQuestion[] = [];
  for (const question of list.data.questions) {
    const versions = question.versions;
    if (versions === undefined) continue;
    pinnable.push({
      questionId: question.questionId,
      slug: question.slug,
      shared: workspaceId !== undefined && question.workspaceId !== workspaceId,
      label: question.label,
      type: question.type,
      versions: versions.map((version) => ({
        version: version.version,
        status: version.status,
        definition: version.definition,
      })),
    });
  }
  return { ok: true, data: pinnable };
}

function asString(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw !== "" ? raw : fallback;
}

function asStringList(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseDraftSource(raw: unknown): FormDetail["draftSource"] {
  return raw === "open" || raw === "seeded" ? raw : "none";
}

function parseSettings(raw: unknown): FormSettings {
  const source = (raw ?? {}) as { challengeRequired?: unknown; minSubmitMs?: unknown };
  return {
    challengeRequired: source.challengeRequired === true,
    minSubmitMs: typeof source.minSubmitMs === "number" ? source.minSubmitMs : null,
  };
}

function parseOutcome(raw: unknown): PreviewOutcome {
  return raw === "match" || raw === "noMatch" ? raw : "unavailable";
}

const PREVIEW_REASONS: readonly PreviewReason[] = [
  "unparseableDraft",
  "ruleNotFound",
  "noTarget",
  "unresolvedAnswers",
];

function parseReason(raw: unknown): PreviewReason | undefined {
  return PREVIEW_REASONS.find((reason) => reason === raw);
}

function objectsWith(raw: unknown, key: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .filter((entry) => entry[key] !== undefined);
}

/** Carry A2UI roots untouched: only the renderer registry knows their meaning. Drop documents with no stepId. */
function parseCompiledSteps(raw: unknown): readonly CompiledStep[] {
  return objectsWith(raw, "stepId")
    .filter((entry) => typeof entry["stepId"] === "string")
    .map((entry) => ({ stepId: entry["stepId"] as string, root: entry["root"] }));
}

function parseVersions(raw: unknown): readonly FormVersionSummary[] {
  return objectsWith(raw, "version")
    .filter((entry) => typeof entry["version"] === "number")
    .map((entry) => ({
      version: entry["version"] as number,
      publishedAt: asString(entry["publishedAt"], ""),
      compilerVersion: asString(entry["compilerVersion"], ""),
      a2uiSpecVersion: asString(entry["a2uiSpecVersion"], ""),
      semanticsVersion: asString(entry["semanticsVersion"], ""),
      /** Null preserves unknown author identity; empty text would claim nobody authored it. */
      publishedBy: typeof entry["publishedBy"] === "string" ? entry["publishedBy"] : null,
    }));
}

/** Share the draft reader with assist parsing so repeating groups cannot drift between views. Route identity stays authoritative; unreadable working content degrades to an empty draft. */
function parseDraft(raw: unknown, formId: string, defaultLocale: string): DraftForm | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  return {
    formId: asString(source["formId"], formId),
    defaultLocale: asString(source["defaultLocale"], defaultLocale),
    title: (source["title"] ?? {}) as DraftForm["title"],
    steps: readDraftSteps(source["steps"]),
    rules: readDraftRules(source["rules"]),
  };
}

function readWorkflow(raw: unknown): { workflow?: FormPublishingWorkflow } {
  if (raw === null || typeof raw !== "object") return {};
  const row = raw as Record<string, unknown>;
  return {
    workflow: {
      enabled: row["enabled"] === true,
      environment: typeof row["environment"] === "string" ? row["environment"] : "",
      canEdit: row["canEdit"] === true,
      canPublish: row["canPublish"] === true,
      canRelease: row["canRelease"] === true,
      eligibleVersions: Array.isArray(row["eligibleVersions"])
        ? row["eligibleVersions"].filter((v): v is number => typeof v === "number")
        : [],
      preferredVersion:
        typeof row["preferredVersion"] === "number" ? row["preferredVersion"] : null,
      currentVersion: typeof row["currentVersion"] === "number" ? row["currentVersion"] : null,
    },
  };
}
