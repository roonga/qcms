import {
  environmentStatesByForm,
  getDraft,
  latestVersionsByForm,
  listDeadLetterDeliveries,
  listForms,
  listFormVersions,
  listQuestionVersions,
  listRecentDeliveries,
  listResponseMetadata,
  listSecureLinks,
  listWebhooks,
  publishedTitlesByForm,
  writeAccessAuditRow,
  type Executor,
} from "@roonga/qcms-db";
import type { FormDefinition, FormId } from "@roonga/qcms-core";

import { previewConditionFlow } from "../../forms/handler.js";
import { holdsStatement } from "../../membership/policy.js";
import { endpointUrlFor } from "../../webhooks/mask.js";
import type {
  AgentContext,
  CountDeadLettersPort,
  CountLinksPort,
  CountResponsesPort,
  DeliveryStatusPort,
  DiffFormVersionsPort,
  DiffQuestionVersionsPort,
  FormVersionDiff,
  ListResponsesPort,
  QuestionVersionDiff,
  ResponseFilterInput,
  SearchFormsPort,
  TestRulePort,
} from "../types.js";
import type { AgentToolName } from "../tools/registry.js";
import {
  FACT_ROW_LIMIT,
  auditedRead,
  forbidden,
  iso,
  requireCell,
  requireForm,
  requireQuestion,
  workspacesHolding,
  type ScreenBuildInput,
} from "./support.js";

/**
 * The read ports of D1 to D7, one per read tool a screen declares. Each re-makes its own screen's read
 * check, and none selects an answer column, joins an answer table or carries a webhook payload.
 */

type ResponseFilters = Omit<ResponseFilterInput, "limit">;

/** How many rows a count scans before it says it stopped. A turn is a payload, not a page. */
const SCAN_LIMIT = 200;

interface DraftShape {
  readonly steps?: readonly {
    readonly stepId?: unknown;
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

function structuralDiff(args: {
  readonly from: string;
  readonly to: string;
  readonly before: unknown;
  readonly after: unknown;
}): FormVersionDiff {
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
    fromFound: args.before !== undefined,
    toFound: args.after !== undefined,
    identical: JSON.stringify(args.before ?? null) === JSON.stringify(args.after ?? null),
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

function testRulePort(input: ScreenBuildInput, draft: FormDefinition): TestRulePort {
  return async (asked) => {
    const { formId, workspaceId } = await requireForm(input);
    await requireCell(input, { workspaceId, resource: "form", action: "preview", formId });
    const verdict = await previewConditionFlow(input.deps, formId, {
      definition: draft,
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

function diffFormVersionsPort(input: ScreenBuildInput): DiffFormVersionsPort {
  return async (asked) => {
    const { formId, workspaceId } = await requireForm(input);
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

function countLinksPort(input: ScreenBuildInput): CountLinksPort {
  return async () => {
    const { formId, workspaceId } = await requireForm(input);
    await requireCell(input, { workspaceId, resource: "link", action: "read" });
    const links = await listSecureLinks(input.deps.databases.control, formId, input.environment);
    const now = input.deps.clock.now().getTime();
    const counts = { active: 0, consumed: 0, revoked: 0, expired: 0 };
    for (const link of links) {
      if (link.revokedAt !== null) counts.revoked += 1;
      else if (link.consumedAt !== null) counts.consumed += 1;
      else if (link.expiresAt.getTime() <= now) counts.expired += 1;
      else counts.active += 1;
    }
    return { environment: input.environment, ...counts, total: links.length };
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
 * D4. The audit `read` row is keyed by the subject the facts builder keys it by, so a turn's own list and
 * the tool's list over the same filters share one row rather than writing two (Q10).
 */
function responsePorts(input: ScreenBuildInput): {
  readonly listResponses: ListResponsesPort;
  readonly countResponses: CountResponsesPort;
} {
  const read = async (
    filters: ResponseFilters,
    limit: number,
  ): Promise<Awaited<ReturnType<typeof listResponseMetadata>>> => {
    const { formId, workspaceId } = await requireForm(input);
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
      const page = await read(asked, Math.min(asked.limit, FACT_ROW_LIMIT));
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
    countResponses: async (asked) => ({ total: (await read(asked, 1)).total }),
  };
}

function deliveryStatusPort(input: ScreenBuildInput): DeliveryStatusPort {
  return async (asked) => {
    const { formId, workspaceId } = await requireForm(input);
    const resolved = await requireCell(input, {
      workspaceId,
      resource: "webhook",
      action: "read",
    });

    const visibility = holdsStatement(
      { memberRole: resolved.memberRole, grants: resolved.grants },
      "webhook",
      "configure",
    )
      ? "whole"
      : "masked";
    const exec = input.deps.databases.control;
    const [endpoints, deliveries] = await Promise.all([
      listWebhooks(exec, formId),
      listRecentDeliveries(exec, formId, SCAN_LIMIT),
    ]);
    const counts = { delivered: 0, pending: 0, dead: 0, cancelled: 0 };
    for (const delivery of deliveries) {
      if (asked.webhookId !== undefined && delivery.webhookId !== asked.webhookId) continue;
      if (delivery.deliveredAt !== null) counts.delivered += 1;
      else if (delivery.cancelledAt !== null) counts.cancelled += 1;
      else if (delivery.deadLetteredAt !== null) counts.dead += 1;
      else counts.pending += 1;
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
          url: endpointUrlFor(endpoint.url, visibility),
          active: endpoint.active,
        })),
    };
  };
}

/** D5's installation-wide half: the dead-letter screen's own claim, not a workspace grant. */
function countDeadLettersPort(input: ScreenBuildInput): CountDeadLettersPort {
  return async () => {
    if (!input.principal.claim) {
      throw forbidden(
        "The dead-letter queue is installation-wide operator state, so it needs the " +
          "installation-wide administrator claim. A workspace's own grants do not reach it.",
      );
    }
    const rows = await listDeadLetterDeliveries(input.deps.databases.control, SCAN_LIMIT);
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

function diffQuestionVersionsPort(input: ScreenBuildInput): DiffQuestionVersionsPort {
  return async (asked) => {
    const { questionId, workspaceId } = await requireQuestion(input);
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

/** D7. The workspaces the caller may read forms in, which is what the list screen narrows to. */
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

/**
 * The ports a screen's declared read tools close over. A tool whose port is absent is a
 * registry that disagrees with a screen's list, which the registry's own door reports.
 */
export function readPorts(args: {
  readonly input: ScreenBuildInput;
  readonly declared: readonly AgentToolName[];
  readonly draft: FormDefinition | undefined;
}): Partial<AgentContext> {
  const { input, declared, draft } = args;
  const has = (name: AgentToolName): boolean => declared.includes(name);
  const responses = responsePorts(input);
  return {
    ...(has("test_rule") && draft !== undefined ? { testRule: testRulePort(input, draft) } : {}),
    ...(has("diff_form_versions") ? { diffFormVersions: diffFormVersionsPort(input) } : {}),
    ...(has("count_links") ? { countLinks: countLinksPort(input) } : {}),
    ...(has("list_responses") ? { listResponses: responses.listResponses } : {}),
    ...(has("count_responses") ? { countResponses: responses.countResponses } : {}),
    ...(has("delivery_status") ? { deliveryStatus: deliveryStatusPort(input) } : {}),
    ...(has("count_dead_letters") ? { countDeadLetters: countDeadLettersPort(input) } : {}),
    ...(has("diff_question_versions")
      ? { diffQuestionVersions: diffQuestionVersionsPort(input) }
      : {}),
    ...(has("search_forms") ? { searchForms: searchFormsPort(input) } : {}),
  };
}
