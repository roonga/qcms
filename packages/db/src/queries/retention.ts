import { and, eq, inArray, isNull, lt } from "drizzle-orm";

import type { SessionId } from "@qcms/core";

import { answers, sessions, submissions } from "../schema/index.js";
import { openAnswerDeleteDoor } from "./erasure.js";
import type { Executor } from "./executor.js";
import { type AccessMode, expireSessions, type SessionRow } from "./sessions.js";

/**
 * Retention (task 015). Two policy operations over the session lifecycle:
 *
 * - **Sweep** - {@link sweepExpiredSessions}: the default, non-destructive
 *   retention limit. Non-terminal sessions past their expiry become `expired`;
 *   the session ledger row (the audit record) is kept. This is the sweep the
 *   API's retention scheduler (017) runs periodically - scheduling itself is
 *   the API's job, not this package's.
 * - **Purge** - {@link purgeExpired}: the optional hard-cleanup an adopter opts
 *   into for expired sessions that were **never submitted**. It removes the
 *   ledger rows (session + its append-only answers) outright.
 *
 * Erasure (ADR-17, task 016) is a separate door - a per-subject GDPR request
 * that hard-deletes content and writes a tombstone. Retention here is the
 * time-based default; erasure is on-request. Neither touches submitted content
 * except through its own explicit path.
 */

/**
 * Default TTL for **anonymous** sessions: 24 hours. An anonymous session with no
 * activity for a day is treated as abandoned and swept to `expired`.
 *
 * `secure_link` sessions still carry the anonymous TTL as a ceiling: a session
 * opened from a secure link expires at `min(link expiry, now + TTL)` - it never
 * outlives the token that authorized it (SEC-2), nor the anonymous TTL horizon.
 * See {@link sessionExpiresAt}.
 */
export const DEFAULT_ANONYMOUS_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Tunable session-TTL policy. Defaults in {@link DEFAULT_SESSION_TTL}. */
export interface SessionTtlConfig {
  /** Lifetime of an anonymous session from creation, in milliseconds. */
  readonly anonymousTtlMs: number;
}

/** The documented default TTL policy (anonymous 24h; secure-link = link expiry). */
export const DEFAULT_SESSION_TTL: SessionTtlConfig = {
  anonymousTtlMs: DEFAULT_ANONYMOUS_SESSION_TTL_MS,
};

/**
 * Compute a new session's `expiresAt` from its access mode - the single place
 * the launch TTL policy lives, so the API's start-session slice (018) never
 * hardcodes it:
 *
 * - `anonymous` → `now + anonymousTtlMs` (default 24h).
 * - `secure_link` → `min(link expiry, now + anonymousTtlMs)`: the session
 *   expires with its link and never after it, but the anonymous TTL is also a
 *   ceiling so a long-lived link cannot mint an over-long session (SEC-2). The
 *   `linkExpiresAt` input is required.
 *
 * Pure and deterministic over its inputs (no clock, no db). A `secure_link`
 * call without `linkExpiresAt` is a programming error and throws.
 */
export function sessionExpiresAt(input: {
  accessMode: AccessMode;
  now: Date;
  linkExpiresAt?: Date;
  config?: SessionTtlConfig;
}): Date {
  const ttlMs = (input.config ?? DEFAULT_SESSION_TTL).anonymousTtlMs;
  const ttlExpiry = new Date(input.now.getTime() + ttlMs);
  if (input.accessMode === "secure_link") {
    if (input.linkExpiresAt === undefined) {
      throw new Error("sessionExpiresAt: secure_link sessions require linkExpiresAt");
    }
    // Clamp to the TTL ceiling: the session never outlives its link *or* the TTL.
    return input.linkExpiresAt.getTime() < ttlExpiry.getTime() ? input.linkExpiresAt : ttlExpiry;
  }
  return ttlExpiry;
}

/** Outcome of a retention sweep. */
export interface SweepResult {
  /** The rows transitioned to `expired` this run. */
  readonly expired: SessionRow[];
  /** Convenience count of {@link SweepResult.expired}. */
  readonly expiredCount: number;
}

/**
 * The retention sweep: transition every non-terminal session
 * (`created`/`in_progress`) whose `expiresAt` is **at or before** `now` to
 * `expired`, and keep the ledger row.
 *
 * Boundary (consistent with the token convention, task 010): a session is valid
 * *strictly before* `expiresAt`; at the exact instant `now === expiresAt` it is
 * already expired. `submitted` sessions are terminal and are never swept -
 * submission is an audit boundary the sweep must not cross. Idempotent: a second
 * run over the same clock finds nothing left to expire and returns an empty set.
 */
export async function sweepExpiredSessions(exec: Executor, now: Date): Promise<SweepResult> {
  const expired = await expireSessions(exec, now);
  return { expired, expiredCount: expired.length };
}

/** Outcome of a hard purge. */
export interface PurgeResult {
  /** The session ids whose ledger rows (session + answers) were removed. */
  readonly purgedSessionIds: SessionId[];
  /** Convenience count of {@link PurgeResult.purgedSessionIds}. */
  readonly purgedCount: number;
}

/**
 * Optional hard cleanup: permanently remove the ledger rows for sessions that
 * **expired and were never submitted**, whose `expiresAt` is strictly before the
 * `olderThan` retention horizon. For each victim it deletes the append-only
 * answers first (no `ON DELETE CASCADE` exists on that FK), then the session row,
 * atomically.
 *
 * Scope, by construction:
 * - Only `status = 'expired'` rows - `submitted` sessions are a different status
 *   and are never touched (their content is the audit record).
 * - An explicit anti-join on `submissions` is belt-and-suspenders: even an
 *   expired session that somehow carried a submission lock is excluded.
 * - Erased sessions (ADR-17) have already had their answers and submission
 *   hard-deleted and a tombstone written; their scrubbed session row is
 *   retained. If such a shell is expired and never-submitted it may be picked up
 *   here - harmless: it holds no content, and the tombstone is independent of the
 *   session row (no FK), so it survives the purge.
 *
 * Purging answers requires the sanctioned DELETE door (ADR-17): the
 * `answers_reject_delete` trigger rejects any `answers` DELETE unless the
 * transaction-local guard is set, so this - a sanctioned whole-session delete
 * path alongside `eraseSession` - opens it via {@link openAnswerDeleteDoor}
 * before deleting.
 *
 * Boundary: strictly-before `olderThan` - a session exactly `olderThan` old is
 * retained (it is not yet *older than* the horizon). Idempotent: a second run
 * finds no matching rows. Returns the purged session ids (possibly empty).
 */
export async function purgeExpired(exec: Executor, olderThan: Date): Promise<PurgeResult> {
  return exec.transaction(async (tx) => {
    const victims = await tx
      .select({ sessionId: sessions.sessionId })
      .from(sessions)
      .leftJoin(submissions, eq(submissions.sessionId, sessions.sessionId))
      .where(
        and(
          eq(sessions.status, "expired"),
          lt(sessions.expiresAt, olderThan),
          isNull(submissions.sessionId),
        ),
      );
    const ids = victims.map((v) => v.sessionId);
    if (ids.length === 0) {
      return { purgedSessionIds: [], purgedCount: 0 };
    }
    // Sanctioned DELETE door: authorize the answers delete for this transaction.
    await openAnswerDeleteDoor(tx);
    await tx.delete(answers).where(inArray(answers.sessionId, ids));
    await tx.delete(sessions).where(inArray(sessions.sessionId, ids));
    return { purgedSessionIds: ids, purgedCount: ids.length };
  });
}
