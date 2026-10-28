import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { EraseErrorCode, EraseOutcome, FormId, SessionId } from "@roonga/qcms-core";

import {
  answerGroupInstances,
  answers,
  erasureTombstones,
  outbox,
  sessions,
  submissions,
  webhookDeliveries,
} from "../schema/index.js";
import {
  DELIVERY_CANCELLED_SESSION_ERASED,
  responseSnippetRedactionColumns,
} from "./deliveries.js";
import type { Executor } from "./executor.js";
import { outboxPayloadRedactionColumns } from "./outbox.js";

/** The GUC the `answers_reject_delete` trigger requires before it permits a DELETE. */
export const ANSWER_DELETE_GUARD_SETTING = "qcms.allow_answer_delete";

/**
 * The only sanctioned way to authorize an `answers` DELETE (ADR-17). Only
 * {@link eraseSession} and `purgeExpired` may call it, inside a transaction.
 */
export async function openAnswerDeleteDoor(exec: Executor): Promise<void> {
  await exec.execute(sql`select set_config(${ANSWER_DELETE_GUARD_SETTING}, 'on', true)`);
}

/**
 * Thrown when the target session does not exist and has no tombstone. The message may
 * carry only the opaque session id, never respondent data.
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
 * Erase one session (ADR-17). Idempotent: an existing tombstone returns unchanged with `alreadyErased: true`;
 * an unknown session throws {@link SessionNotFoundError}.
 * Both lookups name the form, so a cross-form call is indistinguishable from an unknown id.
 */
export async function eraseSession(
  exec: Executor,
  formId: FormId,
  sessionId: SessionId,
  reason: string,
): Promise<EraseOutcome> {
  return exec.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(erasureTombstones)
      .where(and(eq(erasureTombstones.sessionId, sessionId), eq(erasureTombstones.formId, formId)))
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

    const [session] = await tx
      .select({ formId: sessions.formId, formVersion: sessions.formVersion })
      .from(sessions)
      .where(and(eq(sessions.sessionId, sessionId), eq(sessions.formId, formId)))
      .limit(1);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    // The roster's reject-delete trigger reads the same GUC, so this opens no second
    // door.
    await openAnswerDeleteDoor(tx);
    await tx.delete(answers).where(eq(answers.sessionId, sessionId));
    await tx.delete(answerGroupInstances).where(eq(answerGroupInstances.sessionId, sessionId));
    await tx.delete(submissions).where(eq(submissions.sessionId, sessionId));

    await cancelUndeliveredDeliveries(tx, sessionId);
    await redactDeliveryResponseSnippets(tx, sessionId);
    await redactOutboxPayloads(tx, sessionId);

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
 * Whether one environment holds anything for a subject, and whether it has already been
 * erased there. Existence only: no answer, no form version, no timestamp.
 */
export interface SubjectPresence {
  /** A session with this id, in this form. */
  readonly hasSession: boolean;
  /** A tombstone for it: the erasure here has already been performed. */
  readonly alreadyErased: boolean;
}

/**
 * What one environment holds for one (form, session) pair; form-scoped, so another form's session reads as
 * nonexistent. Two reads rather than a join: a tombstone outlives the session shell a retention purge removes.
 */
export async function findSubjectPresence(
  exec: Executor,
  formId: FormId,
  sessionId: SessionId,
): Promise<SubjectPresence> {
  const [session] = await exec
    .select({ sessionId: sessions.sessionId })
    .from(sessions)
    .where(and(eq(sessions.sessionId, sessionId), eq(sessions.formId, formId)))
    .limit(1);
  const [tombstone] = await exec
    .select({ sessionId: erasureTombstones.sessionId })
    .from(erasureTombstones)
    .where(and(eq(erasureTombstones.sessionId, sessionId), eq(erasureTombstones.formId, formId)))
    .limit(1);
  return { hasSession: session !== undefined, alreadyErased: tombstone !== undefined };
}

// The jsonb member is the join key, there being no `outbox.session_id`. Event types
// without a `sessionId` hold no respondent data and are meant not to match.
function outboxRowsForSession(sessionId: SessionId) {
  return sql`${outbox.payload} ->> 'sessionId' = ${sessionId}`;
}

// The payload is QCMS's own copy of what erasure was asked to remove. Redaction rather
// than deletion, because the row and its deliveries are the audit record of what left.
async function redactOutboxPayloads(exec: Executor, sessionId: SessionId): Promise<void> {
  await exec
    .update(outbox)
    .set(outboxPayloadRedactionColumns())
    .where(and(outboxRowsForSession(sessionId), isNull(outbox.payloadRedactedAt)));
}

// Delivered rows included: the snippet is a consumer's response body verbatim, which can
// echo the respondent's own answers back.
async function redactDeliveryResponseSnippets(exec: Executor, sessionId: SessionId): Promise<void> {
  await exec
    .update(webhookDeliveries)
    .set(responseSnippetRedactionColumns())
    .where(
      and(
        isNotNull(webhookDeliveries.lastResponseSnippet),
        inArray(
          webhookDeliveries.outboxId,
          exec.select({ id: outbox.id }).from(outbox).where(outboxRowsForSession(sessionId)),
        ),
      ),
    );
}

// Delivered rows are left alone: that event has already left, and the consumer's copy is
// theirs to erase.
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
