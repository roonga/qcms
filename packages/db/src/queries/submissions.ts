import { eq } from "drizzle-orm";

import type { LockedSubmission, SessionId } from "@qcms/core";

import { submissions } from "../schema/index.js";
import type { Executor } from "./executor.js";

export type SubmissionRow = typeof submissions.$inferSelect;

/**
 * Write the submission lock for a session — the audit boundary (I6, I9). One
 * row per session (the `session_id` primary key); the kernel owns building the
 * locked set and its content hash (task 009), this helper only persists it.
 */
export async function insertSubmission(
  exec: Executor,
  input: {
    sessionId: SessionId;
    contentHash: string;
    lockedAnswers: LockedSubmission;
    submittedAt?: Date;
  },
): Promise<SubmissionRow> {
  const [row] = await exec
    .insert(submissions)
    .values({
      sessionId: input.sessionId,
      contentHash: input.contentHash,
      lockedAnswers: input.lockedAnswers,
      ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
    })
    .returning();
  return row!;
}

/** Read a session's submission lock, or `undefined`. */
export async function getSubmission(
  exec: Executor,
  sessionId: SessionId,
): Promise<SubmissionRow | undefined> {
  const [row] = await exec
    .select()
    .from(submissions)
    .where(eq(submissions.sessionId, sessionId))
    .limit(1);
  return row;
}
