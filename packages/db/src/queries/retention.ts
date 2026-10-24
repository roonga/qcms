import { and, eq, inArray, isNull, lt } from "drizzle-orm";

import type { SessionId } from "@roonga/qcms-core";

import { answerGroupInstances, answers, sessions, submissions } from "../schema/index.js";
import { openAnswerDeleteDoor } from "./erasure.js";
import type { Executor } from "./executor.js";
import { type AccessMode, expireSessions, type SessionRow } from "./sessions.js";

/** Default TTL for anonymous sessions. */
export const DEFAULT_ANONYMOUS_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Tunable session-TTL policy. Defaults in {@link DEFAULT_SESSION_TTL}. */
export interface SessionTtlConfig {
  readonly anonymousTtlMs: number;
}

/** The default TTL policy. */
export const DEFAULT_SESSION_TTL: SessionTtlConfig = {
  anonymousTtlMs: DEFAULT_ANONYMOUS_SESSION_TTL_MS,
};

/**
 * Compute a new session's `expiresAt`. For `secure_link` it is clamped to
 * `min(link expiry, now + ttl)`, so a session never outlives the token that authorized it
 * and a long-lived link cannot mint an over-long session (SEC-2).
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
    return input.linkExpiresAt.getTime() < ttlExpiry.getTime() ? input.linkExpiresAt : ttlExpiry;
  }
  return ttlExpiry;
}

/** Outcome of a retention sweep. */
export interface SweepResult {
  readonly expired: SessionRow[];
  readonly expiredCount: number;
}

/**
 * Expire every non-terminal session at or past `expiresAt`, keeping the ledger row. A
 * session is valid strictly before `expiresAt`, and a submitted one is never swept.
 */
export async function sweepExpiredSessions(exec: Executor, now: Date): Promise<SweepResult> {
  const expired = await expireSessions(exec, now);
  return { expired, expiredCount: expired.length };
}

/** Outcome of a hard purge. */
export interface PurgeResult {
  readonly purgedSessionIds: SessionId[];
  readonly purgedCount: number;
}

/**
 * Permanently remove the ledger rows of sessions that expired and were never submitted,
 * whose `expiresAt` is strictly before `olderThan`. Idempotent.
 *
 * The roster goes with the answers, or respondent-derived data would outlive the horizon.
 * The anti-join on `submissions` is a backstop under the status filter.
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
    // The sanctioned DELETE door. The same GUC authorizes the roster delete, so this
    // opens no second door.
    await openAnswerDeleteDoor(tx);
    await tx.delete(answers).where(inArray(answers.sessionId, ids));
    await tx.delete(answerGroupInstances).where(inArray(answerGroupInstances.sessionId, ids));
    await tx.delete(sessions).where(inArray(sessions.sessionId, ids));
    return { purgedSessionIds: ids, purgedCount: ids.length };
  });
}
