import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { EraseErrorCode, EraseOutcome, SessionId } from "@qcms/core";

import {
  answers,
  erasureTombstones,
  outbox,
  sessions,
  submissions,
  webhookDeliveries,
} from "../schema/index.js";
import { DELIVERY_CANCELLED_SESSION_ERASED } from "./deliveries.js";
import type { Executor } from "./executor.js";

/**
 * The transaction-local GUC that opens the sanctioned `answers` DELETE door.
 * The `answers_reject_delete` trigger (migration 0004) rejects any DELETE unless
 * this is set to `'on'` for the current transaction. Set it with
 * {@link openAnswerDeleteDoor} immediately before deleting answers, inside a
 * transaction - `SET LOCAL` reverts automatically when the transaction ends, so
 * the door is never left open across statements or connections.
 */
export const ANSWER_DELETE_GUARD_SETTING = "qcms.allow_answer_delete";

/**
 * Open the scoped `answers` DELETE door for the current transaction. This is the
 * *only* mechanism permitted to authorize an `answers` DELETE (ADR-17): the two
 * sanctioned doors - {@link eraseSession} (this task, 016) and `purgeExpired`
 * (retention, 015) - call it before their delete; every other DELETE is rejected
 * by the trigger. Must run inside a transaction.
 */
export async function openAnswerDeleteDoor(exec: Executor): Promise<void> {
  await exec.execute(sql`select set_config(${ANSWER_DELETE_GUARD_SETTING}, 'on', true)`);
}

/**
 * Thrown by {@link eraseSession} when the target session does not exist and has
 * no tombstone. Typed via {@link EraseErrorCode} from `@qcms/core` (core owns the
 * meaning; db throws). The message carries only the opaque session id - never
 * respondent data (SEC: answer values are never logged).
 */
export class SessionNotFoundError extends Error {
  readonly code: EraseErrorCode = "SESSION_NOT_FOUND";
  readonly sessionId: SessionId;

  constructor(sessionId: SessionId) {
    super(`eraseSession: session ${sessionId} does not exist`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

/**
 * Erase one session (ADR-17, I11). In a single transaction:
 *
 * 1. **Idempotency first.** If a tombstone already exists for the session,
 *    return it unchanged (`alreadyErased: true`) - a no-op. The already-erased
 *    session row (a scrubbed shell) and its absent ledger are left as they are.
 * 2. Otherwise the session must exist, or throw {@link SessionNotFoundError}.
 * 3. Open the scoped DELETE door ({@link openAnswerDeleteDoor}), then delete
 *    every `answers` row for the session and the `submissions` lock if present.
 * 4. Scrub any session column that could hold respondent-linkable data. The
 *    launch `sessions` schema holds **none** (all columns are structural and
 *    `linkId` is retained by design - see `@qcms/core` erasure semantics and
 *    `docs/erasure.md`), so the scrub set is empty today; the session row is
 *    retained as an audit shell.
 * 5. **Redact QCMS's own outbox copy** and **cancel the session's undelivered
 *    deliveries** (ADR-17 as amended 2026-08-02, task 059) - see
 *    {@link redactOutboxPayloads} and {@link cancelUndeliveredDeliveries}.
 * 6. Insert the `erasure_tombstones` row `(sessionId, formId, formVersion,
 *    erasedAt, reason)` and return it (`alreadyErased: false`).
 *
 * All six steps share one transaction, so an induced failure at any point
 * (e.g. the tombstone insert, which runs last) rolls the deletes, the redaction
 * and the cancellations back together - the ledger stays intact, the payloads
 * still hold their answers, and no tombstone is written (I11 transactionality).
 */
export async function eraseSession(
  exec: Executor,
  sessionId: SessionId,
  reason: string,
): Promise<EraseOutcome> {
  return exec.transaction(async (tx) => {
    // 1. Idempotency: an existing tombstone means the session is already erased.
    const [existing] = await tx
      .select()
      .from(erasureTombstones)
      .where(eq(erasureTombstones.sessionId, sessionId))
      .limit(1);
    if (existing) {
      return {
        sessionId: existing.sessionId,
        formId: existing.formId,
        formVersion: existing.formVersion,
        erasedAt: existing.erasedAt,
        reason: existing.reason,
        alreadyErased: true,
      };
    }

    // 2. The session must exist to be erased.
    const [session] = await tx
      .select({ formId: sessions.formId, formVersion: sessions.formVersion })
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .limit(1);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    // 3. Open the sanctioned DELETE door, then hard-delete the ledger + lock.
    await openAnswerDeleteDoor(tx);
    await tx.delete(answers).where(eq(answers.sessionId, sessionId));
    await tx.delete(submissions).where(eq(submissions.sessionId, sessionId));

    // 4. Scrub respondent-linkable session columns. None exist in the launch
    //    schema (structural columns only; linkId retained), so this is a
    //    deliberate no-op. Adopters who add PII columns extend it here.

    // 5. Erasure reaches QCMS's own queued copy too, not just the ledger.
    //    Cancellation runs first so it can still see which deliveries were live;
    //    redaction keeps `sessionId` in the envelope, so the order is not load
    //    bearing, but reading it in this order matches what the two do.
    await cancelUndeliveredDeliveries(tx, sessionId);
    await redactOutboxPayloads(tx, sessionId);

    // 6. Write the tombstone: existence without content.
    const [tombstone] = await tx
      .insert(erasureTombstones)
      .values({
        sessionId,
        formId: session.formId,
        formVersion: session.formVersion,
        reason,
      })
      .returning();

    return {
      sessionId: tombstone!.sessionId,
      formId: tombstone!.formId,
      formVersion: tombstone!.formVersion,
      erasedAt: tombstone!.erasedAt,
      reason: tombstone!.reason,
      alreadyErased: false,
    };
  });
}

/**
 * Every `outbox` row that carries this session's answers, matched on the payload's
 * own `sessionId`. There is no `outbox.session_id` column - the outbox stores
 * whole domain events, and a session id is a property of one event *type* - so the
 * jsonb member is the join key. Event types that carry no `sessionId`
 * (`form.published`) never match, which is the intended behaviour: they hold no
 * respondent data.
 */
function outboxRowsForSession(sessionId: SessionId) {
  return sql`${outbox.payload} ->> 'sessionId' = ${sessionId}`;
}

/**
 * Redact this session's outbox payloads in place (ADR-17 amendment, task 059).
 *
 * `outbox.payload` for a `response.submitted` event is the respondent's **whole
 * locked answer set**. It is QCMS's own copy of exactly what erasure was asked to
 * remove, so leaving it meant an erased respondent's answers survived erasure in
 * our database and stayed deliverable. This drops the `answers` member with the
 * jsonb `-` operator and keeps the envelope (`sessionId`, `formId`, `formVersion`,
 * `submittedAt`, `contentHash`) plus the row's `event_type`: existence without
 * content, the tombstone's principle applied one table over.
 *
 * **Redaction, not deletion** - the row and its `webhook_deliveries` children are
 * the audit record of what left the building, and an operator answering "was this
 * person's data sent anywhere?" needs it. This adds no new DELETE door: the two
 * sanctioned whole-session DELETE paths remain `eraseSession` and `purgeExpired`.
 *
 * Rows already redacted are skipped so a re-run cannot move the original
 * `payload_redacted_at`; the `-` operator would be a no-op on them anyway.
 */
async function redactOutboxPayloads(exec: Executor, sessionId: SessionId): Promise<void> {
  await exec
    .update(outbox)
    .set({
      payload: sql`${outbox.payload} - 'answers'`,
      // The transaction timestamp, so the redaction, the cancellations and the
      // tombstone's `erasedAt` default all name the same instant.
      payloadRedactedAt: sql`now()`,
    })
    .where(and(outboxRowsForSession(sessionId), isNull(outbox.payloadRedactedAt)));
}

/**
 * Terminally cancel every still-sendable delivery for this session (ADR-17
 * amendment, task 059): anything not already delivered and not already cancelled,
 * whether it is pending or dead-lettered.
 *
 * Posting an event whose `answers` member has just been removed is a malformed
 * message for the consumer, and posting one that still had them would defeat the
 * erasure; not sending is the honest outcome. Cancellation is what makes that
 * structural rather than a convention: `claimDueDeliveries` and the dead-letter
 * queue both exclude cancelled rows, and the redeliver endpoint refuses them.
 *
 * A **delivered** row is deliberately untouched here (beyond its parent's
 * redaction). That event has already left; pretending otherwise on the dashboard
 * would be a fiction, and the consumer's copy is theirs to erase as an independent
 * controller.
 */
async function cancelUndeliveredDeliveries(exec: Executor, sessionId: SessionId): Promise<void> {
  await exec
    .update(webhookDeliveries)
    .set({ cancelledAt: sql`now()`, cancelledReason: DELIVERY_CANCELLED_SESSION_ERASED })
    .where(
      and(
        isNull(webhookDeliveries.deliveredAt),
        isNull(webhookDeliveries.cancelledAt),
        inArray(
          webhookDeliveries.outboxId,
          exec.select({ id: outbox.id }).from(outbox).where(outboxRowsForSession(sessionId)),
        ),
      ),
    );
}
