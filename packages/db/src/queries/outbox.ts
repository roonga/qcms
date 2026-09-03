import { and, asc, desc, eq, isNotNull, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";

import { outbox, webhookDeliveries } from "../schema/index.js";
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
 *
 * **Redacted rows are never claimed** (ADR-17 amendment, task 059). This is the
 * deliverer's *materialize* phase, so filtering here means an event whose answers
 * have been removed is not fanned out to `webhook_deliveries` in the first place -
 * the alternative is delivery rows that read "pending" on the operator dashboard
 * forever while `claimDueDeliveries` silently declines to send them. A redacted,
 * unconsumed row simply stops moving; it is retained as the audit record of an
 * event that existed and never left.
 *
 * Only erasure can produce that state: {@link redactAgedOutboxPayloads} never
 * touches an unconsumed row, precisely so retention can never strand a queue.
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

/**
 * How long a settled event's payload is kept by default: **30 days** from the moment
 * the event and its whole fan-out stopped moving (issue #329).
 *
 * The window is derived from what the payload is *for*, not picked as a round
 * number. Once an event is consumed and every delivery of it has been delivered,
 * dead-lettered or cancelled, the stored `answers` member answers exactly one
 * remaining question: "re-send it". So its justification expires with that
 * capability rather than on a date somebody chose. A delivery exhausts its retries
 * in a little over a day (`OUTBOX_BACKOFF_*`, 10 attempts, 6h cap), so 30 days
 * leaves a month of Mondays for an operator to notice a dead letter, fix the
 * consumer and press Redeliver; after that the row is a second full copy of a
 * respondent's answers, held next to the answer ledger, that nothing will ever read.
 *
 * **What ageing out costs is deliberately small.** The envelope stays
 * (`sessionId`, `formId`, `formVersion`, `submittedAt`, `contentHash`) along with
 * `event_type` and the whole delivery record, so the audit answer - "this event
 * existed, and here is where it went and whether it arrived" - survives in full.
 * Only the answers go.
 */
export const DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The column pair that drops a payload's answers and records that they were
 * dropped. Shared by the two producers - erasure in `erasure.ts` and the retention
 * sweep here - so the two can never disagree about what "redacted" writes, and so
 * the `outbox_redacted_payload_has_no_answers` CHECK is satisfied by construction
 * rather than by each caller remembering both halves.
 *
 * Not re-exported from the package: it is an internal spelling, and the public
 * surface is the two operations, not the columns they set.
 */
export function outboxPayloadRedactionColumns() {
  return {
    payload: sql`${outbox.payload} - 'answers'`,
    // `now()` is the transaction timestamp, so a redaction that runs beside other
    // writes (erasure's tombstone, say) names the same instant they do.
    payloadRedactedAt: sql`now()`,
  };
}

/**
 * When a row stopped moving, or NULL while it is still in flight. Postgres'
 * `greatest` ignores NULL arguments and is NULL only when all of them are, which is
 * exactly the reading wanted here: at most one of these timestamps is set on a real
 * row (a reset clears the others), and a row with none set is still live.
 */
const COMMA = sql`, `;
function settledAt(...columns: PgColumn[]) {
  return sql`greatest(${sql.join(columns, COMMA)})`;
}

/**
 * How many candidate rows the sweep will name explicitly before it stops trying
 * (issue #781).
 *
 * ## The problem
 *
 * #434 gave the sweep a partial index, which removed its own table scan and left one
 * behind: the correlated `NOT EXISTS` was still costed as though it had to consider
 * every outbox row, so Postgres hash-anti-joined the WHOLE `webhook_deliveries` table
 * on every hourly pass. Measured on `postgres:16-alpine` at 1M outbox rows and 1M
 * deliveries, with a horizon selecting 598 eligible rows: the index scan that finds
 * those 598 takes **0.4 ms**, and the pass takes **77.6 ms**, of which ~69 ms per
 * worker is a parallel sequential scan of all 1M deliveries that yields nothing.
 *
 * The cause is a row-estimate failure, not a missing index. Postgres does not apply
 * the partial expression index's statistics to `greatest(delivered_at,
 * dead_lettered_at) < $1`, so it falls back to a default selectivity and estimates
 * ~111k candidates where there are 598. At that estimate the hash plan is the cheaper
 * one, and it is chosen correctly from a premise that is 200x wrong. No index fixes
 * an estimate, which is why #434 could not close this and why it needed a query.
 *
 * ## Why an explicit id list, and why a budget
 *
 * Naming the candidates gives the planner a cardinality it cannot get wrong, so it
 * picks the nested loop over `webhook_deliveries_event_webhook_uq` - the index that
 * table already had - and probes it once per candidate instead of reading it whole.
 *
 * That is only the better plan while the candidate set is small, and the crossover was
 * measured rather than guessed. Selecting the candidates only, so the write cost the
 * two share does not bury the difference (median of 7 runs, round trip):
 *
 * | eligible rows | one statement | probe then update |
 * | ------------- | ------------- | ----------------- |
 * | 598           | 77.6 ms       | **5.0 ms**        |
 * | 11,246        | 105.6 ms      | **44.4 ms**       |
 * | 33,469        | 130.4 ms      | 132.6 ms          |
 * | 100,136       | 280.5 ms      | 467.6 ms          |
 * | 300,137       | 355.4 ms      | 1,446.4 ms        |
 *
 * And the whole sweep end to end, old shape against new, alternating in rolled-back
 * transactions so page dirtying hits both equally, with both redacting an identical
 * row set every time:
 *
 * | eligible rows | before     | after       |
 * | ------------- | ---------- | ----------- |
 * | 702           | 278.8 ms   | **33.6 ms** |
 * | 1,258         | 330.7 ms   | **82.3 ms** |
 * | 5,186         | 532.6 ms   | **273.0 ms** |
 * | 15,704        | 1,766.7 ms | 1,786.9 ms  |
 *
 * The last row is above the budget, so it is the old plan plus the bounded probe: 20
 * ms, or 1.1%, for the certainty of not paying the other column's price. Past roughly
 * 33k candidates the sequential scan amortises and the single statement wins outright,
 * which is the right plan for a backlog - the first pass after an upgrade covers the
 * entire back catalogue, and reading the deliveries table once beats probing it a
 * million times.
 *
 * The budget also bounds what the probe can pull into memory, which an unbounded
 * candidate list would not.
 */
const ANTI_JOIN_CANDIDATE_BUDGET = 10_000;

/** Outcome of {@link redactAgedOutboxPayloads}. */
export interface OutboxPayloadRedactionResult {
  /** How many outbox rows had their answers removed this run. */
  readonly redactedCount: number;
}

/**
 * Remove the `answers` member from every outbox payload whose event, and whose whole
 * fan-out, settled before `olderThan` (issue #329). The time-based half of the
 * payload's retention story; erasure is the on-request half.
 *
 * `outbox.payload` for a `response.submitted` event is the respondent's **whole
 * locked answer set**. Task 059 made erasure reach that copy, but erasure is a
 * request somebody has to make: for every response ever submitted without one, the
 * answers sat in plaintext `jsonb` indefinitely, a second copy beside the ledger and
 * outside whatever retention policy the operator believed they had configured. This
 * is the control for the ordinary case.
 *
 * Run by the API's existing retention-sweep scheduler rather than by one of its own.
 * The scheduling is the API's job (the same split `sweepExpiredSessions` uses); what
 * lives here is which rows and where the boundary is.
 *
 * ## What "settled" means, and why it is not just `delivered_at`
 *
 * Both halves are load bearing:
 *
 * - **The event itself** must have stopped moving: consumed by the materialize pass
 *   (`delivered_at`) or dead-lettered. An unconsumed event still has to be fanned
 *   out, and redacting one would silently drop a submission that never went
 *   anywhere - a stuck queue is an operations problem, not a retention one.
 * - **Every delivery of it** must have stopped moving too: delivered, dead-lettered
 *   or cancelled, and settled before the same horizon. A delivery still pending is
 *   one `claimDueDeliveries` is about to send, and that claim joins this payload and
 *   skips redacted rows - so redacting under a live delivery would leave it reading
 *   "pending" on the dashboard forever while nothing ever sends it. The clock also
 *   restarts from a manual redelivery, because that is the capability the window
 *   exists to cover.
 *
 * Only rows that actually hold answers are touched, so the marker records a real
 * removal and never lands on an event type that never carried any (`form.published`).
 * Idempotent: a second run finds nothing left with answers in that window, and the
 * `payload_redacted_at is null` filter keeps a re-run from moving an existing stamp.
 *
 * ## Why this needs no backfill migration
 *
 * The predicate is over `delivered_at`, `dead_lettered_at` and `cancelled_at` -
 * columns every row already carries, written long before this control existed - so a
 * row from years back is *more* eligible than one written today, and the first sweep
 * after an upgrade covers the entire back catalogue. That is precisely the data the
 * issue is about. A control that only governed rows created after it shipped would
 * have left it. (`redactAgedResponseSnippets` reached the same conclusion for the
 * same reason; the test that proves it here seeds a row that predates the control.)
 *
 * Boundary: strictly-before `olderThan`, matching `purgeExpired` and
 * `redactAgedResponseSnippets`.
 */
export async function redactAgedOutboxPayloads(
  exec: Executor,
  olderThan: Date,
): Promise<OutboxPayloadRedactionResult> {
  // Bounded by one more than the budget, so "at the budget" and "past it" are
  // distinguishable without counting the whole backlog.
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
        // Present only on the fast path. Every other conjunct is repeated from the
        // probe rather than trusted, so the two paths select exactly the same rows
        // and a row that changed between the two statements is re-decided here.
        // `sql.param` binds the whole list as ONE array parameter. Interpolating the
        // array directly makes Drizzle expand it into one placeholder per element,
        // which is a 10,000-parameter statement and hundreds of kilobytes of SQL for
        // the planner to parse - the opposite of the point.
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

/**
 * The outbox-side half of the sweep: rows that still hold answers and whose own event
 * settled before the horizon. Shared by the probe and the update so the two cannot
 * drift into selecting different rows.
 */
function eligibleForPayloadRedaction(olderThan: Date) {
  return and(
    isNull(outbox.payloadRedactedAt),
    sql`jsonb_exists(${outbox.payload}, 'answers')`,
    sql`${settledAt(outbox.deliveredAt, outbox.deadLetteredAt)} < ${olderThan}`,
  );
}

/** The delivery-side half: no delivery of this event is unsettled or freshly settled. */
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
          // Parenthesised by `or()`. Spelling this as one raw `sql` fragment
          // silently binds as `(outbox_id = id and settled is null) or settled
          // >= horizon`, which drops the correlation: any recently-settled
          // delivery anywhere in the table then blocks every row in the sweep.
          or(sql`${deliverySettled} is null`, sql`${deliverySettled} >= ${olderThan}`),
        ),
      ),
  );
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
 * Why an outbox event may not be redelivered, or `undefined` when it may.
 *
 * `"payloadRedacted"` - the event's `answers` have been removed, so there is nothing
 * left to send. Two producers write that state: erasure on request (`eraseSession`)
 * and the retention sweep once the redelivery window has closed
 * ({@link redactAgedOutboxPayloads}).
 *
 * A union of one today. It is a union rather than a boolean for the same reason its
 * delivery-level sibling `RedeliveryRefusal` is: the caller renders the reason, and
 * a second reason later is an added member rather than a changed return type. The
 * outbox has no `cancelled_at` of its own - cancellation lives on
 * `webhook_deliveries` - so that union's other member has no counterpart here.
 */
export type OutboxRedeliveryRefusal = "payloadRedacted";

/**
 * Whether this outbox event may be redelivered, and if not, why (issue #433).
 *
 * The outbox-level counterpart of `redeliveryRefusalFor` in `deliveries.ts`,
 * deliberately the same shape rather than a second idiom for the same concept: a
 * reason when the row exists and is refused, `undefined` when it may be redelivered
 * **and** when it does not exist, because {@link resetForRedelivery} is what reports
 * the not-found. So a caller distinguishes the three outcomes across the pair -
 * refusal here, absence there - exactly as `apps/api`'s redeliver handler already
 * does one level down:
 *
 * ```ts
 * if ((await outboxRedeliveryRefusalFor(db, id)) !== undefined) return conflict();
 * const reset = await resetForRedelivery(db, id);
 * if (reset === undefined) return notFound();
 * ```
 *
 * Expressed over *state* rather than over cause, like its sibling: it reads the one
 * column {@link claimDue} filters on, so the refusal an operator is given and the
 * filter the deliverer applies are one rule stated in the two places it has to hold.
 * A future producer of `payload_redacted_at` is refused for free.
 *
 * Not form-scoped, because the outbox is not form-scoped: `outbox` carries no
 * `form_id` column and reaches a form only through the payload, which is the member
 * redaction removes. That is why the delivery-level path (#305) is the one an
 * untrusted client-supplied id reaches; this pair is a package-level helper for a
 * caller that has already established its own authority.
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
 * Reset a dead-lettered (or any) row for immediate redelivery - the admin
 * manual-redeliver action (§5.3): clear the dead-letter flag and delivery
 * timestamp, reset attempts, and make it due now.
 *
 * **A redacted row is never reset** (issue #433). The `payload_redacted_at is null`
 * predicate is part of the `where`, so such a row matches no statement: it is not
 * updated, not returned, and left byte-for-byte as it was. Without it this helper
 * cleared `delivered_at` and `dead_lettered_at` on a row {@link claimDue} then
 * declines to claim *on* `payload_redacted_at`, which left the event reading as
 * pending forever while nothing would ever send it - the stranded-queue state that
 * every other predicate in this file exists to prevent.
 *
 * The guard lives in the `where` rather than only in
 * {@link outboxRedeliveryRefusalFor} because this helper is a published export with
 * no in-repo caller: the ordering convention that protects the delivery-level path
 * (one handler that refuses first) has nothing to enforce it here, and a mutation
 * that stranded a row when a downstream caller forgot the check would be a guard
 * with a failing case nobody sees. A caller that does call the refusal helper first
 * gets the distinguishable answer; a caller that does not gets `undefined`, which
 * reads as not-found rather than as a silent strand. Refusal and absence are
 * distinguished by the pair, never by this return value alone.
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
