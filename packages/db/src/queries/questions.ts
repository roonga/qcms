import { and, desc, eq, sql } from "drizzle-orm";

import type { QuestionDefinition, QuestionId } from "@qcms/core";

import { questionStatus, questions, questionVersions } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * The `questions` library-identity row. Hand-authored (issue #5) because its
 * branded-id column (`question_id`) resolves to a TypeScript `error` type through
 * this package's emitted `.d.ts` when consumed via `$inferSelect` - the same
 * declaration-emit degradation the enum columns hit. Keep every field in lockstep
 * with the `questions` table in `schema/questions.ts`; the drift guard below
 * fails the build if they diverge.
 */
export interface QuestionRow {
  questionId: QuestionId;
  slug: string;
  createdAt: Date;
}

// Drift guard (issue #5): assert QuestionRow is structurally identical to what
// Drizzle infers from the `questions` table.
export type _QuestionRowMatchesTable = AssignableTo<QuestionRow, typeof questions.$inferSelect> &
  AssignableTo<typeof questions.$inferSelect, QuestionRow>;

/**
 * Question version lifecycle. Derived from the `questionStatus` pgEnum
 * (schema/enums.ts) so the union tracks the DB enum automatically - never
 * re-typed as literals.
 */
export type QuestionStatus = (typeof questionStatus.enumValues)[number];

/**
 * The `question_versions` row. Hand-authored (issue #5) because the table is
 * enum-bearing (`status`), and Drizzle's `$inferSelect` degrades to a TypeScript
 * `error` type across this package's emitted `.d.ts` boundary - see
 * `schema-drift.ts`. Keep every field in lockstep with the `question_versions`
 * table in `schema/questions.ts`; the drift guard below fails the build if they
 * diverge.
 */
export interface QuestionVersionRow {
  questionId: QuestionId;
  version: number;
  definition: QuestionDefinition;
  status: QuestionStatus;
  publishedAt: Date | null;
}

// Drift guard (issue #5): assert QuestionVersionRow is structurally identical to
// what Drizzle infers from the `question_versions` table. Both directions must
// hold, so any column added, dropped, or retyped in schema/questions.ts breaks
// this instantiation until QuestionVersionRow is updated to match.
export type _QuestionVersionRowMatchesTable = AssignableTo<
  QuestionVersionRow,
  typeof questionVersions.$inferSelect
> &
  AssignableTo<typeof questionVersions.$inferSelect, QuestionVersionRow>;

/** The latest-version summary of one question, for the library list view. */
export interface QuestionSummary {
  readonly questionId: QuestionId;
  readonly slug: string;
  readonly createdAt: Date;
  readonly latestVersion: number;
  readonly latestStatus: QuestionVersionRow["status"];
  readonly publishedAt: Date | null;
}

/** Insert a question library identity (R6: `questionId` is stable forever). */
export async function createQuestion(
  exec: Executor,
  input: { questionId: QuestionId; slug: string },
): Promise<QuestionRow> {
  const [row] = await exec
    .insert(questions)
    .values({ questionId: input.questionId, slug: input.slug })
    .returning();
  return row!;
}

/**
 * Append the next draft version of a question. The version number is assigned
 * atomically by a scalar subquery in the same INSERT statement, so it is
 * correct within (or without) an outer transaction; the composite primary key
 * `(questionId, version)` is the backstop - a concurrent duplicate fails the PK
 * rather than double-assigning. Concurrent version creation for the *same*
 * question is a rare authoring race; on the PK conflict the caller retries.
 */
export async function createQuestionVersion(
  exec: Executor,
  input: { questionId: QuestionId; definition: QuestionDefinition },
): Promise<QuestionVersionRow> {
  const [row] = await exec
    .insert(questionVersions)
    .values({
      questionId: input.questionId,
      version: sql<number>`(select coalesce(max(${questionVersions.version}), 0) + 1 from ${questionVersions} where ${questionVersions.questionId} = ${input.questionId})`,
      definition: input.definition,
    })
    .returning();
  return row!;
}

/**
 * Mark a version published and stamp `publishedAt`. Allowed by the freeze
 * trigger because `definition` is untouched (I1). Returns `undefined` if the
 * `(questionId, version)` does not exist.
 */
export async function publishQuestionVersion(
  exec: Executor,
  input: { questionId: QuestionId; version: number; publishedAt?: Date },
): Promise<QuestionVersionRow | undefined> {
  const [row] = await exec
    .update(questionVersions)
    .set({ status: "published", publishedAt: input.publishedAt ?? new Date() })
    .where(
      and(
        eq(questionVersions.questionId, input.questionId),
        eq(questionVersions.version, input.version),
      ),
    )
    .returning();
  return row;
}

/** Mark a version deprecated (no new pins may reference it; §4.2). */
export async function deprecateQuestionVersion(
  exec: Executor,
  input: { questionId: QuestionId; version: number },
): Promise<QuestionVersionRow | undefined> {
  const [row] = await exec
    .update(questionVersions)
    .set({ status: "deprecated" })
    .where(
      and(
        eq(questionVersions.questionId, input.questionId),
        eq(questionVersions.version, input.version),
      ),
    )
    .returning();
  return row;
}

/** Read one stored question version, or `undefined`. */
export async function getQuestionVersion(
  exec: Executor,
  questionId: QuestionId,
  version: number,
): Promise<QuestionVersionRow | undefined> {
  const [row] = await exec
    .select()
    .from(questionVersions)
    .where(and(eq(questionVersions.questionId, questionId), eq(questionVersions.version, version)))
    .limit(1);
  return row;
}

/** Read one question library identity (id + slug), or `undefined`. */
export async function getQuestion(
  exec: Executor,
  questionId: QuestionId,
): Promise<QuestionRow | undefined> {
  const [row] = await exec
    .select()
    .from(questions)
    .where(eq(questions.questionId, questionId))
    .limit(1);
  return row;
}

/** Every stored version of one question, oldest first (the detail view). */
export async function listQuestionVersions(
  exec: Executor,
  questionId: QuestionId,
): Promise<QuestionVersionRow[]> {
  return exec
    .select()
    .from(questionVersions)
    .where(eq(questionVersions.questionId, questionId))
    .orderBy(questionVersions.version);
}

/**
 * Overwrite a **draft** version's `definition` in place. Shape-preserving
 * persistence only (R5): the caller enforces the draft-only rule and validates
 * the definition through the kernel before calling. The `WHERE status = 'draft'`
 * predicate is the storage-layer guard (defense-in-depth, issue #8): the write
 * matches only a draft row, so a `published` **or** `deprecated` version is left
 * untouched and the call returns `undefined` - the helper's name is truthful and
 * the deprecated-row gap is closed at the storage layer, not just in the handler.
 *
 * This is stricter than, and sits in front of, the
 * `question_versions_freeze_published` trigger (migration 0001): that trigger
 * only fires on `OLD.status = 'published'`, so it never covered `deprecated`
 * rows; it remains the backstop for any *other* write path that bypasses this
 * helper. Returns the updated row, or `undefined` when no **draft**
 * `(questionId, version)` matched (nonexistent, published, or deprecated).
 */
export async function updateDraftDefinition(
  exec: Executor,
  input: { questionId: QuestionId; version: number; definition: QuestionDefinition },
): Promise<QuestionVersionRow | undefined> {
  const [row] = await exec
    .update(questionVersions)
    .set({ definition: input.definition })
    .where(
      and(
        eq(questionVersions.questionId, input.questionId),
        eq(questionVersions.version, input.version),
        eq(questionVersions.status, "draft"),
      ),
    )
    .returning();
  return row;
}

/**
 * List every question with a summary of its latest version (highest `version`).
 * Questions with no version yet are omitted (there is nothing to summarize).
 */
export async function listQuestions(exec: Executor): Promise<QuestionSummary[]> {
  const rows = await exec
    .selectDistinctOn([questions.questionId], {
      questionId: questions.questionId,
      slug: questions.slug,
      createdAt: questions.createdAt,
      latestVersion: questionVersions.version,
      latestStatus: questionVersions.status,
      publishedAt: questionVersions.publishedAt,
    })
    .from(questions)
    .innerJoin(questionVersions, eq(questions.questionId, questionVersions.questionId))
    .orderBy(questions.questionId, desc(questionVersions.version));
  return rows;
}

/**
 * Whether a `questionId` has ever been used (R6: an id is stable forever and
 * never reused with a different meaning). Checks the library **and** historic
 * answer rows, so an id that survives only in the answer ledger of an erased
 * question still counts as taken - reuse can never silently change its meaning.
 */
export async function isQuestionIdTaken(exec: Executor, questionId: QuestionId): Promise<boolean> {
  const result = await exec.execute<{ taken: boolean }>(sql`
    select exists(
      select 1 from ${questions} where ${questions.questionId} = ${questionId}
      union all
      select 1 from answers where question_id = ${questionId}
    ) as taken
  `);
  return result.rows[0]?.taken ?? false;
}
