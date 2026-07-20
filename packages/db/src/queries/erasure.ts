import { eq, sql } from "drizzle-orm";

import type { EraseErrorCode, EraseOutcome, SessionId } from "@qcms/core";

import { answers, erasureTombstones, sessions, submissions } from "../schema/index.js";
import type { Executor } from "./executor.js";

/**
 * The transaction-local GUC that opens the sanctioned `answers` DELETE door.
 * The `answers_reject_delete` trigger (migration 0004) rejects any DELETE unless
 * this is set to `'on'` for the current transaction. Set it with
 * {@link openAnswerDeleteDoor} immediately before deleting answers, inside a
 * transaction — `SET LOCAL` reverts automatically when the transaction ends, so
 * the door is never left open across statements or connections.
 */
export const ANSWER_DELETE_GUARD_SETTING = "qcms.allow_answer_delete";

/**
 * Open the scoped `answers` DELETE door for the current transaction. This is the
 * *only* mechanism permitted to authorize an `answers` DELETE (ADR-17): the two
 * sanctioned doors — {@link eraseSession} (this task, 016) and `purgeExpired`
 * (retention, 015) — call it before their delete; every other DELETE is rejected
 * by the trigger. Must run inside a transaction.
 */
export async function openAnswerDeleteDoor(exec: Executor): Promise<void> {
  await exec.execute(sql`select set_config(${ANSWER_DELETE_GUARD_SETTING}, 'on', true)`);
}

/**
 * Thrown by {@link eraseSession} when the target session does not exist and has
 * no tombstone. Typed via {@link EraseErrorCode} from `@qcms/core` (core owns the
 * meaning; db throws). The message carries only the opaque session id — never
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
 *    return it unchanged (`alreadyErased: true`) — a no-op. The already-erased
 *    session row (a scrubbed shell) and its absent ledger are left as they are.
 * 2. Otherwise the session must exist, or throw {@link SessionNotFoundError}.
 * 3. Open the scoped DELETE door ({@link openAnswerDeleteDoor}), then delete
 *    every `answers` row for the session and the `submissions` lock if present.
 * 4. Scrub any session column that could hold respondent-linkable data. The
 *    launch `sessions` schema holds **none** (all columns are structural and
 *    `linkId` is retained by design — see `@qcms/core` erasure semantics and
 *    `docs/erasure.md`), so the scrub set is empty today; the session row is
 *    retained as an audit shell.
 * 5. Insert the `erasure_tombstones` row `(sessionId, formId, formVersion,
 *    erasedAt, reason)` and return it (`alreadyErased: false`).
 *
 * All five steps share one transaction, so an induced failure at any point
 * (e.g. the tombstone insert) rolls the deletes back — the ledger stays intact
 * and no tombstone is written (I11 transactionality).
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

    // 5. Write the tombstone: existence without content.
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
