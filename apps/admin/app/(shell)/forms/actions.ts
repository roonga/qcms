"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type {
  CreateFormCardState,
  CreateFormState,
  DraftPreviewState,
  FormStatusState,
  MintLinksState,
  PreviewConditionState,
  PublishBatchState,
  ReleaseState,
  RevokeLinkState,
  SaveDraftState,
  SettingsState,
  ValidateDraftState,
} from "@/lib/forms/builder-state";
import { formIdFromSlug } from "@/lib/forms/draft";
import { t } from "@/lib/i18n/en";
import { messageForFormCode } from "@/lib/forms/errors";
import { readState, type ReadState } from "@/lib/read-state";
import type {
  PublishDestination,
  PublishIntent,
  ReleaseReview,
} from "@/lib/forms/release-candidate";
import type { DraftForm, FormIssue, FormVersionSnapshot } from "@/lib/forms/types";
import {
  createForm,
  getFormVersion,
  previewCondition,
  previewDraft,
  saveDraft,
  setFormStatus,
  updateSettings,
  validateDraft,
} from "@/lib/server/forms";
import { MAX_LINK_BATCH, mintLinks, revokeLink } from "@/lib/server/links";
import type { AgentProposalRef } from "@/lib/server/agent-proposal";
import type { BatchOutcome } from "@/lib/server/releases";
import {
  lookupReleaseBatch,
  publishBatch,
  releaseBatch,
  releaseVersion,
  reviewRelease,
} from "@/lib/server/releases";
import { confirmShownEnvironment } from "@/lib/server/environments";
import { requireAdminSession, type AdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

/* Every action authenticates independently: layouts do not run for action POSTs. Bound environment values
   can only cause refusal, not grant authority. */

const MAX_DEFINITION_BYTES = 64 * 1024;

const MALFORMED_CODE = "INVALID_FORM_DEFINITION";

/* React has already deserialized the input; this cap bounds outgoing UTF-8 bytes, not received bytes or
   UTF-16 code units. */
function withinCap(document: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(document), "utf8") <= MAX_DEFINITION_BYTES;
  } catch {
    return false;
  }
}

function readText(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
}

/* The create endpoint accepts identity only; the title seeds the builder draft and is stored by its first
   autosave. */
export async function createFormAction(
  _previous: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const session = await requireAdminSession();
  const slug = readText(formData, "slug").trim();
  const title = readText(formData, "title").trim();
  const defaultLocale = readText(formData, "defaultLocale").trim();
  // Name the workspace the author is in: with more than one the API refuses to guess.
  const workspaceId = await currentWorkspaceId(session);
  const created = await createFormIdentity(session, {
    slug,
    defaultLocale,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
  if (!created.ok) {
    return {
      status: "error",
      code: created.code,
      message: created.message,
      submitted: { slug, title, defaultLocale },
    };
  }
  // redirect throws; keep it outside catches that would swallow navigation.
  redirect(`/forms/${encodeURIComponent(created.formId)}?title=${encodeURIComponent(title)}`);
}

export async function createFormForCardAction(
  input: { readonly slug: string; readonly defaultLocale: string; readonly workspaceId?: string },
  proposal?: AgentProposalRef,
): Promise<CreateFormCardState> {
  const session = await requireAdminSession();
  const slug = input.slug.trim();
  const created = await createFormIdentity(
    session,
    {
      slug,
      defaultLocale: input.defaultLocale.trim(),
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    },
    proposal,
  );
  if (!created.ok) return { status: "error", message: created.message };
  return { status: "created", formId: created.formId, slug };
}

type CreatedForm =
  | { readonly ok: true; readonly formId: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/* Derive the id from the slug here, so a proposal digest need bind only the slug. */
async function createFormIdentity(
  session: AdminSession,
  input: { readonly slug: string; readonly defaultLocale: string; readonly workspaceId?: string },
  proposal?: AgentProposalRef,
): Promise<CreatedForm> {
  const formId = formIdFromSlug(input.slug);

  if (formId === "") {
    return {
      ok: false,
      code: "INVALID_FORM_ID",
      message: messageForFormCode("INVALID_FORM_ID"),
    };
  }
  if (input.defaultLocale === "") {
    return {
      ok: false,
      code: "INVALID_DEFAULT_LOCALE",
      message: messageForFormCode("INVALID_DEFAULT_LOCALE"),
    };
  }

  const result = await createForm(
    session,
    {
      formId,
      slug: input.slug,
      defaultLocale: input.defaultLocale,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    },
    proposal,
  );
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  revalidatePath("/forms");
  return { ok: true, formId: result.data.formId };
}

/* Draft inconsistencies are advisory, but rejected proposed questions fail the whole save to prevent
   dangling pins. */
export async function saveDraftAction(
  formId: string,
  draft: DraftForm,
  agentAssisted?: boolean,
  newQuestions?: readonly unknown[],
  proposal?: AgentProposalRef,
): Promise<SaveDraftState> {
  const session = await requireAdminSession();
  if (!withinCap(draft)) {
    return {
      status: "error",
      issues: [],
      warnings: [],
      code: MALFORMED_CODE,
      message: messageForFormCode(MALFORMED_CODE),
    };
  }

  const result = await saveDraft(session, formId, draft, agentAssisted, newQuestions, proposal);
  if (!result.ok) {
    return {
      status: "error",
      issues: result.issues,
      warnings: [],
      code: result.code,
      message: result.message,
    };
  }
  revalidatePath("/forms");
  // Invalidate the layout: both the builder and rules route render this draft, and page invalidation misses
  // the sibling.
  revalidatePath(`/forms/${formId}`, "layout");
  return {
    status: "saved",
    issues: result.data.issues,
    warnings: result.data.warnings,
    agentAssisted: result.data.agentAssisted,
    updatedAt: result.data.updatedAt,
  };
}

export async function validateDraftAction(
  formId: string,
  draft: DraftForm,
): Promise<ValidateDraftState> {
  const session = await requireAdminSession();
  if (!withinCap(draft)) {
    return {
      status: "error",
      valid: false,
      issues: [],
      warnings: [],
      message: messageForFormCode(MALFORMED_CODE),
    };
  }

  const result = await validateDraft(session, formId, draft);
  if (!result.ok) {
    return {
      status: "error",
      valid: false,
      issues: result.issues,
      warnings: [],
      message: result.message,
    };
  }
  return {
    status: "ok",
    valid: result.data.valid,
    issues: result.data.issues,
    warnings: result.data.warnings,
  };
}

interface SettingsPatch {
  readonly challengeRequired?: boolean;
  readonly minSubmitMs?: number | null;
}

/* Preserve null as a value and omit untouched keys; the API refuses an empty patch. */
export async function updateSettingsAction(
  formId: string,
  patch: SettingsPatch,
  proposal?: AgentProposalRef,
): Promise<SettingsState> {
  const session = await requireAdminSession();
  const outgoing: SettingsPatch = {
    ...(patch.challengeRequired === undefined
      ? {}
      : { challengeRequired: patch.challengeRequired }),
    ...(patch.minSubmitMs === undefined ? {} : { minSubmitMs: patch.minSubmitMs }),
  };
  if (Object.keys(outgoing).length === 0) {
    return { status: "error", message: messageForFormCode("INVALID_FORM_SETTINGS") };
  }

  const result = await updateSettings(session, formId, outgoing, proposal);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/forms/${formId}`);
  return {
    status: "saved",
    settings: result.data.settings,
    challengeEnforceable: result.data.challengeEnforceable,
  };
}

interface PreviewRequest {
  readonly draft: DraftForm;
  readonly ruleId: string;
  readonly answers: Readonly<Record<string, unknown>>;
  /* Roster ids must match this request's instance-qualified answer keys. */
  readonly instances: Readonly<Record<string, readonly string[]>>;
}

/* Hypothetical answers must never be logged, stored, or echoed in failure messages. */
export async function previewConditionAction(
  formId: string,
  input: PreviewRequest,
): Promise<PreviewConditionState> {
  const session = await requireAdminSession();
  if (!withinCap(input)) {
    return { status: "error", message: messageForFormCode(MALFORMED_CODE) };
  }

  const result = await previewCondition(session, formId, {
    definition: input.draft,
    ruleId: input.ruleId,
    answers: input.answers,
    instances: input.instances,
  });
  if (!result.ok) return { status: "error", message: result.message };
  const { outcome, reason, references, rosters, targetGroupId, instanceOutcomes } = result.data;
  // Absence means a non-instance rule; an empty instanceOutcomes array means a per-instance rule over an
  // empty group.
  return {
    status: "ok",
    outcome,
    references,
    rosters,
    ...(reason === undefined ? {} : { reason }),
    ...(targetGroupId === undefined ? {} : { targetGroupId }),
    ...(instanceOutcomes === undefined ? {} : { instanceOutcomes }),
  };
}

/* The dialog chooses the release destination; confirming against the switcher would incorrectly forbid
   promotion. */
export async function reviewFormVersionAction(
  formId: string,
  shown: string | undefined,
  version: number,
): Promise<ReadState<FormVersionSnapshot>> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { ok: false };
  return readState(await getFormVersion(session, formId, version));
}

export async function releaseVersionAction(
  formId: string,
  shown: string | undefined,
  input: {
    readonly version: number;
    readonly fromEnvironment?: string;
    readonly environment?: string;
  },
  proposal?: AgentProposalRef,
): Promise<ReleaseState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await releaseVersion(
    session,
    formId,
    {
      version: input.version,
      ...(input.fromEnvironment === undefined ? {} : { fromEnvironment: input.fromEnvironment }),
      environment: input.environment ?? check.environment,
    },
    proposal,
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`, "layout");
  return {
    status: "released",
    version: result.data.version,
    environment: result.data.environment,
    rollback: result.data.rollback,
  };
}

export async function reviewReleaseAction(
  formId: string,
  source: { readonly kind: "draft" } | { readonly kind: "version"; readonly version: number },
): Promise<ReadState<ReleaseReview>> {
  const session = await requireAdminSession();
  return readState(await reviewRelease(session, formId, source));
}

/* Reuse the caller's key after uncertain responses to replay a committed result; STALE_REVIEW leaves the
   key unused. */
export async function confirmPublishAction(
  formId: string,
  request: {
    readonly idempotencyKey: string;
    readonly expectedWorkflowRevision: number | null;
    readonly source: PublishIntent;
    readonly targets: readonly PublishDestination[];
  },
  proposal?: AgentProposalRef,
): Promise<PublishBatchState> {
  const session = await requireAdminSession();
  const result =
    request.source.kind === "draft"
      ? await publishBatch(
          session,
          formId,
          {
            idempotencyKey: request.idempotencyKey,
            expectedWorkflowRevision: request.expectedWorkflowRevision,
            draftRevision: request.source.draftRevision,
            targets: request.targets,
          },
          proposal,
        )
      : await releaseBatch(session, formId, {
          idempotencyKey: request.idempotencyKey,
          expectedWorkflowRevision: request.expectedWorkflowRevision,
          version: request.source.version,
          targets: request.targets,
        });
  if (!result.ok) return refusedPublish(result);
  return committedPublish(formId, result.data);
}

/* A lookup 404 means no confirmation committed, so the same idempotency key may be resent. */
export async function lookupPublishResultAction(
  formId: string,
  idempotencyKey: string,
): Promise<PublishBatchState> {
  const session = await requireAdminSession();
  const result = await lookupReleaseBatch(session, formId, idempotencyKey);
  if (!result.ok) {
    if (result.code === "RELEASE_BATCH_NOT_FOUND" || result.code === "http_404") {
      return { status: "not-committed" };
    }
    return refusedPublish(result);
  }
  return committedPublish(formId, result.data);
}

function refusedPublish(result: {
  readonly code: string;
  readonly message: string;
  readonly issues: readonly FormIssue[];
}): PublishBatchState {
  if (result.code === "STALE_REVIEW") return { status: "stale", message: result.message };
  if (result.issues.length > 0) {
    return { status: "rejected", issues: result.issues, message: result.message };
  }
  return { status: "error", message: result.message };
}

function committedPublish(formId: string, outcome: BatchOutcome): PublishBatchState {
  revalidatePath("/forms");
  revalidatePath("/operations");
  revalidatePath(`/forms/${formId}`, "layout");
  return {
    status: "done",
    version: outcome.version,
    froze: outcome.froze,
    replayed: outcome.replayed,
    releases: outcome.releases.map((release) => ({
      environment: release.environment,
      version: release.version,
      rollback: release.rollback,
    })),
  };
}

interface DraftPreviewRequest {
  readonly draft: DraftForm;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly instances: Readonly<Record<string, readonly string[]>>;
}

/* Forward hypothetical answers without logging or storage; the API alone evaluates rules. */
export async function previewDraftAction(
  formId: string,
  input: DraftPreviewRequest,
): Promise<DraftPreviewState> {
  const session = await requireAdminSession();
  if (!withinCap(input)) {
    return { status: "error", message: messageForFormCode(MALFORMED_CODE) };
  }

  const result = await previewDraft(session, formId, {
    definition: input.draft,
    answers: input.answers,
    instances: input.instances,
  });
  if (!result.ok) {
    if (result.issues.length > 0) {
      return { status: "rejected", issues: result.issues, message: result.message };
    }
    return { status: "error", message: result.message };
  }
  return { status: "ok", preview: result.data };
}

/* Closing affects new sessions in one environment; existing sessions keep their pinned version and finish
   normally. */
export async function setFormStatusAction(
  formId: string,
  shown: string | undefined,
  action: "close" | "reopen",
  proposal?: AgentProposalRef,
): Promise<FormStatusState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await setFormStatus(session, formId, action, check.environment, proposal);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`, "layout");
  revalidatePath(`/operations/forms/${formId}`, "layout");
  revalidatePath("/operations");
  return {
    status: "changed",
    formStatus: result.data.status,
    environment: result.data.environment,
  };
}

interface MintRequest {
  readonly expiresAt: string;
  readonly oneTime: boolean;
  readonly count: number;
}

/* Returned signed URLs are bearer credentials: do not log, store, or cache them. The API cannot reissue
   their tokens. */
export async function mintLinksAction(
  formId: string,
  shown: string | undefined,
  request: MintRequest,
  proposal?: AgentProposalRef,
): Promise<MintLinksState> {
  const session = await requireAdminSession();
  const count = Math.trunc(request.count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_LINK_BATCH) {
    return { status: "error", message: t("forms.error.invalidLinkBatch", { max: MAX_LINK_BATCH }) };
  }
  if (request.expiresAt.trim() === "") {
    return { status: "error", message: messageForFormCode("LINK_EXPIRY_INVALID") };
  }

  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await mintLinks(
    session,
    formId,
    {
      environment: check.environment,
      expiresAt: endOfDay(request.expiresAt),
      oneTime: request.oneTime,
      count,
    },
    proposal,
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/operations/forms/${formId}/links`);
  return { status: "minted", links: result.data };
}

/* Use the end of the chosen UTC day so a link remains valid throughout its labelled day, independently of
   the operator's zone. */
function endOfDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
}

/* Revocation stops new use; an in-flight session is unaffected. */
export async function revokeLinkAction(
  formId: string,
  shown: string | undefined,
  linkId: string,
  proposal?: AgentProposalRef,
): Promise<RevokeLinkState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await revokeLink(session, formId, linkId, proposal);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/operations/forms/${formId}/links`);
  return { status: "revoked", linkId: result.data.linkId };
}
