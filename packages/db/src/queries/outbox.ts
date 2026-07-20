import { and, asc, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";

import { outbox } from "../schema/index.js";
import type { Executor } from "./executor.js";

export type OutboxRow = typeof outbox.$inferSelect;

/**
 * Exponential-backoff schedule for outbox delivery retries (`ARCHITECTURE.md`
 * §5.3). The delay before the retry that follows the N-th failed attempt is
 * `base * factor^(N-1)`, capped at `cap`. A row is dead-lettered once it has
 * reached {@link OUTBOX_MAX_ATTEMPTS} failed attempts.
 *
 * With the constants below the schedule is (attempt → delay-to-next):
 *
 * | failed attempts | delay before next attempt |
 * | --------------- | ------------------------- |
 * | 1               | 1m                        |
 * | 2               | 5m                        |
 * | 3               | 25m                       |
 * | 4               | 2h 5m (125m)              |
 * | 5               | 6h (capped from 10h 25m)  |
 * | 6–9             | 6h (capped)               |
 * | 10              | dead-lettered - no retry  |
 */
export const OUTBOX_BACKOFF_BASE_MS = 60_000;
/** Geometric growth factor between attempts. */
export const OUTBOX_BACKOFF_FACTOR = 5;
/** Maximum delay between attempts (6 hours). */
export const OUTBOX_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
/** After this many failed attempts a row is dead-lettered (no further retries). */
export const OUTBOX_MAX_ATTEMPTS = 10;

/** The backoff delay (ms) applied after the `attempts`-th failure (`attempts >= 1`). */
export function backoffDelayMs(attempts: number): number {
  const raw = OUTBOX_BACKOFF_BASE_MS * OUTBOX_BACKOFF_FACTOR ** (attempts - 1);
  return Math.min(raw, OUTBOX_BACKOFF_CAP_MS);
}

/**
 * The delivery-state update for the `attempts`-th failure, computed from a
 * reference time `from`: when the next attempt is due and whether the row has
 * now exhausted its retries. The single source of truth shared by
 * {@link recordFailure} and its unit tests.
 */
export function computeBackoff(
  attempts: number,
  from: Date,
): { nextAttemptAt: Date; deadLetteredAt: Date | null } {
  return {
    nextAttemptAt: new Date(from.getTime() + backoffDelayMs(attempts)),
    deadLetteredAt: attempts >= OUTBOX_MAX_ATTEMPTS ? from : null,
  };
}

/**
 * Enqueue a domain event. **Must be called inside the caller's transaction** -
 * the transactional-outbox contract (`ARCHITECTURE.md` §5.3): the event is
 * written in the same transaction as the state change it describes, so the two
 * commit or roll back together. At-least-once, never best-effort.
 */
export async function enqueue(
  exec: Executor,
  event: { eventType: string; payload: unknown },
): Promise<OutboxRow> {
  const [row] = await exec
    .insert(outbox)
    .values({ eventType: event.eventType, payload: event.payload })
    .returning();
  return row!;
}

/**
 * Claim up to `limit` outbox rows that are due for delivery - undelivered, live
 * (not dead-lettered), and past their `next_attempt_at`. Uses
 * `FOR UPDATE SKIP LOCKED` so concurrent deliverers never claim the same row:
 * each claimer locks its rows and the others skip them.
 *
 * **Must be called inside the caller's transaction**, which holds the row locks
 * while the events are delivered and their outcome recorded (via
 * {@link markDelivered} / {@link recordFailure}) before commit - that is what
 * makes the claim exclusive across concurrent deliverers.
 */
export async function claimDue(exec: Executor, limit: number, now?: Date): Promise<OutboxRow[]> {
  const at = now ?? new Date();
  return exec
    .select()
    .from(outbox)
    .where(
      and(isNull(outbox.deliveredAt), isNull(outbox.deadLetteredAt), lte(outbox.nextAttemptAt, at)),
    )
    .orderBy(asc(outbox.nextAttemptAt))
    .limit(limit)
    .for("update", { skipLocked: true });
}

/** Mark an outbox row delivered. Returns the updated row, or `undefined` if absent. */
export async function markDelivered(
  exec: Executor,
  id: string,
  now?: Date,
): Promise<OutboxRow | undefined> {
  const [row] = await exec
    .update(outbox)
    .set({ deliveredAt: now ?? new Date() })
    .where(eq(outbox.id, id))
    .returning();
  return row;
}

/**
 * Record a failed delivery attempt: increment `attempts`, store `lastError`,
 * schedule the next attempt via {@link computeBackoff}, and dead-letter the row
 * once it has reached {@link OUTBOX_MAX_ATTEMPTS}. Runs the read-modify-write
 * under `FOR UPDATE` in a (possibly nested) transaction so concurrent failures
 * on the same row cannot lose an increment. Returns the updated row, or
 * `undefined` if the row is absent.
 */
export async function recordFailure(
  exec: Executor,
  id: string,
  error: string,
  now?: Date,
): Promise<OutboxRow | undefined> {
  const from = now ?? new Date();
  return exec.transaction(async (tx) => {
    const [current] = await tx
      .select({ attempts: outbox.attempts })
      .from(outbox)
      .where(eq(outbox.id, id))
      .for("update");
    if (!current) return undefined;
    const attempts = current.attempts + 1;
    const { nextAttemptAt, deadLetteredAt } = computeBackoff(attempts, from);
    const [row] = await tx
      .update(outbox)
      .set({ attempts, lastError: error, nextAttemptAt, deadLetteredAt })
      .where(eq(outbox.id, id))
      .returning();
    return row;
  });
}

/** List dead-lettered rows (delivery exhausted) for the admin redelivery view, newest first. */
export async function listDeadLetters(exec: Executor, limit?: number): Promise<OutboxRow[]> {
  const base = exec
    .select()
    .from(outbox)
    .where(isNotNull(outbox.deadLetteredAt))
    .orderBy(desc(outbox.deadLetteredAt));
  return limit === undefined ? base : base.limit(limit);
}

/**
 * Reset a dead-lettered (or any) row for immediate redelivery - the admin
 * manual-redeliver action (§5.3): clear the dead-letter flag and delivery
 * timestamp, reset attempts, and make it due now.
 */
export async function resetForRedelivery(
  exec: Executor,
  id: string,
  now?: Date,
): Promise<OutboxRow | undefined> {
  const at = now ?? new Date();
  const [row] = await exec
    .update(outbox)
    .set({
      deadLetteredAt: null,
      deliveredAt: null,
      attempts: 0,
      nextAttemptAt: at,
      lastError: null,
    })
    .where(eq(outbox.id, id))
    .returning();
  return row;
}
