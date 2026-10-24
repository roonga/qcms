import { asc, desc, eq } from "drizzle-orm";

import { answerKey } from "@roonga/qcms-core";
import type { AnswerMap } from "@roonga/qcms-core";
import type { AnswerKey, AnswerValue, InstanceId, QuestionId, SessionId } from "@roonga/qcms-core";

import { answers } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * One row of the append-only answer ledger: an answer, or a retraction clearing one.
 *
 * Hand-authored rather than `$inferSelect` because the branded-id columns degrade to an
 * `error` type through this package's emitted `.d.ts` (issue #5).
 */
export interface AnswerRow {
  id: string;
  sessionId: SessionId;
  questionId: QuestionId;
  /** `null` for a question outside every repeating group. */
  instanceId: InstanceId | null;
  /** The canonical answer, or `null` on a retraction row. */
  value: AnswerValue | null;
  retracted: boolean;
  answeredAt: Date;
}

/** A ledger row that retracts a question's answer rather than giving one. */
export interface RetractionRow extends AnswerRow {
  value: null;
  retracted: true;
}

/** Narrow a ledger row to a retraction. */
export function isRetraction(row: AnswerRow): row is RetractionRow {
  return row.retracted;
}

// `$inferSelect` is sound in package source and only degrades through the emitted
// `.d.ts`, so it can police `AnswerRow` here.
export type _AnswerRowMatchesTable = AssignableTo<AnswerRow, typeof answers.$inferSelect> &
  AssignableTo<typeof answers.$inferSelect, AnswerRow>;

/**
 * Append one answer to the ledger. To clear an answer, append a retraction instead.
 *
 * Caller obligation: an `instanceId` must already be live in the session's roster. This
 * cannot check it, and skipping the check lets a respondent append rows under a forged
 * instance id in their own session.
 */
export async function appendAnswer(
  exec: Executor,
  input: {
    sessionId: SessionId;
    questionId: QuestionId;
    instanceId?: InstanceId;
    value: AnswerValue;
    answeredAt?: Date;
  },
): Promise<AnswerRow> {
  const [row] = await exec
    .insert(answers)
    .values({
      sessionId: input.sessionId,
      questionId: input.questionId,
      instanceId: input.instanceId ?? null,
      value: input.value,
      ...(input.answeredAt ? { answeredAt: input.answeredAt } : {}),
    })
    .returning();
  return row!;
}

/**
 * Append a tombstone resolving one question, or one instance of it, to unanswered;
 * retracting an unanswered question is legal. The caller obligation on
 * {@link appendAnswer} applies here too.
 */
export async function retractAnswer(
  exec: Executor,
  input: {
    sessionId: SessionId;
    questionId: QuestionId;
    instanceId?: InstanceId;
    answeredAt?: Date;
  },
): Promise<RetractionRow> {
  const [row] = await exec
    .insert(answers)
    .values({
      sessionId: input.sessionId,
      questionId: input.questionId,
      instanceId: input.instanceId ?? null,
      value: null,
      retracted: true,
      ...(input.answeredAt ? { answeredAt: input.answeredAt } : {}),
    })
    .returning();
  // Restated rather than cast: this INSERT wrote exactly these two fields.
  return { ...row!, value: null, retracted: true };
}

/**
 * The current answer for every cell in a session; a cell whose newest row is a retraction
 * is omitted. Includes instances the live roster no longer lists, which the caller filters.
 *
 * The retraction filter must stay after the `DISTINCT ON`, or it resurrects the answer
 * that was just cleared.
 */
export async function latestAnswers(exec: Executor, sessionId: SessionId): Promise<AnswerMap> {
  const rows = await exec
    .selectDistinctOn([answers.questionId, answers.instanceId], {
      questionId: answers.questionId,
      instanceId: answers.instanceId,
      value: answers.value,
      retracted: answers.retracted,
    })
    .from(answers)
    .where(eq(answers.sessionId, sessionId))
    .orderBy(answers.questionId, answers.instanceId, desc(answers.answeredAt), desc(answers.id));
  const current = new Map<AnswerKey, AnswerValue>();
  for (const row of rows) {
    // `value === null` is implied by `retracted`; re-tested only to keep the map's value
    // type free of null.
    if (row.retracted || row.value === null) continue;
    current.set(answerKey(row.questionId, row.instanceId ?? undefined), row.value);
  }
  return current;
}

/**
 * The full answer history for a session, oldest first. Retractions are included, so
 * readers must branch on `retracted`.
 */
export async function answerLedger(exec: Executor, sessionId: SessionId): Promise<AnswerRow[]> {
  return exec
    .select()
    .from(answers)
    .where(eq(answers.sessionId, sessionId))
    .orderBy(asc(answers.answeredAt), asc(answers.id));
}
