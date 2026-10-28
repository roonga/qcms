import { and, eq, inArray, lte } from "drizzle-orm";

import type { FormId, LinkId, SessionId } from "@roonga/qcms-core";

import { accessMode, sessionStatus, sessions } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/** How a respondent reached a session, and the session lifecycle status. */
export type AccessMode = (typeof accessMode.enumValues)[number];
export type SessionStatus = (typeof sessionStatus.enumValues)[number];

/**
 * The `sessions` row. Hand-authored: the enum-bearing table's `$inferSelect` degrades through the emitted
 * `.d.ts`.
 */
export interface SessionRow {
  sessionId: SessionId;
  formId: FormId;
  formVersion: number;
  accessMode: AccessMode;
  linkId: LinkId | null;
  /** Pinned to its own schema by the per-schema `CHECK (environment = '<env>')`. */
  environment: string;
  status: SessionStatus;
  expiresAt: Date;
  createdAt: Date;
}

export type _SessionRowMatchesTable = AssignableTo<SessionRow, typeof sessions.$inferSelect> &
  AssignableTo<typeof sessions.$inferSelect, SessionRow>;

/**
 * Create a respondent session, pinning `(formId, formVersion)`; the only write path that sets
 * `form_version`. `environment` must be the one this pool serves, or the per-schema CHECK refuses the row.
 * With `linkId` set the composite foreign key requires the link to name the same environment.
 */
export async function createSession(
  exec: Executor,
  input: {
    sessionId: SessionId;
    formId: FormId;
    formVersion: number;
    accessMode: AccessMode;
    expiresAt: Date;
    environment: string;
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
      environment: input.environment,
      ...(input.linkId ? { linkId: input.linkId } : {}),
    })
    .returning();
  return row!;
}

/**
 * Read a session within one form, so a caller cannot tell someone else's session from no
 * such session. Use this, not {@link getSession}, wherever the id came from a client.
 */
export async function getSessionInForm(
  exec: Executor,
  formId: FormId,
  sessionId: SessionId,
): Promise<SessionRow | undefined> {
  const [row] = await exec
    .select()
    .from(sessions)
    .where(and(eq(sessions.sessionId, sessionId), eq(sessions.formId, formId)))
    .limit(1);
  return row;
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

/** Transition a session to `in_progress`. */
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

/** Transition a session to `submitted`. */
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

/** Expire every non-terminal session whose `expiresAt` is at or before `now`. */
export async function expireSessions(exec: Executor, now: Date): Promise<SessionRow[]> {
  return exec
    .update(sessions)
    .set({ status: "expired" })
    .where(and(inArray(sessions.status, ["created", "in_progress"]), lte(sessions.expiresAt, now)))
    .returning();
}
