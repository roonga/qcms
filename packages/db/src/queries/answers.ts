import { asc, desc, eq } from "drizzle-orm";

import type { AnswerMap } from "@roonga/qcms-core";
import type { AnswerValue, QuestionId, SessionId } from "@roonga/qcms-core";

import { answers } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * One row of the append-only answer ledger: either an **answer** (`retracted`
 * false, `value` present) or a **retraction** (`retracted` true, `value` null) -
 * ADR-33. A database CHECK keeps the two shapes mutually exclusive, so a reader
 * that branches on `retracted` (or calls {@link isRetraction}) can never mistake
 * one for the other. Nothing is ever stored inside `value` to mark a retraction:
 * `AnswerValue` stays free of nulls and sentinels, and the kernel never sees one.
 *
 * Hand-authored (issue #5) because its branded-id columns (`session_id`,
 * `question_id`) resolve to a TypeScript `error` type through this package's
 * emitted `.d.ts` when consumed via `$inferSelect` - the same declaration-emit
 * degradation the enum columns hit - so consumers would see unsafe member access.
 * Keep every field in lockstep with the `answers` table in `schema/answers.ts`;
 * the drift guard below fails the build if they diverge.
 */
export interface AnswerRow {
  id: string;
  sessionId: SessionId;
  questionId: QuestionId;
  /** The canonical answer, or `null` on a retraction row. */
  value: AnswerValue | null;
  /** True on a retraction row: this question was cleared at `answeredAt`. */
  retracted: boolean;
  answeredAt: Date;
}

/** A ledger row that retracts the question's answer rather than giving one. */
export interface RetractionRow extends AnswerRow {
  value: null;
  retracted: true;
}

/**
 * Narrow a ledger row to a retraction. Audit and export readers use this to keep
 * a retraction visibly distinct from an answer instead of rendering a blank
 * value that reads like an answer of nothing (ADR-33).
 */
export function isRetraction(row: AnswerRow): row is RetractionRow {
  return row.retracted;
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
 *
 * To clear an answer, append a retraction with {@link retractAnswer} - never a
 * null or sentinel value here (`AnswerValue` admits neither).
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
 * Append a retraction for one question: an explicit tombstone that resolves the
 * question to *unanswered* without touching any stored row (ADR-33, issue #95).
 * INSERT only, exactly like {@link appendAnswer} - the ledger stays append-only
 * (I5, R3), and the audit trail records that the respondent cleared the answer
 * rather than erasing that they ever gave one.
 *
 * Retracting a question that currently has no answer is legal (the caller may
 * not know), and simply leaves it unanswered; the API avoids appending a
 * meaningless tombstone in that case (see the submit-answer handler).
 *
 * Returns a {@link RetractionRow}, not a bare {@link AnswerRow}: this function can
 * only ever insert a tombstone, so the narrower type carries that invariant to its
 * callers instead of making each one re-derive it through {@link isRetraction}.
 */
export async function retractAnswer(
  exec: Executor,
  input: {
    sessionId: SessionId;
    questionId: QuestionId;
    answeredAt?: Date;
  },
): Promise<RetractionRow> {
  const [row] = await exec
    .insert(answers)
    .values({
      sessionId: input.sessionId,
      questionId: input.questionId,
      value: null,
      retracted: true,
      ...(input.answeredAt ? { answeredAt: input.answeredAt } : {}),
    })
    .returning();
  // The two discriminator fields are restated rather than type-asserted: this
  // INSERT wrote exactly them, and the `answers_retraction_value` CHECK (migration
  // 0009) forbids the database from returning any other shape, so the narrowing is
  // a fact about this statement rather than a claim about an arbitrary row.
  return { ...row!, value: null, retracted: true };
}

/**
 * The current answer for every question in a session: the latest row per
 * `questionId` by `answeredAt` (I5). `DISTINCT ON (question_id)` with a
 * `answered_at DESC, id DESC` ordering picks exactly one row per question - the
 * `id` tiebreaker keeps the choice deterministic when two rows share a
 * timestamp. Returns an `AnswerMap` (`ReadonlyMap<QuestionId, AnswerValue>`),
 * the shape the kernel's evaluator consumes.
 *
 * A question whose newest row is a **retraction** is omitted entirely (ADR-33),
 * so the kernel sees it as unanswered and required-validation fails as it should.
 * The filter runs *after* the DISTINCT ON, never before: excluding retractions
 * from the pick would resurrect the answer the respondent just cleared.
 */
export async function latestAnswers(exec: Executor, sessionId: SessionId): Promise<AnswerMap> {
  const rows = await exec
    .selectDistinctOn([answers.questionId], {
      questionId: answers.questionId,
      value: answers.value,
      retracted: answers.retracted,
    })
    .from(answers)
    .where(eq(answers.sessionId, sessionId))
    .orderBy(answers.questionId, desc(answers.answeredAt), desc(answers.id));
  const current = new Map<QuestionId, AnswerValue>();
  for (const row of rows) {
    // `value === null` is implied by `retracted` (the CHECK constraint) and is
    // re-tested only to keep the map's value type free of null.
    if (row.retracted || row.value === null) continue;
    current.set(row.questionId, row.value);
  }
  return current;
}

/**
 * The full answer history for a session, oldest first - for audit and export.
 * Every revision is preserved (the ledger is append-only); use `latestAnswers`
 * for the current value per question.
 *
 * Retractions are **included** (ADR-33): the point of the tombstone append is
 * that clearing an answer is a recorded event. Readers must branch on
 * `retracted` ({@link isRetraction}) so a retraction is never rendered as though
 * it were an answer.
 */
export async function answerLedger(exec: Executor, sessionId: SessionId): Promise<AnswerRow[]> {
  return exec
    .select()
    .from(answers)
    .where(eq(answers.sessionId, sessionId))
    .orderBy(asc(answers.answeredAt), asc(answers.id));
}
