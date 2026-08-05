import { and, asc, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";

import type { FormId } from "@qcms/core";

import { erasureTombstones, outbox, webhookDeliveries, webhooks } from "../schema/index.js";
import type { Executor } from "./executor.js";
import { computeBackoff } from "./outbox.js";

export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/**
 * One claimed, due delivery joined to everything the deliverer needs to POST it:
 * the outbox event (id, type, payload) and the target webhook (url, encrypted
 * secret). The secret stays opaque ciphertext at this layer - the API decrypts it
 * under `QCMS_APP_KEY` at signing time (SEC-6).
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

/**
 * A dead-lettered delivery for the admin dead-letters view, joined to its event
 * type and target url so an operator can see *what* failed to reach *where*, with
 * the last error and attempt count (attempt history).
 */
export interface DeadLetterDelivery {
  readonly deliveryId: string;
  readonly outboxId: string;
  readonly eventType: string;
  readonly webhookId: string;
  readonly url: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly nextAttemptAt: Date;
  readonly deadLetteredAt: Date | null;
  readonly createdAt: Date;
}

/**
 * What one delivery attempt actually did, recorded on the row by the deliverer.
 *
 * Written on **every** attempt, success or failure, because the operator question
 * the dashboard answers ("what went over the wire, and what came back") is the same
 * either way. `lastStatus` is null when the attempt never got a response at all - a
 * timeout, a network error, an SSRF rejection, a secret that would not decrypt - and
 * `lastError` (set by {@link recordDeliveryFailure}) then names which.
 *
 * `lastRequestHeaders` arrives with the signature already masked. This layer does
 * not mask it: the deliverer does, so the HMAC never reaches the database at all.
 */
export interface DeliveryAttemptRecord {
  readonly lastAttemptAt: Date;
  readonly lastStatus: number | null;
  readonly lastLatencyMs: number;
  readonly lastRequestHeaders: Record<string, string> | null;
  readonly lastResponseSnippet: string | null;
}

/**
 * One delivery in the operator dashboard: lifecycle plus the last attempt record,
 * joined to its event and target. `listRecentDeliveries` returns these.
 */
export interface DeliveryView extends DeadLetterDelivery {
  readonly deliveredAt: Date | null;
  readonly lastAttemptAt: Date | null;
  readonly lastStatus: number | null;
  readonly lastLatencyMs: number | null;
  readonly lastRequestHeaders: Record<string, string> | null;
  readonly lastResponseSnippet: string | null;
}

/**
 * Materialize one fan-out target: insert a delivery row for `(outboxId,
 * webhookId)`, due at `now`. **Idempotent** - the `(outbox_id, webhook_id)` unique
 * key means a repeated materialize (or a concurrent deliverer) is a no-op via
 * `ON CONFLICT DO NOTHING`, so an event never double-fans-out.
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
 * Claim up to `limit` delivery rows that are due - undelivered, live (not
 * dead-lettered), past `next_attempt_at` - joined to their outbox event and
 * webhook. Uses `FOR UPDATE OF webhook_deliveries SKIP LOCKED` so concurrent
 * deliverers never claim the same delivery: each locks its rows and the others
 * skip them (locking *only* the delivery rows, not the shared event/webhook rows).
 *
 * **Must be called inside the caller's transaction**, which holds the locks while
 * the requests are POSTed and their outcome recorded (via
 * {@link markDeliveryDelivered} / {@link recordDeliveryFailure}) before commit -
 * that is what makes the claim exclusive across concurrent deliverers, and what
 * makes a crash between POST and commit roll back to a redeliverable state.
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
        lte(webhookDeliveries.nextAttemptAt, at),
      ),
    )
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(limit)
    .for("update", { of: webhookDeliveries, skipLocked: true });
}

/**
 * Mark a delivery delivered, recording the attempt that succeeded. Returns the
 * updated row, or `undefined` if absent.
 *
 * `attempts` is deliberately NOT incremented on success. It counts *failed*
 * attempts - that is what `computeBackoff` reads it as, and what the schedule table
 * in `outbox.ts` documents - so a first-time success leaves it at 0. The admin
 * dashboard therefore labels the column "failed attempts" rather than "attempts";
 * relabelling the column was the honest fix, redefining the counter would have
 * changed the retry schedule's input.
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

/** The `last_*` column set for one attempt record, shared by both outcome paths. */
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
 * Record a failed delivery attempt on one delivery row: increment `attempts`,
 * store `lastError`, schedule the next attempt via {@link computeBackoff} (the
 * *same* backoff schedule the outbox uses), and dead-letter the row once it has
 * reached the max attempts. Runs the read-modify-write under `FOR UPDATE` in a
 * (possibly nested) transaction so concurrent failures cannot lose an increment.
 * Returns the updated row, or `undefined` if the row is absent.
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
 * List dead-lettered deliveries (retries exhausted) for the admin redelivery
 * view, newest first, joined to event type and target url.
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
      url: webhooks.url,
      attempts: webhookDeliveries.attempts,
      lastError: webhookDeliveries.lastError,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      deadLetteredAt: webhookDeliveries.deadLetteredAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .innerJoin(outbox, eq(webhookDeliveries.outboxId, outbox.id))
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.webhookId))
    .where(isNotNull(webhookDeliveries.deadLetteredAt))
    .orderBy(desc(webhookDeliveries.deadLetteredAt));
  return limit === undefined ? base : base.limit(limit);
}

/**
 * Reset a dead-lettered (or any) delivery for immediate redelivery - the admin
 * manual-redeliver action (§5.3): clear the dead-letter flag and delivery
 * timestamp, reset attempts, and make it due now. Returns the updated row, or
 * `undefined` when no such delivery exists.
 *
 * The whole last-attempt record is cleared alongside `lastError`, not just the
 * error. Leaving a stale `last_status: 500` next to a cleared error would put two
 * contradictory statements about the same attempt on one screen; a redelivered row
 * has made no attempt since the reset, and reads that way until it makes one.
 */
export async function resetDeliveryForRedelivery(
  exec: Executor,
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
    })
    .where(eq(webhookDeliveries.id, id))
    .returning();
  return row;
}

/**
 * Whether the session a delivery would transmit has been erased (ADR-17).
 *
 * ## The gap this closes, and the much larger one it does not
 *
 * A `response.submitted` outbox row carries the respondent's **whole locked answer
 * set** in its payload. `eraseSession` deletes the `answers` and `submissions` rows
 * and writes a tombstone; it does not touch `outbox` or `webhook_deliveries`. So an
 * undelivered event for an erased session still holds that content, and anything
 * that reads the payload back can transmit it.
 *
 * This helper exists so the **manual redeliver** door can refuse: an operator
 * clearing a stuck queue must not be the reason an erased respondent's answers reach
 * a consumer. It is a read, and deliberately only a read - whether erasure should
 * purge or redact those rows is an ADR-17 amendment question for the Code Owner, and
 * it is escalated rather than decided here. Until it is answered, a **pending**
 * delivery for an erased session is still sent by the scheduler on its next pass, and
 * the erase dialog and `docs/erasure.md` now say so instead of promising otherwise.
 *
 * `false` when the delivery is unknown, when its payload carries no `sessionId`
 * (event types other than `response.submitted`), or when no tombstone exists.
 */
export async function deliveryTargetsErasedSession(
  exec: Executor,
  deliveryId: string,
): Promise<boolean> {
  const [event] = await exec
    .select({ sessionId: sql<string | null>`${outbox.payload} ->> 'sessionId'` })
    .from(webhookDeliveries)
    .innerJoin(outbox, eq(webhookDeliveries.outboxId, outbox.id))
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  const sessionId = event?.sessionId;
  if (sessionId === undefined || sessionId === null || sessionId === "") return false;

  const [tombstone] = await exec
    .select({ sessionId: erasureTombstones.sessionId })
    .from(erasureTombstones)
    .where(eq(erasureTombstones.sessionId, sql`${sessionId}`))
    .limit(1);
  return tombstone !== undefined;
}

/**
 * The most recent deliveries for one form's webhooks, newest first - the operator
 * dashboard's list (task 035).
 *
 * Scoped by form through the webhook, because that is how an author reaches the
 * screen (a form's own operations tab) and it keeps one form's delivery history out
 * of another's. Ordered by creation rather than by outcome so the list reads as a
 * timeline; the caller filters by status if it wants to.
 */
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
    })
    .from(webhookDeliveries)
    .innerJoin(outbox, eq(webhookDeliveries.outboxId, outbox.id))
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.webhookId))
    .where(eq(webhooks.formId, formId))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit);
}
