import {
  compilesUnderV,
  parseQuestionDefinition,
  toVSafePattern,
  type QuestionDefinition,
} from "@roonga/qcms-core";
import {
  createQuestion,
  createQuestionVersion,
  isQuestionIdInAnswerLedger,
  isQuestionIdTaken,
} from "@roonga/qcms-db";
import type { Executor, QuestionRow, QuestionVersionRow } from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";
import type { Databases } from "../../environments.js";

export interface DefinitionRefusal {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly (string | number)[] | undefined;
}

interface AuthoringIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

const PATTERN_NOT_BROWSER_SAFE = "PATTERN_NOT_BROWSER_SAFE";

export const questionFail = {
  invalidDefinition: (issues: readonly DefinitionRefusal[]): ApiError =>
    new ApiError("INVALID_QUESTION_DEFINITION", 422, "The question definition is invalid", {
      issues,
    }),
  idReused: (questionId: string): ApiError =>
    new ApiError(
      "QUESTION_ID_REUSED",
      409,
      "This questionId has been used before; ids are never reused (R6)",
      { questionId },
    ),
  slugTaken: (questionId: string, slug: string): ApiError =>
    new ApiError("SLUG_TAKEN", 409, "That slug is already in use", { questionId, slug }),
} as const;

/**
 * Refused at the authoring boundary rather than in the schema, so stored definitions,
 * the golden corpus and the seed fixtures keep parsing and serving unchanged (R1).
 */
function browserSafePatternIssues(definition: QuestionDefinition): AuthoringIssue[] {
  if (definition.type !== "shortText") return [];
  const { pattern } = definition.constraints;
  if (pattern === undefined || compilesUnderV(pattern)) return [];

  const suggestion = toVSafePattern(pattern);
  const why =
    "A browser compiles the pattern attribute with the 'v' flag, which rejects this expression, so the field would lose its in-page validation hint";
  return [
    {
      code: PATTERN_NOT_BROWSER_SAFE,
      message:
        suggestion === undefined
          ? `${why}. No equivalent spelling could be derived automatically: rewrite the character class so it compiles under 'v'.`
          : `${why}. Use "${suggestion}" instead - it matches exactly the same answers.`,
      path: ["constraints", "pattern"],
    },
  ];
}

/** Reported rather than thrown, so a caller validating a list can name which question was refused. */
export type QuestionDefinitionCheck =
  | { readonly ok: true; readonly definition: QuestionDefinition }
  | { readonly ok: false; readonly issues: readonly DefinitionRefusal[] };

export function checkQuestionDefinition(value: unknown): QuestionDefinitionCheck {
  const parsed = parseQuestionDefinition(value);
  if (!parsed.ok) return { ok: false, issues: parsed.error };
  const boundary = browserSafePatternIssues(parsed.value);
  if (boundary.length > 0) return { ok: false, issues: boundary };
  return { ok: true, definition: parsed.value };
}

export function requireQuestionDefinition(value: unknown): QuestionDefinition {
  const checked = checkQuestionDefinition(value);
  if (!checked.ok) throw questionFail.invalidDefinition(checked.issues);
  return checked.definition;
}

/** drizzle wraps the pg error, so SQLSTATE 23505 can sit on the error or on its `cause`. */
function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

/**
 * R6's answer-ledger half, asked of each environment on that environment's own pool: the
 * control role holds no read on any data-plane table (ADR-40), so this cannot ride the
 * authoring transaction.
 */
export async function requireUnusedQuestionId(
  databases: Databases,
  questionId: QuestionDefinition["questionId"],
): Promise<void> {
  for (const environment of databases.names) {
    if (await isQuestionIdInAnswerLedger(databases.for(environment), questionId)) {
      throw questionFail.idReused(questionId);
    }
  }
}

/** The first version is a draft, never published: publishing is a separate human act (§4.2). */
export async function createQuestionWithFirstDraft(
  exec: Executor,
  input: {
    readonly definition: QuestionDefinition;
    readonly slug: string;
    readonly workspaceId: string;
  },
): Promise<{ question: QuestionRow; version: QuestionVersionRow }> {
  const questionId = input.definition.questionId;

  if (await isQuestionIdTaken(exec, questionId)) throw questionFail.idReused(questionId);

  let question: QuestionRow;
  try {
    question = await createQuestion(exec, {
      questionId,
      slug: input.slug,
      workspaceId: input.workspaceId,
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw questionFail.slugTaken(questionId, input.slug);
    throw err;
  }
  const version = await createQuestionVersion(exec, {
    questionId,
    definition: input.definition,
  });

  return { question, version };
}
