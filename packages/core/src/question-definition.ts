import { z } from "zod";

import { DateAnswerValue } from "./answer-value.js";
import { QcmsError, err, ok, type Result } from "./errors.js";
import { OptionId, QuestionId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";
import { LocalizedText } from "./localized-text.js";
import { checkSafePattern } from "./safe-pattern.js";

/**
 * Question definitions (task 003, DOMAIN_SCHEMA §2.2, ADR-02, R6).
 *
 * `questionId` is identity (stable forever, never reused); `version` is
 * content. The seven-type union is closed per core release - adding a type is
 * a versioned core change, and the exhaustive helpers below make sure the
 * build breaks until every switch handles it.
 */

/**
 * Closed union of typed error codes for definition parsing. Validators are
 * all-errors-not-first (CONTRIBUTING): a parse failure carries every issue,
 * each with its code and path.
 */
export const QuestionDefinitionErrorCode = z.enum([
  "INVALID_QUESTION_DEFINITION",
  "INVALID_QUESTION_VERSION_RECORD",
  "PATTERN_INVALID",
  "PATTERN_UNSUPPORTED",
  "MIN_LENGTH_ABOVE_MAX_LENGTH",
  "MIN_ABOVE_MAX",
  "MIN_SELECTED_ABOVE_MAX_SELECTED",
  "MIN_SELECTED_ABOVE_OPTION_COUNT",
  "MAX_SELECTED_ABOVE_OPTION_COUNT",
  "DUPLICATE_OPTION_ID",
  "OPTION_LABEL_EMPTY",
]);
export type QuestionDefinitionErrorCode = z.infer<typeof QuestionDefinitionErrorCode>;

export const QuestionDefinitionError = QcmsError.extend({ code: QuestionDefinitionErrorCode });
export type QuestionDefinitionError = z.infer<typeof QuestionDefinitionError>;

type IssuePath = readonly (string | number)[];

/** Module-typed wrapper over the shared coded-issue plumbing: only members of
 * QuestionDefinitionErrorCode can be attached here (typos are compile errors). */
function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: QuestionDefinitionErrorCode,
  message: string,
  path: IssuePath,
): void {
  addSharedCodedIssue(ctx, code, message, path);
}

/**
 * Declared before the union that references it (v1 of the schema doc had the
 * order reversed - a temporal-dead-zone error if transcribed literally).
 * `optionId` is stable within the question; rules reference these (R6).
 */
export const ChoiceOption = z
  .object({
    optionId: OptionId,
    label: LocalizedText,
  })
  .superRefine((option, ctx) => {
    // LocalizedText entries are non-empty strings, so one key is enough.
    if (Object.keys(option.label).length === 0) {
      addCodedIssue(ctx, "OPTION_LABEL_EMPTY", "Option label needs at least one locale entry", [
        "label",
      ]);
    }
  });
export type ChoiceOption = z.infer<typeof ChoiceOption>;

export const QuestionBase = z.object({
  questionId: QuestionId,
  label: LocalizedText,
  help: LocalizedText.optional(),
  required: z.boolean().default(false),
});
export type QuestionBase = z.infer<typeof QuestionBase>;

/** Reject duplicate optionIds within one question. Duplicates across
 * questions are fine - optionIds are scoped to their question. */
function checkUniqueOptionIds(options: readonly ChoiceOption[], ctx: z.core.$RefinementCtx): void {
  const seen = new Set<string>();
  options.forEach((option, index) => {
    if (seen.has(option.optionId)) {
      addCodedIssue(ctx, "DUPLICATE_OPTION_ID", `Duplicate optionId at options[${index}]`, [
        "options",
        index,
        "optionId",
      ]);
    } else {
      seen.add(option.optionId);
    }
  });
}

/** min/max pairs are homogeneous per question type: numbers for number
 * questions, canonical YYYY-MM-DD strings for date questions (lexicographic
 * order over that encoding is calendar order). */
function exceeds(a: number | string, b: number | string): boolean {
  return typeof a === "number" && typeof b === "number" ? a > b : String(a) > String(b);
}

function checkMinMax(
  min: number | string | undefined,
  max: number | string | undefined,
  ctx: z.core.$RefinementCtx,
  code: QuestionDefinitionErrorCode,
  minField: string,
  maxField: string,
): void {
  if (min !== undefined && max !== undefined && exceeds(min, max)) {
    addCodedIssue(ctx, code, `constraints.${minField} must not exceed constraints.${maxField}`, [
      "constraints",
      minField,
    ]);
  }
}

const ShortTextQuestion = QuestionBase.extend({
  type: z.literal("shortText"),
  constraints: z
    .object({
      minLength: z.number().int().optional(),
      maxLength: z.number().int().optional(),
      pattern: z.string().optional(),
    })
    .prefault({}),
}).superRefine((question, ctx) => {
  const { minLength, maxLength, pattern } = question.constraints;
  checkMinMax(minLength, maxLength, ctx, "MIN_LENGTH_ABOVE_MAX_LENGTH", "minLength", "maxLength");
  if (pattern !== undefined) {
    const issue = checkSafePattern(pattern);
    if (issue !== undefined) {
      addCodedIssue(ctx, issue.code, issue.message, ["constraints", "pattern"]);
    }
  }
});

const LongTextQuestion = QuestionBase.extend({
  type: z.literal("longText"),
  constraints: z.object({ maxLength: z.number().int().optional() }).prefault({}),
});

const NumberQuestion = QuestionBase.extend({
  type: z.literal("number"),
  constraints: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      integer: z.boolean().default(false),
    })
    .prefault({}),
}).superRefine((question, ctx) => {
  checkMinMax(
    question.constraints.min,
    question.constraints.max,
    ctx,
    "MIN_ABOVE_MAX",
    "min",
    "max",
  );
});

const DateQuestion = QuestionBase.extend({
  type: z.literal("date"),
  constraints: z
    .object({
      // Canonical timezone-less YYYY-MM-DD (task 002); lexicographic order
      // over this encoding is calendar order, so string compare is correct.
      min: DateAnswerValue.optional(),
      max: DateAnswerValue.optional(),
    })
    .prefault({}),
}).superRefine((question, ctx) => {
  checkMinMax(
    question.constraints.min,
    question.constraints.max,
    ctx,
    "MIN_ABOVE_MAX",
    "min",
    "max",
  );
});

const BooleanQuestion = QuestionBase.extend({
  type: z.literal("boolean"),
});

const SingleChoiceQuestion = QuestionBase.extend({
  type: z.literal("singleChoice"),
  options: z.array(ChoiceOption).min(1),
}).superRefine((question, ctx) => {
  checkUniqueOptionIds(question.options, ctx);
});

const MultiChoiceQuestion = QuestionBase.extend({
  type: z.literal("multiChoice"),
  options: z.array(ChoiceOption).min(1),
  constraints: z
    .object({
      minSelected: z.number().int().optional(),
      maxSelected: z.number().int().optional(),
    })
    .prefault({}),
}).superRefine((question, ctx) => {
  const { minSelected, maxSelected } = question.constraints;
  const optionCount = question.options.length;
  checkUniqueOptionIds(question.options, ctx);
  checkMinMax(
    minSelected,
    maxSelected,
    ctx,
    "MIN_SELECTED_ABOVE_MAX_SELECTED",
    "minSelected",
    "maxSelected",
  );
  if (maxSelected !== undefined && maxSelected > optionCount) {
    addCodedIssue(
      ctx,
      "MAX_SELECTED_ABOVE_OPTION_COUNT",
      "constraints.maxSelected must not exceed the number of options",
      ["constraints", "maxSelected"],
    );
  }
  // minSelected <= maxSelected <= options.length is a chain; when maxSelected
  // is absent the transitive bound still applies directly to minSelected.
  if (minSelected !== undefined && minSelected > optionCount) {
    addCodedIssue(
      ctx,
      "MIN_SELECTED_ABOVE_OPTION_COUNT",
      "constraints.minSelected must not exceed the number of options",
      ["constraints", "minSelected"],
    );
  }
});

/**
 * The closed discriminated union of the seven launch question types
 * (DOMAIN_SCHEMA §2.2). Constraint refinements run inside the matched
 * variant, so a failed parse reports every violated refinement with its
 * typed code and path.
 */
export const QuestionDefinition = z.discriminatedUnion("type", [
  ShortTextQuestion,
  LongTextQuestion,
  NumberQuestion,
  DateQuestion,
  BooleanQuestion,
  SingleChoiceQuestion,
  MultiChoiceQuestion,
]);
export type QuestionDefinition = z.infer<typeof QuestionDefinition>;

export type QuestionType = QuestionDefinition["type"];

// `satisfies Record<QuestionType, true>` is a compile-time exhaustiveness
// check: adding a union member without listing it here breaks the build, as
// does listing a type that no longer exists.
const QUESTION_TYPE_SET = {
  shortText: true,
  longText: true,
  number: true,
  date: true,
  boolean: true,
  singleChoice: true,
  multiChoice: true,
} as const satisfies Record<QuestionType, true>;

/** The closed set of question types, in DOMAIN_SCHEMA §2.2 order. */
// Cast justified: Object.keys of a Record<QuestionType, true> literal.
export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_SET) as readonly QuestionType[];

/* v8 ignore next 5 -- compile-time never-exhaustiveness guard; unreachable */
function assertNeverQuestionType(definition: never): never {
  throw new Error(`Unhandled question type: ${String((definition as { type?: unknown }).type)}`);
}

/**
 * OptionIds carried by a definition ([] for non-choice types). The switch is
 * exhaustive over the discriminant with a `never` default - adding a question
 * type without handling it here is a build error, not a runtime surprise.
 */
export function optionIdsOf(definition: QuestionDefinition): readonly OptionId[] {
  switch (definition.type) {
    case "shortText":
    case "longText":
    case "number":
    case "date":
    case "boolean":
      return [];
    case "singleChoice":
    case "multiChoice":
      return definition.options.map((option) => option.optionId);
    /* v8 ignore next 2 -- unreachable by construction */
    default:
      return assertNeverQuestionType(definition);
  }
}

/**
 * The shape the library stores per question version (DOMAIN_SCHEMA §4.2):
 * `questionId` is identity, `version` is content. Immutability of published
 * versions is enforced by storage + publish (tasks 013/021), not here.
 */
export const QuestionVersionRecord = z.object({
  questionId: QuestionId,
  version: z.number().int().positive(),
  definition: QuestionDefinition,
});
export type QuestionVersionRecord = z.infer<typeof QuestionVersionRecord>;

function toDefinitionErrors(
  error: z.ZodError,
  fallback: QuestionDefinitionErrorCode,
): readonly QuestionDefinitionError[] {
  return toCodedErrors(QuestionDefinitionErrorCode, error, fallback);
}

/**
 * Parse an unknown value as a QuestionDefinition. All-errors-not-first:
 * every violated refinement is reported, each with its typed code and path.
 * Structural failures carry INVALID_QUESTION_DEFINITION.
 */
export function parseQuestionDefinition(
  value: unknown,
): Result<QuestionDefinition, readonly QuestionDefinitionError[]> {
  const result = QuestionDefinition.safeParse(value);
  return result.success
    ? ok(result.data)
    : err(toDefinitionErrors(result.error, "INVALID_QUESTION_DEFINITION"));
}

export function isQuestionDefinition(value: unknown): value is QuestionDefinition {
  return QuestionDefinition.safeParse(value).success;
}

/**
 * Parse an unknown value as a QuestionVersionRecord. Record-level structural
 * failures carry INVALID_QUESTION_VERSION_RECORD; issues inside the embedded
 * definition keep their own codes, with paths rooted at ["definition", ...].
 */
export function parseQuestionVersionRecord(
  value: unknown,
): Result<QuestionVersionRecord, readonly QuestionDefinitionError[]> {
  const result = QuestionVersionRecord.safeParse(value);
  return result.success
    ? ok(result.data)
    : err(toDefinitionErrors(result.error, "INVALID_QUESTION_VERSION_RECORD"));
}

export function isQuestionVersionRecord(value: unknown): value is QuestionVersionRecord {
  return QuestionVersionRecord.safeParse(value).success;
}
