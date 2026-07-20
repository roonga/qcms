import { and, asc, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";

import { outbox, webhookDeliveries, webhooks } from "../schema/index.js";
import type { Executor } from "./executor.js";
import { computeBackoff } from "./outbox.js";

export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/**
 * One claimed, due delivery joined to everything the deliverer needs to POST it:
 * the outbox event (id, type, payload) and the target webhook (url, encrypted
 * secret). The secret stays opaque ciphertext at this layer — the API decrypts it
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
 * Materialize one fan-out target: insert a delivery row for `(outboxId,
 * webhookId)`, due at `now`. **Idempotent** — the `(outbox_id, webhook_id)` unique
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
 * Claim up to `limit` delivery rows that are due — undelivered, live (not
 * dead-lettered), past `next_attempt_at` — joined to their outbox event and
 * webhook. Uses `FOR UPDATE OF webhook_deliveries SKIP LOCKED` so concurrent
 * deliverers never claim the same delivery: each locks its rows and the others
 * skip them (locking *only* the delivery rows, not the shared event/webhook rows).
 *
 * **Must be called inside the caller's transaction**, which holds the locks while
 * the requests are POSTed and their outcome recorded (via
 * {@link markDeliveryDelivered} / {@link recordDeliveryFailure}) before commit —
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

/** Mark a delivery delivered. Returns the updated row, or `undefined` if absent. */
export async function markDeliveryDelivered(
  exec: Executor,
  id: string,
  now?: Date,
): Promise<DeliveryRow | undefined> {
  const [row] = await exec
    .update(webhookDeliveries)
    .set({ deliveredAt: now ?? new Date() })
    .where(eq(webhookDeliveries.id, id))
    .returning();
  return row;
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
      .set({ attempts, lastError: error, nextAttemptAt, deadLetteredAt })
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
 * Reset a dead-lettered (or any) delivery for immediate redelivery — the admin
 * manual-redeliver action (§5.3): clear the dead-letter flag and delivery
 * timestamp, reset attempts, and make it due now. Returns the updated row, or
 * `undefined` when no such delivery exists.
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
    })
    .where(eq(webhookDeliveries.id, id))
    .returning();
  return row;
}
