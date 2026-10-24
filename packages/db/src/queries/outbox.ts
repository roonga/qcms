import { and, asc, desc, eq, isNotNull, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";

import { dataSchemaName, outbox, webhookDeliveries } from "../schema/index.js";
import type { Executor } from "./executor.js";

export type OutboxRow = typeof outbox.$inferSelect;

/** Retry backoff for outbox delivery: the delay is `base * factor^(attempts-1)`. */
export const OUTBOX_BACKOFF_BASE_MS = 60_000;
export const OUTBOX_BACKOFF_FACTOR = 5;
/** The ceiling on that delay. */
export const OUTBOX_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
/** Failures after which a row is dead-lettered and no longer retried. */
export const OUTBOX_MAX_ATTEMPTS = 10;

/** The backoff delay in ms after the `attempts`-th failure (`attempts >= 1`). */
export function backoffDelayMs(attempts: number): number {
  const raw = OUTBOX_BACKOFF_BASE_MS * OUTBOX_BACKOFF_FACTOR ** (attempts - 1);
  return Math.min(raw, OUTBOX_BACKOFF_CAP_MS);
}

/** When the next attempt is due, and whether the row has exhausted its retries. */
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
 * Enqueue a domain event. Call inside the caller's transaction, so the event and the
 * state change it describes commit or roll back together.
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
 * Enqueue a domain event into another environment's outbox, from the control pool, for a
 * release that must commit its record and its event in one transaction.
 *
 * The only helper naming a data schema explicitly; `src/environment/sql.test.ts` allows
 * the exception by file name. No `RETURNING`: `qcms_app_control` holds `INSERT` and no
 * `SELECT` there, and widening that would let an authoring credential read answers.
 */
export async function enqueueInEnvironment(
  exec: Executor,
  environment: string,
  event: { eventType: string; payload: unknown },
): Promise<void> {
  await exec.execute(sql`
    insert into ${sql.identifier(dataSchemaName(environment))}.${sql.identifier("outbox")}
      ("event_type", "payload")
    values (${event.eventType}, ${JSON.stringify(event.payload)}::jsonb)
  `);
}

/**
 * Claim up to `limit` due outbox rows. Call inside the caller's transaction, which holds
 * the locks until the outcome is recorded; that is what makes the claim exclusive.
 *
 * Redacted rows are never claimed, so an event whose answers were removed is never fanned
 * out into delivery rows that would read "pending" forever.
 */
export async function claimDue(exec: Executor, limit: number, now?: Date): Promise<OutboxRow[]> {
  const at = now ?? new Date();
  return exec
    .select()
    .from(outbox)
    .where(
      and(
        isNull(outbox.deliveredAt),
        isNull(outbox.deadLetteredAt),
        isNull(outbox.payloadRedactedAt),
        lte(outbox.nextAttemptAt, at),
      ),
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
 * Record a failed delivery attempt, reschedule it, and dead-letter the row at
 * {@link OUTBOX_MAX_ATTEMPTS}.
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

/**
 * How long a settled event's payload is kept, from the moment the event and its whole
 * fan-out stopped moving. Past it the stored `answers` are a second copy of a
 * respondent's answers that only a redelivery could ever read.
 */
export const DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Shared with erasure so the two cannot disagree about what "redacted" writes and the
 * `outbox_redacted_payload_has_no_answers` CHECK holds for both.
 */
export function outboxPayloadRedactionColumns() {
  return {
    payload: sql`${outbox.payload} - 'answers'`,
    payloadRedactedAt: sql`now()`,
  };
}

// Relies on `greatest` ignoring NULLs and being NULL only when every argument is, so a
// row still in flight comes back NULL.
const COMMA = sql`, `;
function settledAt(...columns: PgColumn[]) {
  return sql`greatest(${sql.join(columns, COMMA)})`;
}

/**
 * How many candidate rows the sweep names explicitly before it falls back to one
 * statement. Postgres cannot use the partial expression index's statistics for the
 * `greatest(...) < $1` predicate, so it overestimates the candidate count and
 * hash-anti-joins the whole `webhook_deliveries` table (issue #781).
 */
export const ANTI_JOIN_CANDIDATE_BUDGET = 10_000;

/** Outcome of {@link redactAgedOutboxPayloads}. */
export interface OutboxPayloadRedactionResult {
  readonly redactedCount: number;
}

/**
 * Remove the `answers` member from every outbox payload whose event, and whose whole
 * fan-out, settled strictly before `olderThan`. Idempotent; the API owns the scheduling.
 *
 * Both halves of "settled" are load bearing: redacting an unconsumed event would silently
 * drop a submission that never went anywhere, and redacting under a delivery still moving
 * would leave it reading "pending" forever while nothing ever sends it.
 */
export async function redactAgedOutboxPayloads(
  exec: Executor,
  olderThan: Date,
): Promise<OutboxPayloadRedactionResult> {
  // One more than the budget, so "at the budget" and "past it" are distinguishable
  // without counting the whole backlog.
  const candidates = await exec
    .select({ id: outbox.id })
    .from(outbox)
    .where(eligibleForPayloadRedaction(olderThan))
    .limit(ANTI_JOIN_CANDIDATE_BUDGET + 1);

  if (candidates.length === 0) return { redactedCount: 0 };

  const withinBudget = candidates.length <= ANTI_JOIN_CANDIDATE_BUDGET;
  const rows = await exec
    .update(outbox)
    .set(outboxPayloadRedactionColumns())
    .where(
      and(
        // The other conjuncts are repeated rather than trusted, so a row that changed
        // between the two statements is re-decided here. `sql.param` binds the list as
        // one array parameter; interpolating it expands to one placeholder per element.
        withinBudget
          ? sql`${outbox.id} = any(${sql.param(candidates.map((row) => row.id))}::uuid[])`
          : undefined,
        eligibleForPayloadRedaction(olderThan),
        noDeliveryStillMoving(exec, olderThan),
      ),
    )
    .returning({ id: outbox.id });
  return { redactedCount: rows.length };
}

// Shared by the probe and the update so the two cannot select different rows.
function eligibleForPayloadRedaction(olderThan: Date) {
  return and(
    isNull(outbox.payloadRedactedAt),
    sql`jsonb_exists(${outbox.payload}, 'answers')`,
    sql`${settledAt(outbox.deliveredAt, outbox.deadLetteredAt)} < ${olderThan}`,
  );
}

function noDeliveryStillMoving(exec: Executor, olderThan: Date) {
  const deliveries = alias(webhookDeliveries, "d");
  const deliverySettled = settledAt(
    deliveries.deliveredAt,
    deliveries.deadLetteredAt,
    deliveries.cancelledAt,
  );
  return notExists(
    exec
      .select({ one: sql`1` })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.outboxId, outbox.id),
          // `or()` for the parentheses: one raw `sql` fragment binds as
          // `(outbox_id = id and settled is null) or settled >= horizon` and drops the
          // correlation, so any recently-settled delivery blocks the whole sweep.
          or(sql`${deliverySettled} is null`, sql`${deliverySettled} >= ${olderThan}`),
        ),
      ),
  );
}

/** List dead-lettered rows for the admin redelivery view, newest first. */
export async function listDeadLetters(exec: Executor, limit?: number): Promise<OutboxRow[]> {
  const base = exec
    .select()
    .from(outbox)
    .where(isNotNull(outbox.deadLetteredAt))
    .orderBy(desc(outbox.deadLetteredAt));
  return limit === undefined ? base : base.limit(limit);
}

/** Why an outbox event may not be redelivered: its `answers` have been removed. */
export type OutboxRedeliveryRefusal = "payloadRedacted";

/**
 * Why this outbox event may not be redelivered, or `undefined` when it may and when it
 * does not exist, which {@link resetForRedelivery} reports instead.
 *
 * Not form-scoped, because `outbox` carries no form column: an untrusted client-supplied
 * id must go through the delivery-level path instead.
 */
export async function outboxRedeliveryRefusalFor(
  exec: Executor,
  id: string,
): Promise<OutboxRedeliveryRefusal | undefined> {
  const [row] = await exec
    .select({ payloadRedactedAt: outbox.payloadRedactedAt })
    .from(outbox)
    .where(eq(outbox.id, id))
    .limit(1);
  if (row === undefined) return undefined;
  if (row.payloadRedactedAt !== null) return "payloadRedacted";
  return undefined;
}

/**
 * Reset a row for immediate redelivery. A redacted row matches nothing and is left as it
 * was: resetting one would strand the event, since {@link claimDue} declines to claim it
 * on the same column. The guard is in the `where` because this export has no in-repo
 * caller to enforce the check-first ordering.
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
    .where(and(eq(outbox.id, id), isNull(outbox.payloadRedactedAt)))
    .returning();
  return row;
}
