import { and, eq, inArray, lte } from "drizzle-orm";

import type { FormId, LinkId, SessionId } from "@qcms/core";

import { sessions } from "../schema/index.js";
import type { Executor } from "./executor.js";

export type SessionRow = typeof sessions.$inferSelect;
export type AccessMode = SessionRow["accessMode"];

/**
 * Create a respondent session, **pinning** `(formId, formVersion)` at creation.
 * There is deliberately no helper that mutates `formVersion` after this - the
 * pin is structural, which is how Invariant I4 ("a session never migrates form
 * versions") is enforced: the only write path that sets `form_version` is this
 * insert, so a session can never move to another version (R1).
 */
export async function createSession(
  exec: Executor,
  input: {
    sessionId: SessionId;
    formId: FormId;
    formVersion: number;
    accessMode: AccessMode;
    expiresAt: Date;
    linkId?: LinkId;
  },
): Promise<SessionRow> {
  const [row] = await exec
    .insert(sessions)
    .values({
      sessionId: input.sessionId,
      formId: input.formId,
      formVersion: input.formVersion,
      accessMode: input.accessMode,
      expiresAt: input.expiresAt,
      ...(input.linkId ? { linkId: input.linkId } : {}),
    })
    .returning();
  return row!;
}

/** Read a session, or `undefined`. */
export async function getSession(
  exec: Executor,
  sessionId: SessionId,
): Promise<SessionRow | undefined> {
  const [row] = await exec
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, sessionId))
    .limit(1);
  return row;
}

/** Transition a session to `in_progress` (status only - the pin is untouched). */
export async function markInProgress(
  exec: Executor,
  sessionId: SessionId,
): Promise<SessionRow | undefined> {
  const [row] = await exec
    .update(sessions)
    .set({ status: "in_progress" })
    .where(eq(sessions.sessionId, sessionId))
    .returning();
  return row;
}

/** Transition a session to `submitted` (status only - the pin is untouched). */
export async function markSubmitted(
  exec: Executor,
  sessionId: SessionId,
): Promise<SessionRow | undefined> {
  const [row] = await exec
    .update(sessions)
    .set({ status: "submitted" })
    .where(eq(sessions.sessionId, sessionId))
    .returning();
  return row;
}

/**
 * Expire every non-terminal session (`created`/`in_progress`) whose `expiresAt`
 * is at or before `now`. Drives the retention sweep (task 015). Returns the
 * expired rows.
 */
export async function expireSessions(exec: Executor, now: Date): Promise<SessionRow[]> {
  return exec
    .update(sessions)
    .set({ status: "expired" })
    .where(and(inArray(sessions.status, ["created", "in_progress"]), lte(sessions.expiresAt, now)))
    .returning();
}
