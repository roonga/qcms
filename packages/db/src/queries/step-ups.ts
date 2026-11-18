import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { authTwoFactor } from "../schema/control/auth.js";
import { STEP_UP_MAX_FAILURES, STEP_UP_TTL_MS, stepUps } from "../schema/control/step-ups.js";
import type { Executor } from "./executor.js";

/**
 * Count one attempt against the session before anything is verified, refusing it once the
 * session has spent {@link STEP_UP_MAX_FAILURES}: one statement, so a burst cannot all pass a
 * count read before any of them is recorded. `false` means locked.
 */
export async function claimStepUpAttempt(
  exec: Executor,
  input: { readonly sessionId: string; readonly userId: string },
): Promise<boolean> {
  const rows = await exec
    .insert(stepUps)
    .values({ sessionId: input.sessionId, userId: input.userId, failedAttempts: 1 })
    .onConflictDoUpdate({
      target: stepUps.sessionId,
      set: { failedAttempts: sql`${stepUps.failedAttempts} + 1` },
      setWhere: sql`${stepUps.failedAttempts} < ${STEP_UP_MAX_FAILURES}`,
    })
    .returning({ sessionId: stepUps.sessionId });
  return rows.length > 0;
}

/** Record a successful step-up on the session, clearing its attempt count. */
export async function recordStepUp(
  exec: Executor,
  input: { readonly sessionId: string; readonly userId: string; readonly at: Date },
): Promise<void> {
  await exec
    .insert(stepUps)
    .values({ sessionId: input.sessionId, userId: input.userId, verifiedAt: input.at })
    .onConflictDoUpdate({
      target: stepUps.sessionId,
      set: { verifiedAt: input.at, userId: input.userId, failedAttempts: 0 },
    });
}

/** Drop any step-up the session held, after a failed attempt; the attempt stays counted. */
export async function dropStepUp(exec: Executor, sessionId: string): Promise<void> {
  await exec.update(stepUps).set({ verifiedAt: null }).where(eq(stepUps.sessionId, sessionId));
}

/**
 * Accept a TOTP code at `step` for the account's factor, once: refused when this or a later
 * step was already accepted, so a code cannot be spent twice across sign-in and step-up.
 */
export async function acceptTotpStep(
  exec: Executor,
  input: { readonly userId: string; readonly step: number; readonly verifiedOnly: boolean },
): Promise<boolean> {
  const rows = await exec
    .update(authTwoFactor)
    .set({ lastTotpStep: input.step })
    .where(
      and(
        eq(authTwoFactor.userId, input.userId),
        input.verifiedOnly ? eq(authTwoFactor.verified, true) : undefined,
        or(isNull(authTwoFactor.lastTotpStep), lt(authTwoFactor.lastTotpStep, input.step)),
      ),
    )
    .returning({ id: authTwoFactor.id });
  return rows.length > 0;
}

/** Whether this session, for this account, stepped up within the last five minutes. */
export async function hasFreshStepUp(
  exec: Executor,
  input: { readonly sessionId: string; readonly userId: string; readonly now: Date },
): Promise<boolean> {
  const [found] = await exec
    .select({ sessionId: stepUps.sessionId })
    .from(stepUps)
    .where(
      and(
        eq(stepUps.sessionId, input.sessionId),
        eq(stepUps.userId, input.userId),
        gt(stepUps.verifiedAt, new Date(input.now.getTime() - STEP_UP_TTL_MS)),
        sql`${stepUps.verifiedAt} <= ${input.now}`,
      ),
    )
    .limit(1);
  return found !== undefined;
}

/** When a step-up verified at `verifiedAt` lapses. */
export function stepUpExpiresAt(verifiedAt: Date): Date {
  return new Date(verifiedAt.getTime() + STEP_UP_TTL_MS);
}
