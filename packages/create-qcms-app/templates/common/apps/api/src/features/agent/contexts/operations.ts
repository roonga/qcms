import { z } from "zod";

import {
  environmentStatesByForm,
  getResponseMetadata,
  listDeadLetterDeliveries,
  listForms,
  listRecentDeliveries,
  listResponseMetadata,
  listTombstones,
  listWebhooks,
  publishedTitlesByForm,
  responseCountsByForm,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import { ApiError } from "../../../errors.js";
import { decideAccess, holdsStatement } from "../../membership/policy.js";
import { resolveCallerWorkspaces } from "../../membership/resolver.js";
import { endpointUrlFor } from "../../webhooks/mask.js";
import {
  FACT_ROW_LIMIT,
  Instant,
  forbidden,
  iso,
  membershipIn,
  requireCell,
  requireForm,
  requireSession,
  type ScreenBuildInput,
} from "./support.js";

/**
 * The operational screens' facts: release state, response metadata and delivery state.
 *
 * No builder here selects an answer column, joins an answer table, or carries a webhook
 * payload, a consumer response body or a last-error string that might quote one (SEC-17).
 */

/** The response list's four filters, normalised, which is what a read row is keyed by. */
interface FilterSet {
  readonly version: number | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly flagged: boolean | undefined;
}

function filterSet(input: ScreenBuildInput): FilterSet {
  const filters = input.params.filters ?? {};
  return {
    version: filters.version,
    from: filters.from,
    to: filters.to,
    flagged: filters.flagged,
  };
}

function filterDigest(filters: FilterSet): string {
  return JSON.stringify([
    filters.version ?? null,
    filters.from ?? null,
    filters.to ?? null,
    filters.flagged ?? null,
  ]);
}

/**
 * Whether this conversation has yet had its row for this subject, so an audited read
 * writes one row per conversation for each distinct filter set rather than one per turn.
 * A forged id can add rows or skip a recorded subject, never leave one unrecorded.
 */
const CONVERSATION_WINDOW_MS = 12 * 60 * 60 * 1_000;

async function firstReadInConversation(input: ScreenBuildInput, subject: string): Promise<boolean> {
  const key = `agent-read:${input.principal.userId}:${input.conversationId}:${subject}`;
  const hit = await input.deps.rateLimitStore.hit(key, CONVERSATION_WINDOW_MS);
  return hit.count === 1;
}

function auditRefused(): ApiError {
  return new ApiError(
    "AUDIT_ACTOR_UNRESOLVED",
    500,
    "A response read could not be audited, so it is refused: SEC-15 records every read, " +
      "and a read without its row is the one failure this control may not have.",
  );
}

const ResponseMetadataFact = z.strictObject({
  sessionId: z.string(),
  formVersion: z.number().int(),
  startedAt: Instant,
  submittedAt: Instant,
  accessMode: z.string(),
  flagged: z.boolean(),
  flaggedReason: z.string().nullable(),
});

export const responseListFacts = z.strictObject({
  formId: z.string(),
  environment: z.string(),
  filters: z.strictObject({
    version: z.number().int().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    flagged: z.boolean().nullable(),
  }),
  total: z.number().int(),
  responses: z.array(ResponseMetadataFact),
});

async function buildResponseList(
  input: ScreenBuildInput,
): Promise<z.infer<typeof responseListFacts>> {
  const { formId, workspaceId } = await requireForm(input);
  await requireCell(input, {
    workspaceId,
    resource: "response",
    action: "read",
    formId,
  });
  const filters = filterSet(input);
  const request = input.deps.databases.forRequest(input.environment);
  const audit = await firstReadInConversation(input, `list:${formId}:${filterDigest(filters)}`);

  const page = await request.exec.transaction(async (tx) => {
    if (audit) {
      await writeAccessAuditRow(tx, {
        actor: input.principal.userId,
        workspaceId,
        environment: request.environment,
        formId,
        kind: "read",
        occurredAt: input.deps.clock.now(),
      });
    }
    return listResponseMetadata(tx, request.environment, {
      formId,
      ...(filters.version === undefined ? {} : { version: filters.version }),
      ...(filters.from === undefined ? {} : { from: new Date(filters.from) }),
      ...(filters.to === undefined ? {} : { to: new Date(filters.to) }),
      ...(filters.flagged === undefined ? {} : { flagged: filters.flagged }),
      limit: FACT_ROW_LIMIT,
      offset: 0,
    });
  });

  return {
    formId,
    environment: request.environment,
    filters: {
      version: filters.version ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
      flagged: filters.flagged ?? null,
    },
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
}

export const responseDetailFacts = z.strictObject({
  formId: z.string(),
  environment: z.string(),
  found: z.boolean(),
  response: ResponseMetadataFact.nullable(),
});

async function buildResponseDetail(
  input: ScreenBuildInput,
): Promise<z.infer<typeof responseDetailFacts>> {
  const { formId, workspaceId } = await requireForm(input);
  await requireCell(input, { workspaceId, resource: "response", action: "read", formId });
  const sessionId = requireSession(input);
  const request = input.deps.databases.forRequest(input.environment);
  const audit = await firstReadInConversation(input, `detail:${formId}:${sessionId}`);

  const row = await request.exec.transaction(async (tx) => {
    if (audit) {
      await writeAccessAuditRow(tx, {
        actor: input.principal.userId,
        workspaceId,
        environment: request.environment,
        formId,
        kind: "read",
        occurredAt: input.deps.clock.now(),
      });
    }
    return getResponseMetadata(tx, request.environment, formId, sessionId);
  });

  return {
    formId,
    environment: request.environment,
    found: row !== undefined,
    response:
      row === undefined
        ? null
        : {
            sessionId: row.sessionId,
            formVersion: row.formVersion,
            startedAt: iso(row.startedAt),
            submittedAt: iso(row.submittedAt),
            accessMode: row.accessMode,
            flagged: row.flagged,
            flaggedReason: row.flaggedReason,
          },
  };
}

const DeliveryFact = z.strictObject({
  deliveryId: z.string(),
  eventType: z.string(),
  state: z.enum(["delivered", "cancelled", "dead", "pending"]),
  attempts: z.number().int(),
  lastStatus: z.number().int().nullable(),
  lastAttemptAt: Instant,
  deliveredAt: Instant,
  nextAttemptAt: Instant,
});

export const formWebhooksFacts = z.strictObject({
  formId: z.string(),
  environment: z.string(),
  endpoints: z.array(
    z.strictObject({
      webhookId: z.string(),
      url: z.string(),
      active: z.boolean(),
      createdAt: Instant,
    }),
  ),
  deliveries: z.array(DeliveryFact),
});

function deliveryState(row: {
  readonly deliveredAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly deadLetteredAt: Date | null;
}): z.infer<typeof DeliveryFact>["state"] {
  if (row.deliveredAt !== null) return "delivered";
  if (row.cancelledAt !== null) return "cancelled";
  if (row.deadLetteredAt !== null) return "dead";
  return "pending";
}

async function buildFormWebhooks(
  input: ScreenBuildInput,
): Promise<z.infer<typeof formWebhooksFacts>> {
  const { formId, workspaceId } = await requireForm(input);
  const resolved = await requireCell(input, {
    workspaceId,
    resource: "webhook",
    action: "read",
  });
  // The masking the webhook screens already apply to a caller who may not configure (Q58).
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
    listRecentDeliveries(exec, formId, FACT_ROW_LIMIT),
  ]);
  return {
    formId,
    environment: input.environment,
    endpoints: endpoints.slice(0, FACT_ROW_LIMIT).map((endpoint) => ({
      webhookId: endpoint.webhookId,
      url: endpointUrlFor(endpoint.url, visibility),
      active: endpoint.active,
      createdAt: iso(endpoint.createdAt),
    })),
    deliveries: deliveries.map((delivery) => ({
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
}

export const operationsFacts = z.strictObject({
  environment: z.string(),
  forms: z.array(
    z.strictObject({
      formId: z.string(),
      slug: z.string(),
      title: z.string().nullable(),
      releasedVersion: z.number().int().nullable(),
      closed: z.boolean(),
      submitted: z.number().int().nullable(),
      inProgress: z.number().int().nullable(),
    }),
  ),
});

/** The operational cells, any one of which admits this screen, as the route row does. */
async function operationalWorkspaces(input: ScreenBuildInput): Promise<readonly string[]> {
  const resolved = await resolveCallerWorkspaces(input.deps.databases.control, {
    userId: input.principal.userId,
    claim: input.principal.claim,
  });
  const holding = resolved.filter((membership) =>
    (["form", "response"] as const).some((resource) =>
      holdsStatement(
        { memberRole: membership.memberRole, grants: membership.grants },
        resource,
        "read",
      ),
    ),
  );
  if (holding.length === 0) {
    throw forbidden(
      decideAccess({
        memberRole: undefined,
        grants: [],
        request: { resource: "form", action: "read" },
      }).reason ?? "Refused",
    );
  }
  return holding.map((membership) => membership.workspaceId);
}

async function buildOperations(input: ScreenBuildInput): Promise<z.infer<typeof operationsFacts>> {
  const workspaceIds = await operationalWorkspaces(input);
  const exec = input.deps.databases.control;
  const forms = (await listForms(exec, { workspaceIds })).slice(0, FACT_ROW_LIMIT);
  const ids = forms.map((form) => form.formId);
  const [titles, states] = await Promise.all([
    publishedTitlesByForm(exec, ids),
    environmentStatesByForm(exec, input.environment, ids),
  ]);

  // Counts only where this caller holds `response: read` for that form in this
  // environment, which is the same decision the screen's own read makes per form.
  const readable: FormId[] = [];
  for (const form of forms) {
    const resolved = await membershipIn(input, form.workspaceId);
    const decision = decideAccess({
      memberRole: resolved.memberRole,
      grants: resolved.grants,
      request: {
        resource: "response",
        action: "read",
        environment: input.environment,
        formId: form.formId,
      },
    });
    if (decision.allowed) readable.push(form.formId);
  }
  const request = input.deps.databases.forRequest(input.environment);
  const counts = await responseCountsByForm(request.exec, request.environment, readable);

  return {
    environment: request.environment,
    forms: forms.map((form) => ({
      formId: form.formId,
      slug: form.slug,
      title: titleOf(titles.get(form.formId)),
      releasedVersion: states.get(form.formId)?.version ?? null,
      closed: states.get(form.formId)?.closed ?? false,
      submitted: counts.get(form.formId)?.submitted ?? null,
      inProgress: counts.get(form.formId)?.inProgress ?? null,
    })),
  };
}

function titleOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return null;
  const first = Object.values(value as Record<string, unknown>).find(
    (entry) => typeof entry === "string",
  );
  return typeof first === "string" ? first : null;
}

export const responsePickerFacts = z.strictObject({
  environment: z.string(),
  forms: z.array(
    z.strictObject({ formId: z.string(), slug: z.string(), title: z.string().nullable() }),
  ),
});

async function buildResponsePicker(
  input: ScreenBuildInput,
): Promise<z.infer<typeof responsePickerFacts>> {
  const workspaceIds = await operationalWorkspaces(input);
  const exec = input.deps.databases.control;
  const forms = await listForms(exec, { workspaceIds });
  const allowed: typeof forms = [];
  for (const form of forms) {
    const resolved = await membershipIn(input, form.workspaceId);
    const decision = decideAccess({
      memberRole: resolved.memberRole,
      grants: resolved.grants,
      request: {
        resource: "response",
        action: "read",
        environment: input.environment,
        formId: form.formId,
      },
    });
    if (decision.allowed) allowed.push(form);
    if (allowed.length >= FACT_ROW_LIMIT) break;
  }
  const titles = await publishedTitlesByForm(
    exec,
    allowed.map((form) => form.formId),
  );
  return {
    environment: input.environment,
    forms: allowed.map((form) => ({
      formId: form.formId,
      slug: form.slug,
      title: titleOf(titles.get(form.formId)),
    })),
  };
}

/** The tombstone list and the dead-letter queue are installation-wide operator state. */
function requireClaim(input: ScreenBuildInput): void {
  if (!input.principal.claim) {
    throw forbidden(
      "This screen is installation-wide operator state, so it needs the " +
        "installation-wide administrator claim. A workspace's own grants do not reach it.",
    );
  }
}

export const erasuresFacts = z.strictObject({
  erasures: z.array(
    z.strictObject({
      sessionId: z.string(),
      formId: z.string(),
      formVersion: z.number().int(),
      erasedAt: Instant,
      reason: z.string(),
    }),
  ),
});

async function buildErasures(input: ScreenBuildInput): Promise<z.infer<typeof erasuresFacts>> {
  requireClaim(input);
  const rows = await listTombstones(input.deps.databases.control, { limit: FACT_ROW_LIMIT });
  return {
    erasures: rows.map((row) => ({
      sessionId: row.sessionId,
      formId: row.formId,
      formVersion: row.formVersion,
      erasedAt: iso(row.erasedAt),
      reason: row.reason,
    })),
  };
}

export const deadLettersFacts = z.strictObject({
  deliveries: z.array(
    z.strictObject({
      deliveryId: z.string(),
      formId: z.string(),
      eventType: z.string(),
      url: z.string(),
      attempts: z.number().int(),
      deadLetteredAt: Instant,
      cancelledAt: Instant,
      nextAttemptAt: Instant,
    }),
  ),
});

async function buildDeadLetters(
  input: ScreenBuildInput,
): Promise<z.infer<typeof deadLettersFacts>> {
  requireClaim(input);
  const rows = await listDeadLetterDeliveries(input.deps.databases.control, FACT_ROW_LIMIT);
  return {
    deliveries: rows.map((row) => ({
      deliveryId: row.deliveryId,
      formId: row.formId,
      eventType: row.eventType,
      url: endpointUrlFor(row.url, "whole"),
      attempts: row.attempts,
      deadLetteredAt: iso(row.deadLetteredAt),
      cancelledAt: iso(row.cancelledAt),
      nextAttemptAt: iso(row.nextAttemptAt),
    })),
  };
}

export const operationsContexts = {
  operations: { facts: operationsFacts, build: buildOperations },
  responsePicker: { facts: responsePickerFacts, build: buildResponsePicker },
  erasures: { facts: erasuresFacts, build: buildErasures },
  deadLetters: { facts: deadLettersFacts, build: buildDeadLetters },
  responseList: { facts: responseListFacts, build: buildResponseList },
  responseDetail: { facts: responseDetailFacts, build: buildResponseDetail },
  formWebhooks: { facts: formWebhooksFacts, build: buildFormWebhooks },
} as const;

export { auditRefused };
