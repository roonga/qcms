import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import { outbox, webhookDeliveries, webhooks } from "../schema/index.js";
import type { Executor } from "./executor.js";
import { computeBackoff } from "./outbox.js";

export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/** A value-free code naming why a delivery will never be attempted. */
export const DELIVERY_CANCELLED_SESSION_ERASED = "session_erased";

/**
 * How long a stored response snippet is kept, from the attempt that produced it. It is a
 * consumer's response body verbatim, so it can carry respondent content echoed back.
 */
export const DEFAULT_RESPONSE_SNIPPET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Shared with erasure so the two cannot disagree about what "redacted" writes.
export function responseSnippetRedactionColumns() {
  return {
    lastResponseSnippet: null,
    lastResponseSnippetRedactedAt: sql`now()`,
  };
}

/** Outcome of {@link redactAgedResponseSnippets}. */
export interface SnippetRedactionResult {
  readonly redactedCount: number;
}

/**
 * Remove every stored response snippet whose attempt is strictly older than `olderThan`.
 * Idempotent; the API owns the scheduling.
 *
 * Relies on the `webhook_deliveries_snippet_requires_attempt` CHECK: a snippet with a
 * NULL `last_attempt_at` would never satisfy this predicate and so never be swept.
 */
export async function redactAgedResponseSnippets(
  exec: Executor,
  olderThan: Date,
): Promise<SnippetRedactionResult> {
  const rows = await exec
    .update(webhookDeliveries)
    .set(responseSnippetRedactionColumns())
    .where(
      and(
        isNotNull(webhookDeliveries.lastResponseSnippet),
        lt(webhookDeliveries.lastAttemptAt, olderThan),
      ),
    )
    .returning({ id: webhookDeliveries.id });
  return { redactedCount: rows.length };
}

/**
 * One claimed, due delivery joined to what the deliverer needs to POST it. The secret
 * stays opaque ciphertext here; the API decrypts it at signing time (SEC-6).
 */
export interface DueDelivery {
  readonly deliveryId: string;
  readonly attempts: number;
  readonly outboxId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly webhookId: string;
  readonly url: string;
  readonly secretEncrypted: string;
}

/** A dead-lettered delivery for the admin dead-letters view. */
export interface DeadLetterDelivery {
  readonly deliveryId: string;
  readonly outboxId: string;
  readonly eventType: string;
  readonly webhookId: string;
  /** Reached through the webhook: the worklist is cross-form, redelivery is not. */
  readonly formId: FormId;
  readonly url: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly nextAttemptAt: Date;
  readonly deadLetteredAt: Date | null;
  readonly createdAt: Date;
  /** Set when the delivery was terminally cancelled and will never be sent. */
  readonly cancelledAt: Date | null;
  readonly cancelledReason: string | null;
}

/**
 * What one delivery attempt did. `lastRequestHeaders` must arrive with the signature
 * already masked, so the HMAC never reaches the database.
 */
export interface DeliveryAttemptRecord {
  readonly lastAttemptAt: Date;
  readonly lastStatus: number | null;
  readonly lastLatencyMs: number;
  readonly lastRequestHeaders: Record<string, string> | null;
  readonly lastResponseSnippet: string | null;
}

/** One delivery in the operator dashboard: lifecycle plus the last attempt record. */
export interface DeliveryView extends DeadLetterDelivery {
  readonly deliveredAt: Date | null;
  readonly lastAttemptAt: Date | null;
  readonly lastStatus: number | null;
  readonly lastLatencyMs: number | null;
  readonly lastRequestHeaders: Record<string, string> | null;
  readonly lastResponseSnippet: string | null;
  /** Set when the snippet was removed, so a reader can tell that from an empty body. */
  readonly lastResponseSnippetRedactedAt: Date | null;
}

/**
 * Materialize one fan-out target, due at `now`. Idempotent through the
 * `(outbox_id, webhook_id)` unique key, so an event never double-fans-out.
 */
export async function insertDelivery(
  exec: Executor,
  input: { outboxId: string; webhookId: string },
  now?: Date,
): Promise<void> {
  await exec
    .insert(webhookDeliveries)
    .values({
      outboxId: input.outboxId,
      webhookId: input.webhookId,
      nextAttemptAt: now ?? new Date(),
    })
    .onConflictDoNothing({
      target: [webhookDeliveries.outboxId, webhookDeliveries.webhookId],
    });
}

/**
 * Claim up to `limit` due delivery rows, joined to what the deliverer needs.
 *
 * Must be called inside the caller's transaction, which holds the locks until the outcome
 * is recorded: that is what makes the claim exclusive and what makes a crash between POST
 * and commit roll back to a redeliverable state.
 *
 * The two null predicates keep an erased respondent's answers off the transport whatever
 * a caller does.
 */
export async function claimDueDeliveries(
  exec: Executor,
  limit: number,
  now?: Date,
): Promise<DueDelivery[]> {
  const at = now ?? new Date();
  return exec
    .select({
      deliveryId: webhookDeliveries.id,
      attempts: webhookDeliveries.attempts,
      outboxId: outbox.id,
      eventType: outbox.eventType,
      payload: outbox.payload,
      webhookId: webhooks.webhookId,
      url: webhooks.url,
      secretEncrypted: webhooks.secretEncrypted,
    })
    .from(webhookDeliveries)
    .innerJoin(outbox, eq(webhookDeliveries.outboxId, outbox.id))
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.webhookId))
    .where(
      and(
        isNull(webhookDeliveries.deliveredAt),
        isNull(webhookDeliveries.deadLetteredAt),
        isNull(webhookDeliveries.cancelledAt),
        isNull(outbox.payloadRedactedAt),
        lte(webhookDeliveries.nextAttemptAt, at),
      ),
    )
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(limit)
    .for("update", { of: webhookDeliveries, skipLocked: true });
}

/**
 * Mark a delivery delivered, recording the attempt that succeeded. `attempts` is not
 * incremented: it counts failed attempts, which is what `computeBackoff` reads it as.
 */
export async function markDeliveryDelivered(
  exec: Executor,
  id: string,
  now?: Date,
  attempt?: DeliveryAttemptRecord,
): Promise<DeliveryRow | undefined> {
  const [row] = await exec
    .update(webhookDeliveries)
    .set({
      deliveredAt: now ?? new Date(),
      ...(attempt === undefined ? {} : attemptColumns(attempt)),
    })
    .where(eq(webhookDeliveries.id, id))
    .returning();
  return row;
}

function attemptColumns(attempt: DeliveryAttemptRecord) {
  return {
    lastAttemptAt: attempt.lastAttemptAt,
    lastStatus: attempt.lastStatus,
    lastLatencyMs: attempt.lastLatencyMs,
    lastRequestHeaders: attempt.lastRequestHeaders,
    lastResponseSnippet: attempt.lastResponseSnippet,
  };
}

/**
 * Record a failed delivery attempt, reschedule it, and dead-letter the row once it
 * reaches the max attempts.
 */
export async function recordDeliveryFailure(
  exec: Executor,
  id: string,
  error: string,
  now?: Date,
  attempt?: DeliveryAttemptRecord,
): Promise<DeliveryRow | undefined> {
  const from = now ?? new Date();
  return exec.transaction(async (tx) => {
    const [current] = await tx
      .select({ attempts: webhookDeliveries.attempts })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id))
      .for("update");
    if (!current) return undefined;
    const attempts = current.attempts + 1;
    const { nextAttemptAt, deadLetteredAt } = computeBackoff(attempts, from);
    const [row] = await tx
      .update(webhookDeliveries)
      .set({
        attempts,
        lastError: error,
        nextAttemptAt,
        deadLetteredAt,
        ...(attempt === undefined ? {} : attemptColumns(attempt)),
      })
      .where(eq(webhookDeliveries.id, id))
      .returning();
    return row;
  });
}

/**
 * List dead-lettered deliveries for the admin redelivery view, newest first. Cancelled
 * and payload-redacted rows are excluded, because nothing may ever send them.
 */
export async function listDeadLetterDeliveries(
  exec: Executor,
  limit?: number,
): Promise<DeadLetterDelivery[]> {
  const base = exec
    .select({
      deliveryId: webhookDeliveries.id,
      outboxId: webhookDeliveries.outboxId,
      eventType: outbox.eventType,
      webhookId: webhookDeliveries.webhookId,
      formId: webhooks.formId,
      url: webhooks.url,
      attempts: webhookDeliveries.attempts,
      lastError: webhookDeliveries.lastError,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      deadLetteredAt: webhookDeliveries.deadLetteredAt,
      createdAt: webhookDeliveries.createdAt,
      cancelledAt: webhookDeliveries.cancelledAt,
      cancelledReason: webhookDeliveries.cancelledReason,
    })
    .from(webhookDeliveries)
    .innerJoin(outbox, eq(webhookDeliveries.outboxId, outbox.id))
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.webhookId))
    .where(
      and(
        isNotNull(webhookDeliveries.deadLetteredAt),
        isNull(webhookDeliveries.cancelledAt),
        isNull(outbox.payloadRedactedAt),
      ),
    )
    .orderBy(desc(webhookDeliveries.deadLetteredAt));
  return limit === undefined ? base : base.limit(limit);
}

// A predicate rather than a post-lookup check, so a cross-form delivery is a row the
// statement never matches. `webhooks.form_id` is the only durable link: the outbox has no
// form column and erasure redacts the one inside the payload.
function inFormScope(exec: Executor, formId: FormId) {
  return inArray(
    webhookDeliveries.webhookId,
    exec
      .select({ webhookId: webhooks.webhookId })
      .from(webhooks)
      .where(eq(webhooks.formId, formId)),
  );
}

/**
 * Reset a delivery for immediate redelivery. Form-scoped, so another form's delivery
 * returns `undefined` exactly as an unknown id does.
 */
export async function resetDeliveryForRedelivery(
  exec: Executor,
  formId: FormId,
  id: string,
  now?: Date,
): Promise<DeliveryRow | undefined> {
  const at = now ?? new Date();
  const [row] = await exec
    .update(webhookDeliveries)
    .set({
      deadLetteredAt: null,
      deliveredAt: null,
      attempts: 0,
      nextAttemptAt: at,
      lastError: null,
      lastAttemptAt: null,
      lastStatus: null,
      lastLatencyMs: null,
      lastRequestHeaders: null,
      lastResponseSnippet: null,
      // Safe to clear: a cancelled row or redacted payload is refused by
      // `redeliveryRefusalFor` and filtered out of `claimDueDeliveries` anyway.
      lastResponseSnippetRedactedAt: null,
    })
    .where(and(eq(webhookDeliveries.id, id), inFormScope(exec, formId)))
    .returning();
  return row;
}

/** Why a delivery may not be redelivered. */
export type RedeliveryRefusal = "cancelled" | "payloadRedacted";

/**
 * Why this delivery may not be redelivered, or `undefined` when it may and when it does
 * not exist.
 *
 * Form-scoped, and not optionally so: this runs before the reset, so an unscoped read
 * would answer 409 where an unknown id answers 404 and disclose that another form's
 * delivery exists and what state it is in.
 */
export async function redeliveryRefusalFor(
  exec: Executor,
  formId: FormId,
  deliveryId: string,
): Promise<RedeliveryRefusal | undefined> {
  const [row] = await exec
    .select({
      cancelledAt: webhookDeliveries.cancelledAt,
      payloadRedactedAt: outbox.payloadRedactedAt,
    })
    .from(webhookDeliveries)
    .innerJoin(outbox, eq(webhookDeliveries.outboxId, outbox.id))
    .where(and(eq(webhookDeliveries.id, deliveryId), inFormScope(exec, formId)))
    .limit(1);
  if (row === undefined) return undefined;
  if (row.cancelledAt !== null) return "cancelled";
  if (row.payloadRedactedAt !== null) return "payloadRedacted";
  return undefined;
}

/** The most recent deliveries for one form's webhooks, newest first. */
export async function listRecentDeliveries(
  exec: Executor,
  formId: FormId,
  limit: number,
): Promise<DeliveryView[]> {
  return exec
    .select({
      deliveryId: webhookDeliveries.id,
      outboxId: webhookDeliveries.outboxId,
      eventType: outbox.eventType,
      webhookId: webhookDeliveries.webhookId,
      formId: webhooks.formId,
      url: webhooks.url,
      attempts: webhookDeliveries.attempts,
      lastError: webhookDeliveries.lastError,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      deadLetteredAt: webhookDeliveries.deadLetteredAt,
      createdAt: webhookDeliveries.createdAt,
      lastAttemptAt: webhookDeliveries.lastAttemptAt,
      lastStatus: webhookDeliveries.lastStatus,
      lastLatencyMs: webhookDeliveries.lastLatencyMs,
      lastRequestHeaders: webhookDeliveries.lastRequestHeaders,
      lastResponseSnippet: webhookDeliveries.lastResponseSnippet,
      lastResponseSnippetRedactedAt: webhookDeliveries.lastResponseSnippetRedactedAt,
      cancelledAt: webhookDeliveries.cancelledAt,
      cancelledReason: webhookDeliveries.cancelledReason,
    })
    .from(webhookDeliveries)
    .innerJoin(outbox, eq(webhookDeliveries.outboxId, outbox.id))
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.webhookId))
    .where(eq(webhooks.formId, formId))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit);
}
