/**
 * The question-authoring door: kernel validation, the boundary rules the kernel
 * deliberately does not carry, and the create transaction (task 021).
 *
 * This module exists so there is exactly **one** way a question definition
 * becomes a stored draft version. `POST /admin/questions` is one caller; 041's
 * accept-a-proposal path (issue #823) is the other, because a proposed question
 * materialised by accepting an agent proposal has to face the same gauntlet a
 * person faces, including the #453-era boundary refusals that live here rather
 * than in the schema. Splitting it out is what makes "reuse the create path"
 * checkable instead of aspirational: a second validation route cannot be written
 * by accident, because the pieces are not private to a handler any more.
 *
 * Fetch-pure (R4): no `node:*`, no clock. The slice above owns the transaction
 * boundary and passes an `Executor` in (R5).
 */

import {
  compilesUnderV,
  parseQuestionDefinition,
  toVSafePattern,
  type QuestionDefinition,
} from "@roonga/qcms-core";
import { createQuestion, createQuestionVersion, isQuestionIdTaken } from "@roonga/qcms-db";
import type { Executor, QuestionRow, QuestionVersionRow } from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";

/**
 * What a definition refusal carries: the kernel's own `QuestionDefinitionError`
 * or an {@link AuthoringIssue} this boundary raises. Structural rather than a
 * union of the two, because the editor reads these by shape - a `code`, a
 * sentence, and the domain `path` that decides which field it lands on.
 */
export interface DefinitionRefusal {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly (string | number)[] | undefined;
}

/**
 * One boundary refusal, shaped like a kernel definition issue.
 *
 * The shape is the contract rather than the union: the editor lands an issue on
 * the field its `path` names, so a refusal raised here reaches the author on the
 * pattern control exactly as a kernel refinement does. It is deliberately not a
 * `QuestionDefinitionError`, because that enum means "codes the schema's
 * refinements raise" and this rule is not one of them.
 */
interface AuthoringIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** The code a v-invalid authored pattern is refused with (issue #53). */
const PATTERN_NOT_BROWSER_SAFE = "PATTERN_NOT_BROWSER_SAFE";

export const questionFail = {
  invalidDefinition: (issues: readonly DefinitionRefusal[]): ApiError =>
    new ApiError("INVALID_QUESTION_DEFINITION", 422, "The question definition is invalid", {
      issues,
    }),
  idReused: (): ApiError =>
    new ApiError(
      "QUESTION_ID_REUSED",
      409,
      "This questionId has been used before; ids are never reused (R6)",
    ),
  slugTaken: (): ApiError => new ApiError("SLUG_TAKEN", 409, "That slug is already in use"),
} as const;

/**
 * The `v`-flag gate on newly authored patterns (issue #53, Code Owner
 * 2026-09-02).
 *
 * Browsers compile the HTML `pattern` attribute with the `v` flag, whose
 * character-class grammar is narrower than the `u` semantics `checkSafePattern`
 * validates against, so a pattern such as `^[A-Za-z][A-Za-z .,'-]{0,99}$` is
 * dropped by the browser with a console error and the field loses its native
 * hint. This refuses such a pattern **at the authoring boundary** rather than in
 * the schema, and that placement is what makes the stance reject-new-only:
 *
 * - a **new or edited** definition arriving through this API is refused here,
 *   and so is one an agent proposed and a human accepted (issue #823): accept is
 *   an authoring act, so it meets the authoring boundary;
 * - **stored** definitions never come back through this path, so already
 *   published content keeps reading and serving unchanged (R1), repaired at
 *   render time by the normalize-or-omit path PR #52 added;
 * - the golden corpus and the seed fixtures parse through
 *   `parseQuestionDefinition` directly, so they are untouched (ADR-18).
 *
 * The message offers the normalized spelling whenever one is provably
 * meaning-preserving. That quotes a rewrite of the caller's own pattern back to
 * the authenticated author who just submitted it, which is why it is built here
 * and not in the kernel: `checkSafePattern` keeps its rule of never echoing a
 * pattern into a parse message.
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

/**
 * The verdict on one candidate definition: the kernel's parse plus the
 * authoring-boundary rules the kernel deliberately does not carry.
 *
 * Reported rather than thrown, because one caller wants a 422 and the other
 * wants to keep going long enough to say *which* question was refused. 041's
 * accept validates a whole list before it opens a transaction, and the sentence
 * the operator reads has to name the offending question; a thrown `ApiError`
 * carries the issues but not the identity.
 */
export type QuestionDefinitionCheck =
  | { readonly ok: true; readonly definition: QuestionDefinition }
  | { readonly ok: false; readonly issues: readonly DefinitionRefusal[] };

/**
 * Validate an opaque definition body through the kernel, then apply the
 * authoring-boundary rules. The single gauntlet both callers face.
 */
export function checkQuestionDefinition(value: unknown): QuestionDefinitionCheck {
  const parsed = parseQuestionDefinition(value);
  if (!parsed.ok) return { ok: false, issues: parsed.error };
  const boundary = browserSafePatternIssues(parsed.value);
  if (boundary.length > 0) return { ok: false, issues: boundary };
  return { ok: true, definition: parsed.value };
}

/** {@link checkQuestionDefinition}, as the 422 a request handler wants. */
export function requireQuestionDefinition(value: unknown): QuestionDefinition {
  const checked = checkQuestionDefinition(value);
  if (!checked.ok) throw questionFail.invalidDefinition(checked.issues);
  return checked.definition;
}

/**
 * True for a Postgres unique-violation (SQLSTATE 23505). drizzle wraps the pg
 * error, so the code can sit on the error or on its `cause` - check both.
 */
function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

/**
 * Create the library identity and its first **draft** version, in whatever
 * transaction the caller owns.
 *
 * R6 is enforced here rather than by the callers: a `questionId` ever used -
 * including for a deprecated or erased question - is refused. The first version
 * is a draft, never published: publishing is a separate human act (§4.2), and
 * that is what makes this reusable by 041's accept without accept becoming a
 * publish.
 */
export async function createQuestionWithFirstDraft(
  exec: Executor,
  input: { readonly definition: QuestionDefinition; readonly slug: string },
): Promise<{ question: QuestionRow; version: QuestionVersionRow }> {
  const questionId = input.definition.questionId;

  // R6: reject any id ever used - including a deprecated/erased one.
  if (await isQuestionIdTaken(exec, questionId)) throw questionFail.idReused();

  // R6 passed: insert the identity (slug collision -> clean 409) then its first
  // draft version.
  let question: QuestionRow;
  try {
    question = await createQuestion(exec, { questionId, slug: input.slug });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw questionFail.slugTaken();
    throw err;
  }
  const version = await createQuestionVersion(exec, {
    questionId,
    definition: input.definition,
  });

  return { question, version };
}
