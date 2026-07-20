import { asc, desc, eq } from "drizzle-orm";

import type { AnswerMap } from "@qcms/core";
import type { AnswerValue, QuestionId, SessionId } from "@qcms/core";

import { answers } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * One row of the append-only answer ledger. Hand-authored (issue #5) because its
 * branded-id columns (`session_id`, `question_id`) resolve to a TypeScript
 * `error` type through this package's emitted `.d.ts` when consumed via
 * `$inferSelect` - the same declaration-emit degradation the enum columns hit -
 * so consumers would see unsafe member access. Keep every field in lockstep with
 * the `answers` table in `schema/answers.ts`; the drift guard below fails the
 * build if they diverge.
 */
export interface AnswerRow {
  id: string;
  sessionId: SessionId;
  questionId: QuestionId;
  value: AnswerValue;
  answeredAt: Date;
}

// Drift guard (issue #5): assert AnswerRow is structurally identical to what
// Drizzle infers from the `answers` table. `$inferSelect` resolves soundly here
// in the package source; it only degrades through the emitted `.d.ts`.
export type _AnswerRowMatchesTable = AssignableTo<AnswerRow, typeof answers.$inferSelect> &
  AssignableTo<typeof answers.$inferSelect, AnswerRow>;

/**
 * Append one answer to the ledger. INSERT only - the ledger is append-only
 * (I5, R3); there is no update path here and a `BEFORE UPDATE` trigger rejects
 * UPDATE at the database level as a backstop. `answeredAt` may be supplied to
 * control ordering (tests, backfills); it defaults to `now()`.
 */
export async function appendAnswer(
  exec: Executor,
  input: {
    sessionId: SessionId;
    questionId: QuestionId;
    value: AnswerValue;
    answeredAt?: Date;
  },
): Promise<AnswerRow> {
  const [row] = await exec
    .insert(answers)
    .values({
      sessionId: input.sessionId,
      questionId: input.questionId,
      value: input.value,
      ...(input.answeredAt ? { answeredAt: input.answeredAt } : {}),
    })
    .returning();
  return row!;
}

/**
 * The current answer for every question in a session: the latest row per
 * `questionId` by `answeredAt` (I5). `DISTINCT ON (question_id)` with a
 * `answered_at DESC, id DESC` ordering picks exactly one row per question - the
 * `id` tiebreaker keeps the choice deterministic when two rows share a
 * timestamp. Returns an `AnswerMap` (`ReadonlyMap<QuestionId, AnswerValue>`),
 * the shape the kernel's evaluator consumes.
 */
export async function latestAnswers(exec: Executor, sessionId: SessionId): Promise<AnswerMap> {
  const rows = await exec
    .selectDistinctOn([answers.questionId], {
      questionId: answers.questionId,
      value: answers.value,
    })
    .from(answers)
    .where(eq(answers.sessionId, sessionId))
    .orderBy(answers.questionId, desc(answers.answeredAt), desc(answers.id));
  return new Map(rows.map((r) => [r.questionId, r.value]));
}

/**
 * The full answer history for a session, oldest first - for audit and export.
 * Every revision is preserved (the ledger is append-only); use `latestAnswers`
 * for the current value per question.
 */
export async function answerLedger(exec: Executor, sessionId: SessionId): Promise<AnswerRow[]> {
  return exec
    .select()
    .from(answers)
    .where(eq(answers.sessionId, sessionId))
    .orderBy(asc(answers.answeredAt), asc(answers.id));
}
