import { and, eq, gt, sql } from "drizzle-orm";

import { STEP_UP_MAX_FAILURES, STEP_UP_TTL_MS, stepUps } from "../schema/control/step-ups.js";
import type { Executor } from "./executor.js";

/** Whether this session may still attempt a step-up. */
export async function stepUpLocked(exec: Executor, sessionId: string): Promise<boolean> {
  const [found] = await exec
    .select({ failedAttempts: stepUps.failedAttempts })
    .from(stepUps)
    .where(eq(stepUps.sessionId, sessionId))
    .limit(1);
  return (found?.failedAttempts ?? 0) >= STEP_UP_MAX_FAILURES;
}

/** Record a successful step-up on the session, clearing its failure count. */
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

/** Count a failed attempt against the session and drop any step-up it held. */
export async function recordStepUpFailure(
  exec: Executor,
  input: { readonly sessionId: string; readonly userId: string },
): Promise<void> {
  await exec
    .insert(stepUps)
    .values({ sessionId: input.sessionId, userId: input.userId, failedAttempts: 1 })
    .onConflictDoUpdate({
      target: stepUps.sessionId,
      set: { verifiedAt: null, failedAttempts: sql`${stepUps.failedAttempts} + 1` },
    });
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
