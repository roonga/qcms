import {
  environmentStatesByForm,
  getDraft,
  getFormEnvironmentState,
  getLatestPublishedVersion,
  latestVersionsByForm,
  listAccessGroups,
  listDeadLetterDeliveries,
  listForms,
  listFormReleases,
  listFormVersions,
  listQuestionVersions,
  listQuestions,
  listRecentDeliveries,
  listResponseMetadata,
  listSecureLinks,
  listTombstones,
  listWebhooks,
  listWorkspaceMembers,
  listWorkspaces,
  publishedTitlesByForm,
  writeAccessAuditRow,
  type Executor,
} from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import { ApiError } from "../../../errors.js";
import { previewConditionFlow, projectDraftFlow, validateDraft } from "../../forms/handler.js";
import { endpointUrlShown } from "../../membership/policy.js";
import { resolveCallerWorkspaces, workspacesAllowing } from "../../membership/resolver.js";
import { endpointUrlFor } from "../../webhooks/mask.js";
import { unpublishedDraftPins } from "../draft-pins.js";
import type {
  AgentContext,
  CountDeadLettersPort,
  CountLinksPort,
  CountResponsesPort,
  DeliveryStatusPort,
  DiffFormVersionsPort,
  DiffQuestionVersionsPort,
  FormDefinitionPort,
  FormVersionDiff,
  ListErasuresPort,
  ListFormVersionsPort,
  ListLinksPort,
  ListQuestionsPort,
  ListReleasesPort,
  ListResponsesPort,
  ListWebhooksPort,
  ListWorkspacesPort,
  ProjectDraftPort,
  QuestionVersionDiff,
  ReadFormPort,
  ReadQuestionPort,
  ReadWorkspacePort,
  ResponseFilterInput,
  SearchFormsPort,
  TestRulePort,
  ValidateDraftPort,
} from "../types.js";
import {
  FACT_ROW_LIMIT,
  auditedRead,
  forbidden,
  iso,
  requireCell,
  resolveForm,
  resolveQuestion,
  resolveWorkspaceId,
  workspacesHolding,
  type ScreenBuildInput,
} from "./support.js";

/**
 * One read port per admin GET route the agent may make. Each takes the subject ids the call
 * names, defaulting to the screen's, and re-makes that screen's own read check against the
 * subject it resolved. None reaches an answer, a ledger row or a webhook payload.
 */

type ResponseFilters = Omit<ResponseFilterInput, "limit" | "formId">;

/** How many rows a count scans before it says it stopped. A turn is a payload, not a page. */
const SCAN_LIMIT = 200;

interface DraftShape {
  readonly steps?: readonly {
    readonly stepId?: unknown;
    readonly title?: unknown;
    readonly items?: readonly unknown[];
  }[];
  readonly rules?: readonly unknown[];
}

interface Pin {
  readonly questionId: string;
  readonly version: number;
}

function pinOf(entry: unknown): Pin | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const ref = entry as { questionId?: unknown; version?: unknown };
  return typeof ref.questionId === "string" && typeof ref.version === "number"
    ? { questionId: ref.questionId, version: ref.version }
    : undefined;
}

/** A step item is a pinned question or a repeating group holding them, never both. */
function itemPins(item: unknown): readonly Pin[] {
  const nested = (item as { items?: unknown } | null)?.items;
  const entries = Array.isArray(nested) ? nested : [item];
  return entries.flatMap((entry) => {
    const pin = pinOf(entry);
    return pin === undefined ? [] : [pin];
  });
}

/** Reads the pins out of a definition positionally: a version row is stored, not parsed. */
function pinsOf(definition: unknown): readonly Pin[] {
  const steps = (definition as DraftShape | undefined)?.steps ?? [];
  return steps.flatMap((step) => (step.items ?? []).flatMap((item) => itemPins(item)));
}

function stepIdsOf(definition: unknown): readonly string[] {
  return ((definition as DraftShape | undefined)?.steps ?? [])
    .map((step) => (typeof step.stepId === "string" ? step.stepId : ""))
    .filter((id) => id !== "");
}

function ruleCountOf(definition: unknown): number {
  return (definition as DraftShape | undefined)?.rules?.length ?? 0;
}

function missing(ids: readonly string[], from: readonly string[]): readonly string[] {
  const held = new Set(from);
  return ids.filter((id) => !held.has(id)).slice(0, FACT_ROW_LIMIT);
}

/** A side given as `undefined` does not exist; `reads.test.ts` holds that apart from an empty one. */
export function structuralDiff(args: {
  readonly from: string;
  readonly to: string;
  readonly before: unknown;
  readonly after: unknown;
}): FormVersionDiff {
  const fromFound = args.before !== undefined;
  const toFound = args.after !== undefined;
  // A form with no draft at all would otherwise diff as one whose every question was removed.
  if (!fromFound || !toFound) {
    return {
      from: args.from,
      to: args.to,
      fromFound,
      toFound,
      outcome: "unavailable",
      identical: null,
      stepsAdded: null,
      stepsRemoved: null,
      questionsAdded: null,
      questionsRemoved: null,
      questionsRepinned: null,
      ruleCountFrom: fromFound ? ruleCountOf(args.before) : null,
      ruleCountTo: toFound ? ruleCountOf(args.after) : null,
    };
  }
  const beforePins = pinsOf(args.before);
  const afterPins = pinsOf(args.after);
  const beforeIds = beforePins.map((pin) => pin.questionId);
  const afterIds = afterPins.map((pin) => pin.questionId);
  const beforeVersions = new Map(beforePins.map((pin) => [pin.questionId, pin.version] as const));
  const repinned = afterPins
    .filter((pin) => {
      const was = beforeVersions.get(pin.questionId);
      return was !== undefined && was !== pin.version;
    })
    .slice(0, FACT_ROW_LIMIT)
    .map((pin) => ({
      questionId: pin.questionId,
      from: beforeVersions.get(pin.questionId) ?? 0,
      to: pin.version,
    }));
  const stepsAdded = missing(stepIdsOf(args.after), stepIdsOf(args.before));
  const stepsRemoved = missing(stepIdsOf(args.before), stepIdsOf(args.after));
  const questionsAdded = missing(afterIds, beforeIds);
  const questionsRemoved = missing(beforeIds, afterIds);
  return {
    from: args.from,
    to: args.to,
    fromFound,
    toFound,
    outcome: "compared",
    identical: JSON.stringify(args.before) === JSON.stringify(args.after),
    stepsAdded,
    stepsRemoved,
    questionsAdded,
    questionsRemoved,
    questionsRepinned: repinned,
    ruleCountFrom: ruleCountOf(args.before),
    ruleCountTo: ruleCountOf(args.after),
  };
}

function label(version: number | null): string {
  return version === null ? "draft" : String(version);
}

/** Author-written text, resolved to one locale so a result line is a string. */
function titleText(value: unknown, locale: string): string | null {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return null;
  const map = value as Record<string, unknown>;
  const named = map[locale];
  if (typeof named === "string") return named;
  const first = Object.values(map).find((entry) => typeof entry === "string");
  return typeof first === "string" ? first : null;
}

function stepQuestionCount(step: { readonly items?: readonly unknown[] }): number {
  let total = 0;
  for (const item of step.items ?? []) {
    if (typeof item !== "object" || item === null) continue;
    const group = (item as { items?: unknown }).items;
    total += Array.isArray(group) ? group.length : 1;
  }
  return total;
}

function questionCountOf(definition: unknown): number {
  return ((definition as DraftShape | undefined)?.steps ?? []).reduce(
    (total, step) => total + stepQuestionCount(step),
    0,
  );
}

/**
 * The working definition of the form a call names: its saved draft, or the latest published
 * version, as the builder's own read resolves it. The grant check is on the resolved form
 * rather than the screen, which is what lets a turn work on another form.
 */
function formDefinitionPort(input: ScreenBuildInput): FormDefinitionPort {
  return async (asked) => {
    const { formId, workspaceId } = await resolveForm(input, asked.formId);
    await requireCell(input, { workspaceId, resource: "form", action: asked.action });
    const exec = input.deps.databases.control;
    const draft = await getDraft(exec, formId);
    const definition =
      draft?.definition ?? (await getLatestPublishedVersion(exec, formId))?.definition;
    if (definition === undefined) {
      throw forbidden(
        `Form ${formId} has no draft and no published version, so there is nothing to work on yet.`,
      );
    }
    return { formId, definition };
  };
}

function validatePort(input: ScreenBuildInput): ValidateDraftPort {
  return async (definition, pending) => {
    const { issues, warnings } = await validateDraft(input.deps, definition, pending);
    return { issues, warnings };
  };
}

/**
 * A draft that does not compile cannot be projected, which is an answer rather than a
 * failure: the kernel's own reasons go back to the model so it can fix the draft, instead of
 * it reading an opaque refusal and guessing.
 */
function projectDraftPort(input: ScreenBuildInput, resolve: FormDefinitionPort): ProjectDraftPort {
  return async (asked) => {
    const { definition } = await resolve({ formId: asked.formId, action: "preview" });
    try {
      return {
        projected: true,
        ...(await projectDraftFlow(input.deps, definition, asked.answers)),
      };
    } catch (error) {
      return {
        projected: false,
        reason: previewRefusal(error),
        visibleSteps: [],
        visibleQuestions: [],
        complete: false,
      };
    }
  };
}

/** The refusal's own issue messages, which are authoring-boundary text and never an answer. */
function previewRefusal(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  const issues = (
    error.details as { readonly issues?: readonly { message?: unknown }[] } | undefined
  )?.issues;
  const reasons = (issues ?? [])
    .map((issue) => (typeof issue.message === "string" ? issue.message : ""))
    .filter((message) => message !== "");
  // Stated, not prescribed: an unpublished pin is a reason a draft cannot be projected and
  // is not a defect, so this never tells the model to go and fix one.
  return reasons.length === 0 ? `${error.message}.` : `${error.message}: ${reasons.join(" ")}`;
}

function testRulePort(input: ScreenBuildInput, resolve: FormDefinitionPort): TestRulePort {
  return async (asked) => {
    const { formId, definition } = await resolve({ formId: asked.formId, action: "preview" });
    const verdict = await previewConditionFlow(input.deps, formId as FormId, {
      definition,
      ruleId: asked.ruleId,
      answers: asked.answers,
      instances: asked.instances,
    });
    return {
      ruleId: verdict.ruleId,
      outcome: verdict.outcome,
      reason: verdict.reason ?? null,
      references: verdict.references,
      targetGroupId: verdict.targetGroupId ?? null,
      instanceOutcomes: verdict.instanceOutcomes ?? null,
    };
  };
}

function readFormPort(input: ScreenBuildInput): ReadFormPort {
  return async (asked) => {
    const { formId, workspaceId, row } = await resolveForm(input, asked.formId);
    await requireCell(input, { workspaceId, resource: "form", action: "read" });
    const exec = input.deps.databases.control;
    const [draft, published, state, titles] = await Promise.all([
      getDraft(exec, formId),
      getLatestPublishedVersion(exec, formId),
      getFormEnvironmentState(exec, formId, input.environment),
      publishedTitlesByForm(exec, [formId]),
    ]);
    const definition = draft?.definition ?? published?.definition;
    const shape = definition as DraftShape | undefined;
    const rules = (shape?.rules ?? []).slice(0, FACT_ROW_LIMIT).map((rule) => {
      const named = rule as { ruleId?: unknown; targets?: unknown };
      return {
        ruleId: typeof named.ruleId === "string" ? named.ruleId : "",
        targets: Array.isArray(named.targets)
          ? named.targets.filter((target): target is string => typeof target === "string")
          : [],
      };
    });
    return {
      formId,
      slug: row.slug,
      // The working definition's own title first: a form with no published version has no
      // published title, and the draft is what the person is looking at.
      title:
        titleText(
          (definition as { readonly title?: unknown } | undefined)?.title,
          row.defaultLocale,
        ) ?? titleText(titles.get(formId), row.defaultLocale),
      environment: input.environment,
      defaultLocale: row.defaultLocale,
      hasDraft: draft !== undefined,
      latestPublishedVersion: published?.version ?? null,
      releasedVersion: state?.version ?? null,
      closed: state?.closed ?? false,
      challengeRequired: row.challengeRequired,
      stepCount: shape?.steps?.length ?? 0,
      questionCount: questionCountOf(definition),
      ruleCount: shape?.rules?.length ?? 0,
      steps: (shape?.steps ?? []).slice(0, FACT_ROW_LIMIT).map((step) => ({
        stepId: typeof step.stepId === "string" ? step.stepId : "",
        title: titleText(step.title, row.defaultLocale),
        questionCount: stepQuestionCount(step),
      })),
      rules,
      pinnedQuestions: pinsOf(definition).slice(0, FACT_ROW_LIMIT),
      definition: definition ?? null,
      publishedDefinition: published?.definition ?? null,
      unpublishedPins: [...(await unpublishedDraftPins(input.deps, formId))].slice(
        0,
        FACT_ROW_LIMIT,
      ),
    };
  };
}

function listFormVersionsPort(input: ScreenBuildInput): ListFormVersionsPort {
  return async (asked) => {
    const { formId, workspaceId } = await resolveForm(input, asked.formId);
    await requireCell(input, { workspaceId, resource: "form", action: "read" });
    const exec = input.deps.databases.control;
    const [versions, releases] = await Promise.all([
      listFormVersions(exec, formId),
      listFormReleases(exec, formId),
    ]);
    const whereReleased = new Map<number, Set<string>>();
    for (const release of releases) {
      const named = whereReleased.get(release.version) ?? new Set<string>();
      named.add(release.environment);
      whereReleased.set(release.version, named);
    }
    return {
      formId,
      versions: versions.slice(0, Math.min(asked.limit, FACT_ROW_LIMIT)).map((version) => ({
        version: version.version,
        publishedAt: iso(version.publishedAt),
        releasedIn: [...(whereReleased.get(version.version) ?? [])],
        stepCount: (version.definition as DraftShape | undefined)?.steps?.length ?? 0,
        questionCount: questionCountOf(version.definition),
      })),
    };
  };
}

function listReleasesPort(input: ScreenBuildInput): ListReleasesPort {
  return async (asked) => {
    const { formId, workspaceId } = await resolveForm(input, asked.formId);
    await requireCell(input, { workspaceId, resource: "release", action: "read" });
    const exec = input.deps.databases.control;
    const environments = input.deps.databases.names;
    const [releases, ...states] = await Promise.all([
      listFormReleases(exec, formId),
      ...environments.map((environment) => environmentStatesByForm(exec, environment, [formId])),
    ]);
    return {
      formId,
      environments: [...environments],
      states: environments.map((environment, at) => {
        const state = states[at]?.get(formId);
        return {
          environment,
          version: state?.version ?? null,
          closed: state?.closed ?? false,
        };
      }),
      releases: releases.slice(0, Math.min(asked.limit, FACT_ROW_LIMIT)).map((release) => ({
        environment: release.environment,
        version: release.version,
        releasedAt: iso(release.releasedAt),
        releasedBy: release.releasedBy,
        approvedBy: release.approvedBy,
        fromEnvironment: release.fromEnvironment,
        replacedVersion: release.replacedVersion,
        rollback: release.rollback,
        closed: release.closed,
      })),
    };
  };
}

function diffFormVersionsPort(input: ScreenBuildInput): DiffFormVersionsPort {
  return async (asked) => {
    const { formId, workspaceId } = await resolveForm(input, asked.formId);
    await requireCell(input, { workspaceId, resource: "form", action: "read" });
    const exec = input.deps.databases.control;
    const [versions, draft] = await Promise.all([
      listFormVersions(exec, formId),
      getDraft(exec, formId),
    ]);
    const sideOf = (version: number | null): unknown =>
      version === null
        ? draft?.definition
        : versions.find((row) => row.version === version)?.definition;
    return structuralDiff({
      from: label(asked.from),
      to: label(asked.to),
      before: sideOf(asked.from),
      after: sideOf(asked.to),
    });
  };
}

type LinkState = "active" | "consumed" | "revoked" | "expired";

async function linksOf(
  input: ScreenBuildInput,
  named: string | undefined,
): Promise<{
  readonly formId: string;
  readonly rows: readonly {
    readonly linkId: string;
    readonly state: LinkState;
    readonly oneTime: boolean;
    readonly expiresAt: string | null;
    readonly createdAt: string | null;
  }[];
}> {
  const { formId, workspaceId } = await resolveForm(input, named);
  await requireCell(input, { workspaceId, resource: "link", action: "read" });
  const links = await listSecureLinks(input.deps.databases.control, formId, input.environment);
  const now = input.deps.clock.now().getTime();
  const stateOf = (link: (typeof links)[number]): LinkState => {
    if (link.revokedAt !== null) return "revoked";
    if (link.consumedAt !== null) return "consumed";
    return link.expiresAt.getTime() <= now ? "expired" : "active";
  };
  return {
    formId,
    // No token exists to return: a link's URL is a bearer credential and is minted elsewhere.
    rows: links.map((link) => ({
      linkId: link.linkId,
      state: stateOf(link),
      oneTime: link.oneTime,
      expiresAt: iso(link.expiresAt),
      createdAt: iso(link.createdAt),
    })),
  };
}

function countsOf(rows: readonly { readonly state: LinkState }[]): {
  active: number;
  consumed: number;
  revoked: number;
  expired: number;
  total: number;
} {
  const counts = { active: 0, consumed: 0, revoked: 0, expired: 0, total: rows.length };
  for (const row of rows) counts[row.state] += 1;
  return counts;
}

function countLinksPort(input: ScreenBuildInput): CountLinksPort {
  return async (asked) => {
    const { rows } = await linksOf(input, asked.formId);
    return { environment: input.environment, ...countsOf(rows) };
  };
}

function listLinksPort(input: ScreenBuildInput): ListLinksPort {
  return async (asked) => {
    const { formId, rows } = await linksOf(input, asked.formId);
    return {
      formId,
      environment: input.environment,
      ...countsOf(rows),
      links: rows.slice(0, Math.min(asked.limit, FACT_ROW_LIMIT)),
    };
  };
}

function filterDigest(filters: ResponseFilters): string {
  return JSON.stringify([
    filters.version ?? null,
    filters.from ?? null,
    filters.to ?? null,
    filters.flagged ?? null,
  ]);
}

function responseQuery(
  formId: FormId,
  filters: ResponseFilters,
  limit: number,
): Parameters<typeof listResponseMetadata>[2] {
  return {
    formId,
    ...(filters.version === undefined ? {} : { version: filters.version }),
    ...(filters.from === undefined ? {} : { from: new Date(filters.from) }),
    ...(filters.to === undefined ? {} : { to: new Date(filters.to) }),
    ...(filters.flagged === undefined ? {} : { flagged: filters.flagged }),
    limit,
    offset: 0,
  };
}

/** Write the audit row in the read's transaction, as the response screens do. */
async function readRow(
  input: ScreenBuildInput,
  tx: Executor,
  subject: {
    readonly workspaceId: string;
    readonly formId: FormId;
    readonly environment: string;
  },
): Promise<void> {
  await writeAccessAuditRow(tx, {
    actor: input.principal.userId,
    workspaceId: subject.workspaceId,
    environment: subject.environment,
    formId: subject.formId,
    kind: "read",
    occurredAt: input.deps.clock.now(),
  });
}

/**
 * The audit `read` row is keyed by the subject the facts builder keys it by, so a turn's own list and the
 * tool's list over the same form and filters share one row rather than writing two (Q10).
 */
function responsePorts(input: ScreenBuildInput): {
  readonly listResponses: ListResponsesPort;
  readonly countResponses: CountResponsesPort;
} {
  const read = async (
    named: string | undefined,
    filters: ResponseFilters,
    limit: number,
  ): Promise<Awaited<ReturnType<typeof listResponseMetadata>>> => {
    const { formId, workspaceId } = await resolveForm(input, named);
    await requireCell(input, { workspaceId, resource: "response", action: "read", formId });
    const request = input.deps.databases.forRequest(input.environment);
    return auditedRead(input, `list:${formId}:${filterDigest(filters)}`, (audit) =>
      request.exec.transaction(async (tx) => {
        if (audit) {
          await readRow(input, tx, {
            workspaceId,
            formId,
            environment: request.environment,
          });
        }
        return listResponseMetadata(tx, request.environment, responseQuery(formId, filters, limit));
      }),
    );
  };

  return {
    listResponses: async (asked) => {
      const page = await read(asked.formId, asked, Math.min(asked.limit, FACT_ROW_LIMIT));
      return {
        total: page.total,
        responses: page.rows.map((row) => ({
          sessionId: row.sessionId,
          formVersion: row.formVersion,
          startedAt: iso(row.startedAt),
          submittedAt: iso(row.submittedAt),
          accessMode: row.accessMode,
          flagged: row.flagged,
          flaggedReason: row.flaggedReason,
        })),
      };
    },
    // One row rather than none: the count comes off the same query, and a count under a
    // filter set is a read of that set (Q9 refuses small-count suppression).
    countResponses: async (asked) => ({ total: (await read(asked.formId, asked, 1)).total }),
  };
}

async function webhooksOf(
  input: ScreenBuildInput,
  named: string | undefined,
): Promise<{
  readonly formId: string;
  readonly endpoints: readonly {
    readonly webhookId: string;
    readonly url: string;
    readonly active: boolean;
    readonly createdAt: string | null;
  }[];
  readonly deliveries: readonly Awaited<ReturnType<typeof listRecentDeliveries>>[number][];
}> {
  const { formId, workspaceId } = await resolveForm(input, named);
  const resolved = await requireCell(input, {
    workspaceId,
    resource: "webhook",
    action: "read",
  });
  const visibility = endpointUrlShown(resolved, input.environment);
  // An endpoint and its deliveries are the environment's own data, as the webhooks route
  // reads them.
  const { exec } = input.deps.databases.forRequest(input.environment);
  const [endpoints, deliveries] = await Promise.all([
    listWebhooks(exec, formId),
    listRecentDeliveries(exec, formId, SCAN_LIMIT),
  ]);
  return {
    formId,
    endpoints: endpoints.map((endpoint) => ({
      webhookId: endpoint.webhookId,
      url: endpointUrlFor(endpoint.url, visibility),
      active: endpoint.active,
      createdAt: iso(endpoint.createdAt),
    })),
    deliveries,
  };
}

function deliveryState(row: {
  readonly deliveredAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly deadLetteredAt: Date | null;
}): "delivered" | "cancelled" | "dead" | "pending" {
  if (row.deliveredAt !== null) return "delivered";
  if (row.cancelledAt !== null) return "cancelled";
  if (row.deadLetteredAt !== null) return "dead";
  return "pending";
}

function deliveryStatusPort(input: ScreenBuildInput): DeliveryStatusPort {
  return async (asked) => {
    const { endpoints, deliveries } = await webhooksOf(input, asked.formId);
    const counts = { delivered: 0, pending: 0, dead: 0, cancelled: 0 };
    for (const delivery of deliveries) {
      if (asked.webhookId !== undefined && delivery.webhookId !== asked.webhookId) continue;
      counts[deliveryState(delivery)] += 1;
    }
    return {
      scanned: deliveries.length,
      truncated: deliveries.length >= SCAN_LIMIT,
      ...counts,
      endpoints: endpoints
        .filter(
          (endpoint) => asked.webhookId === undefined || endpoint.webhookId === asked.webhookId,
        )
        .slice(0, FACT_ROW_LIMIT)
        .map((endpoint) => ({
          webhookId: endpoint.webhookId,
          url: endpoint.url,
          active: endpoint.active,
        })),
    };
  };
}

/** Delivery state and timing only: never a payload, a consumer body or a last-error string. */
function listWebhooksPort(input: ScreenBuildInput): ListWebhooksPort {
  return async (asked) => {
    const { formId, endpoints, deliveries } = await webhooksOf(input, asked.formId);
    const limit = Math.min(asked.limit, FACT_ROW_LIMIT);
    return {
      formId,
      environment: input.environment,
      endpoints: endpoints.slice(0, limit),
      deliveries: deliveries.slice(0, limit).map((delivery) => ({
        deliveryId: delivery.deliveryId,
        eventType: delivery.eventType,
        state: deliveryState(delivery),
        attempts: delivery.attempts,
        lastStatus: delivery.lastStatus,
        lastAttemptAt: iso(delivery.lastAttemptAt),
        deliveredAt: iso(delivery.deliveredAt),
        nextAttemptAt: iso(delivery.nextAttemptAt),
      })),
    };
  };
}

/** Installation-wide operator state: the screen's own claim, not a workspace grant. */
function requireClaim(input: ScreenBuildInput, what: string): void {
  if (input.principal.claim) return;
  throw forbidden(
    `${what} is installation-wide operator state, so it needs the installation-wide ` +
      "administrator claim. A workspace's own grants do not reach it.",
  );
}

function countDeadLettersPort(input: ScreenBuildInput): CountDeadLettersPort {
  return async () => {
    requireClaim(input, "The dead-letter queue");
    const rows = await listDeadLetterDeliveries(
      input.deps.databases.forRequest(input.environment).exec,
      SCAN_LIMIT,
    );
    const byForm = new Map<string, number>();
    for (const row of rows) byForm.set(row.formId, (byForm.get(row.formId) ?? 0) + 1);
    return {
      scanned: rows.length,
      truncated: rows.length >= SCAN_LIMIT,
      total: rows.length,
      byForm: [...byForm.entries()]
        .slice(0, FACT_ROW_LIMIT)
        .map(([formId, count]) => ({ formId, count })),
    };
  };
}

/** The erasure log carries no answers, which is why the principle admits it (point 4). */
function listErasuresPort(input: ScreenBuildInput): ListErasuresPort {
  return async (asked) => {
    requireClaim(input, "The erasure log");
    const request = input.deps.databases.forRequest(input.environment);
    const rows = await listTombstones(request.exec, {
      limit: Math.min(asked.limit, FACT_ROW_LIMIT),
    });
    return {
      environment: request.environment,
      erasures: rows.map((row) => ({
        sessionId: row.sessionId,
        formId: row.formId,
        formVersion: row.formVersion,
        erasedAt: iso(row.erasedAt),
        reason: row.reason,
      })),
    };
  };
}

function diffQuestionVersionsPort(input: ScreenBuildInput): DiffQuestionVersionsPort {
  return async (asked) => {
    const { questionId, workspaceId } = await resolveQuestion(input, asked.questionId);
    await requireCell(input, { workspaceId, resource: "question", action: "read" });
    const versions = await listQuestionVersions(input.deps.databases.control, questionId);
    const before = versions.find((row) => row.version === asked.from);
    const after = versions.find((row) => row.version === asked.to);
    return questionDiff(questionId, asked, before, after);
  };
}

function memberOf(definition: unknown, name: string): string | null {
  const value = (definition as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : null;
}

function questionDiff(
  questionId: string,
  asked: { readonly from: number; readonly to: number },
  before: { readonly status: string; readonly definition: unknown } | undefined,
  after: { readonly status: string; readonly definition: unknown } | undefined,
): QuestionVersionDiff {
  const left = (before?.definition ?? {}) as Record<string, unknown>;
  const right = (after?.definition ?? {}) as Record<string, unknown>;
  const names = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changedFields = names.filter(
    (name) => JSON.stringify(left[name] ?? null) !== JSON.stringify(right[name] ?? null),
  );
  return {
    questionId,
    from: asked.from,
    to: asked.to,
    fromFound: before !== undefined,
    toFound: after !== undefined,
    identical: before !== undefined && after !== undefined && changedFields.length === 0,
    statusFrom: before?.status ?? null,
    statusTo: after?.status ?? null,
    typeFrom: memberOf(before?.definition, "type"),
    typeTo: memberOf(after?.definition, "type"),
    changedFields: changedFields.slice(0, FACT_ROW_LIMIT),
  };
}

/**
 * One question's versions and the definition of the version the call names, which is the
 * read the library's own detail screen makes. A definition is author content, so it travels
 * whole and the kernel is what validates it.
 */
function readQuestionPort(input: ScreenBuildInput): ReadQuestionPort {
  return async (asked) => {
    const { questionId, workspaceId } = await resolveQuestion(input, asked.questionId);
    await requireCell(input, { workspaceId, resource: "question", action: "read" });
    const exec = input.deps.databases.control;
    const versions = await listQuestionVersions(exec, questionId);
    const slug = (await listQuestions(exec, { workspaceIds: [workspaceId] })).find(
      (summary) => summary.questionId === questionId,
    )?.slug;
    const chosen =
      asked.version === undefined
        ? versions.at(-1)
        : versions.find((row) => row.version === asked.version);
    return {
      questionId,
      slug: slug ?? "",
      workspaceId,
      versions: versions.slice(0, FACT_ROW_LIMIT).map((version) => ({
        version: version.version,
        status: version.status,
        publishedAt: iso(version.publishedAt),
        type: memberOf(version.definition, "type"),
      })),
      definitionVersion: chosen?.version ?? null,
      definition: chosen?.definition ?? null,
    };
  };
}

/** The library as its own screen lists it: every status, not only the published ones. */
function listQuestionsPort(input: ScreenBuildInput): ListQuestionsPort {
  return async (asked) => {
    const workspaceIds = await workspacesHolding(input, { resource: "question", action: "read" });
    const all = await listQuestions(input.deps.databases.control, { workspaceIds });
    const needle = asked.query?.trim().toLowerCase();
    const matched = all.filter(
      (question) =>
        needle === undefined ||
        needle === "" ||
        question.slug.toLowerCase().includes(needle) ||
        question.questionId.toLowerCase().includes(needle),
    );
    return {
      matched: matched.length,
      questions: matched.slice(0, Math.min(asked.limit, FACT_ROW_LIMIT)).map((question) => ({
        questionId: question.questionId,
        slug: question.slug,
        latestVersion: question.latestVersion,
        latestStatus: question.latestStatus,
        publishedAt: iso(question.publishedAt),
      })),
    };
  };
}

/** The workspaces the caller may read forms in, which is what the list screen narrows to. */
function searchFormsPort(input: ScreenBuildInput): SearchFormsPort {
  return async (asked) => {
    const workspaceIds = await workspacesHolding(input, { resource: "form", action: "read" });
    const exec = input.deps.databases.control;
    const all = await listForms(exec, { workspaceIds });
    const needle = asked.query?.trim().toLowerCase();
    const matched = all.filter(
      (form) =>
        needle === undefined ||
        needle === "" ||
        form.slug.toLowerCase().includes(needle) ||
        form.formId.toLowerCase().includes(needle),
    );
    const shown = matched.slice(0, Math.min(asked.limit, FACT_ROW_LIMIT));
    const ids = shown.map((form) => form.formId);
    const [titles, latest, states] = await Promise.all([
      publishedTitlesByForm(exec, ids),
      latestVersionsByForm(exec, ids),
      environmentStatesByForm(exec, input.environment, ids),
    ]);
    return {
      environment: input.environment,
      matched: matched.length,
      forms: shown.map((form) => ({
        formId: form.formId,
        slug: form.slug,
        title: titleText(titles.get(form.formId), form.defaultLocale),
        latestVersion: latest.get(form.formId) ?? null,
        releasedVersion: states.get(form.formId)?.version ?? null,
        closed: states.get(form.formId)?.closed ?? false,
      })),
    };
  };
}

/** The workspaces the caller administers, which is what the workspaces screen lists. */
function listWorkspacesPort(input: ScreenBuildInput): ListWorkspacesPort {
  return async () => {
    const resolved = await resolveCallerWorkspaces(input.deps.databases.control, {
      userId: input.principal.userId,
      claim: input.principal.claim,
    });
    const administered = new Set(
      workspacesAllowing(resolved, { resource: "workspace", action: "read" }),
    );
    const rows = await listWorkspaces(input.deps.databases.control);
    return {
      workspaces: rows
        .filter((workspace) => administered.has(workspace.id))
        .slice(0, FACT_ROW_LIMIT)
        .map((workspace) => ({
          workspaceId: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          shared: workspace.isShared,
          archived: workspace.archivedAt !== null,
          requireSecondApprover: workspace.requireSecondApprover,
        })),
    };
  };
}

/** Staff names and emails are staff data and may travel; no respondent data is here (Q11). */
function readWorkspacePort(input: ScreenBuildInput): ReadWorkspacePort {
  return async (asked) => {
    const workspaceId = resolveWorkspaceId(input, asked.workspaceId);
    await requireCell(input, { workspaceId, resource: "membership", action: "read" });
    const exec = input.deps.databases.control;
    const [workspaces, members, groups] = await Promise.all([
      listWorkspaces(exec),
      listWorkspaceMembers(exec, workspaceId),
      listAccessGroups(exec, workspaceId),
    ]);
    const workspace = workspaces.find((row) => row.id === workspaceId);
    if (workspace === undefined) throw forbidden(`No such workspace: ${workspaceId}`);
    return {
      workspaceId,
      name: workspace.name,
      shared: workspace.isShared,
      requireSecondApprover: workspace.requireSecondApprover,
      members: members.slice(0, FACT_ROW_LIMIT).map((member) => ({
        userId: member.userId,
        email: member.email,
        name: member.name,
        role: member.role,
      })),
      accessGroups: groups.slice(0, FACT_ROW_LIMIT).map((group) => ({
        groupId: group.teamId,
        name: group.name,
        roles: [...group.roles],
        environments: [...group.environments],
      })),
    };
  };
}

/**
 * Every read port, closed over this caller. Which of them the model is told about is the
 * caller's own grants, not a screen's list, and each port re-makes its own check on the
 * subject the call names, so a port offered and a port refused are both honest answers.
 */
export function readPorts(input: ScreenBuildInput): Partial<AgentContext> {
  const responses = responsePorts(input);
  const formDefinition = formDefinitionPort(input);
  return {
    formDefinition,
    validate: validatePort(input),
    projectDraft: projectDraftPort(input, formDefinition),
    testRule: testRulePort(input, formDefinition),
    readForm: readFormPort(input),
    listFormVersions: listFormVersionsPort(input),
    listReleases: listReleasesPort(input),
    diffFormVersions: diffFormVersionsPort(input),
    countLinks: countLinksPort(input),
    listLinks: listLinksPort(input),
    listResponses: responses.listResponses,
    countResponses: responses.countResponses,
    deliveryStatus: deliveryStatusPort(input),
    listWebhooks: listWebhooksPort(input),
    countDeadLetters: countDeadLettersPort(input),
    listErasures: listErasuresPort(input),
    diffQuestionVersions: diffQuestionVersionsPort(input),
    readQuestion: readQuestionPort(input),
    listQuestions: listQuestionsPort(input),
    searchForms: searchFormsPort(input),
    listWorkspaces: listWorkspacesPort(input),
    readWorkspace: readWorkspacePort(input),
  };
}
