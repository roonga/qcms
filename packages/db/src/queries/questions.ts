import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { QuestionDefinition, QuestionId } from "@roonga/qcms-core";

import { authOrganization, questionStatus, questions, questionVersions } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * The `questions` library-identity row. Hand-authored: its branded-id column degrades to an `error` type
 * through the emitted `.d.ts`.
 */
export interface QuestionRow {
  questionId: QuestionId;
  slug: string;
  /** The workspace that owns this question. Never null. */
  workspaceId: string;
  createdAt: Date;
}

export type _QuestionRowMatchesTable = AssignableTo<QuestionRow, typeof questions.$inferSelect> &
  AssignableTo<typeof questions.$inferSelect, QuestionRow>;

/** Question version lifecycle, derived from the `questionStatus` pgEnum. */
export type QuestionStatus = (typeof questionStatus.enumValues)[number];

/**
 * The `question_versions` row. Hand-authored: the enum-bearing table's `$inferSelect` degrades through the
 * emitted `.d.ts`.
 */
export interface QuestionVersionRow {
  questionId: QuestionId;
  version: number;
  definition: QuestionDefinition;
  status: QuestionStatus;
  publishedAt: Date | null;
}

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

/**
 * Insert a question library identity. A `questionId` is stable forever and is never
 * reused with a different meaning.
 */
export async function createQuestion(
  exec: Executor,
  input: { questionId: QuestionId; slug: string; workspaceId: string },
): Promise<QuestionRow> {
  const [row] = await exec
    .insert(questions)
    .values({
      questionId: input.questionId,
      slug: input.slug,
      workspaceId: input.workspaceId,
    })
    .returning();
  return row!;
}

/**
 * Move a question to another workspace, touching no version, so a form elsewhere that
 * already pins one keeps serving. Grandfathering that pin into the next draft is the
 * publish-time rule's job, in `apps/api/src/features/forms/handler.ts`.
 */
export async function moveQuestionToWorkspace(
  exec: Executor,
  questionId: QuestionId,
  workspaceId: string,
): Promise<QuestionRow | undefined> {
  const [row] = await exec
    .update(questions)
    .set({ workspaceId })
    .where(eq(questions.questionId, questionId))
    .returning();
  return row;
}

/**
 * Append the next draft version of a question, numbering it atomically. A concurrent
 * duplicate fails the primary key, and the caller retries.
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
 * Mark a version published and stamp `publishedAt`. The freeze trigger permits it only
 * while `definition` is untouched.
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

/** Mark a version deprecated: no new pins may reference it. */
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

/** Every stored version of one question, oldest first. */
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

/** Every stored version of many questions, ordered so one pass partitions the result. */
export async function listVersionsForQuestions(
  exec: Executor,
  questionIds: readonly QuestionId[],
): Promise<QuestionVersionRow[]> {
  if (questionIds.length === 0) return [];
  return exec
    .select()
    .from(questionVersions)
    .where(inArray(questionVersions.questionId, [...questionIds]))
    .orderBy(questionVersions.questionId, questionVersions.version);
}

/**
 * Overwrite a draft version's `definition` in place, or `undefined` when no draft matched; the caller must
 * validate through the kernel first. `status = 'draft'` is stricter than the
 * `question_versions_freeze_published` trigger, which never covered a deprecated row.
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
 * List every question with a summary of its latest version. Questions with no version
 * yet are omitted.
 */
export async function listQuestions(
  exec: Executor,
  options: { readonly workspaceIds?: readonly string[] } = {},
): Promise<QuestionSummary[]> {
  // The confidentiality boundary: `undefined` is the whole installation, and an empty
  // list must stay empty rather than widen to every workspace. Adding the shared
  // library's workspace id is the caller's job.
  const base = exec
    .selectDistinctOn([questions.questionId], {
      questionId: questions.questionId,
      slug: questions.slug,
      createdAt: questions.createdAt,
      latestVersion: questionVersions.version,
      latestStatus: questionVersions.status,
      publishedAt: questionVersions.publishedAt,
    })
    .from(questions)
    .innerJoin(questionVersions, eq(questions.questionId, questionVersions.questionId));

  if (options.workspaceIds === undefined) {
    return base.orderBy(questions.questionId, desc(questionVersions.version));
  }
  if (options.workspaceIds.length === 0) return [];
  return base
    .where(inArray(questions.workspaceId, [...options.workspaceIds]))
    .orderBy(questions.questionId, desc(questionVersions.version));
}

/** A question's owning workspace and whether that workspace is the shared library. */
export interface QuestionOwnership {
  readonly questionId: QuestionId;
  readonly workspaceId: string;
  readonly workspaceIsShared: boolean;
}

/** The two facts the publish-time pin rule needs, for many questions in one read. */
export async function listQuestionOwnership(
  exec: Executor,
  questionIds: readonly QuestionId[],
): Promise<QuestionOwnership[]> {
  if (questionIds.length === 0) return [];
  return exec
    .select({
      questionId: questions.questionId,
      workspaceId: questions.workspaceId,
      workspaceIsShared: authOrganization.isShared,
    })
    .from(questions)
    .innerJoin(authOrganization, eq(questions.workspaceId, authOrganization.id))
    .where(inArray(questions.questionId, [...questionIds]))
    .orderBy(questions.questionId);
}

/**
 * The library half of the id-reuse check; the control role holds no read on a data-plane
 * table, so the ledger half is `isQuestionIdInAnswerLedger`.
 *
 * Only a pre-check: `control.questions`' primary key is what stops two questions sharing an id.
 */
export async function isQuestionIdTaken(exec: Executor, questionId: QuestionId): Promise<boolean> {
  const result = await exec.execute<{ taken: boolean }>(sql`
    select exists(
      select 1 from ${questions} where ${questions.questionId} = ${questionId}
    ) as taken
  `);
  return result.rows[0]?.taken ?? false;
}

/**
 * The data-plane half of {@link isQuestionIdTaken}. `answers` is unqualified, so the
 * connection's `search_path` decides which environment is read and this can never name
 * one it was not handed a pool for; covering the live set means one call per environment.
 */
export async function isQuestionIdInAnswerLedger(
  exec: Executor,
  questionId: QuestionId,
): Promise<boolean> {
  const result = await exec.execute<{ taken: boolean }>(sql`
    select exists(
      select 1 from answers where question_id = ${questionId}
    ) as taken
  `);
  return result.rows[0]?.taken ?? false;
}
