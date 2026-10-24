import { z } from "zod";

import { DateAnswerValue } from "./answer-value.js";
import { QcmsError, err, ok, type Result } from "./errors.js";
import { OptionId, QuestionId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";
import { LocalizedText } from "./localized-text.js";
import { checkSafePattern } from "./safe-pattern.js";
import {
  ValidationMessages,
  VALIDATION_MESSAGE_KEYS,
  type ValidationMessageKey,
} from "./validation-message.js";

/**
 * Question definitions (DOMAIN_SCHEMA §2.2, ADR-02, R6). `questionId` is
 * identity and is never reused; `version` is content. The type union is closed
 * per core release, and the exhaustive helpers below break the build until
 * every switch handles a new member.
 */

/**
 * Typed error codes for definition parsing. A parse failure carries every
 * issue with its code and path, never only the first (CONTRIBUTING).
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

/** Narrows the shared coded-issue plumbing to this module's codes, so a typo
 * is a compile error. */
function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: QuestionDefinitionErrorCode,
  message: string,
  path: IssuePath,
): void {
  addSharedCodedIssue(ctx, code, message, path);
}

/** `optionId` is stable within its question, and rules reference it (R6). */
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
  /**
   * Author-supplied validation messages, one optional {@link LocalizedText} per
   * constraint (ADR-32). An absent key inherits the portal's default. Which
   * keys are legal for a question is a publish check rather than a parse one;
   * see {@link authoredMessageKeys}.
   */
  messages: ValidationMessages.optional(),
});
export type QuestionBase = z.infer<typeof QuestionBase>;

/** Duplicates across questions are fine, since an optionId is scoped to its
 * own question. */
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

/** A min/max pair is homogeneous per question type, and lexicographic order
 * over the canonical date encoding is calendar order. */
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
  /**
   * The two displayed labels, as authored content (ADR-36). Each falls back on
   * its own to the compiler's lexicon, so overriding "Yes" leaves "No" on it.
   * Presentation only: the wire values and the boolean answer do not change, so
   * no rule, export or report changes meaning.
   */
  yesLabel: LocalizedText.optional(),
  noLabel: LocalizedText.optional(),
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
  // The transitive bound still applies directly to minSelected when
  // maxSelected is absent.
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
 * The closed union of question types (DOMAIN_SCHEMA §2.2). Constraint
 * refinements run inside the matched variant, so a failed parse reports every
 * violated refinement with its typed code and path.
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

// The `satisfies` clause is the exhaustiveness check: adding a union member
// without listing it here breaks the build, as does listing a stale one.
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
 * OptionIds carried by a definition. The switch is exhaustive with a `never`
 * default, so adding a question type without handling it is a build error.
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
 * The constraint-shaped fields of one definition, keyed by their
 * {@link ValidationMessageKey}. `undefined`, or `false` for a boolean flag,
 * means the constraint is not active here. The switch is exhaustive with a
 * `never` default, so a new question type must decide its message keys.
 */
function constraintBag(
  definition: QuestionDefinition,
): Partial<Record<ValidationMessageKey, unknown>> {
  switch (definition.type) {
    case "shortText": {
      const { minLength, maxLength, pattern } = definition.constraints;
      return { minLength, maxLength, pattern };
    }
    case "longText":
      return { maxLength: definition.constraints.maxLength };
    case "number": {
      const { min, max, integer } = definition.constraints;
      return { min, max, integer };
    }
    case "date": {
      const { min, max } = definition.constraints;
      return { min, max };
    }
    case "boolean":
    case "singleChoice":
      // Neither type carries a constraint an author could decorate, and
      // `required` is added by `authoredMessageKeys` for every type.
      return {};
    case "multiChoice": {
      const { minSelected, maxSelected } = definition.constraints;
      return { minSelected, maxSelected };
    }
    /* v8 ignore next 2 -- unreachable by construction */
    default:
      return assertNeverQuestionType(definition);
  }
}

/**
 * The constraint keys this question carries, and therefore the only keys an
 * author-supplied message map may use (ADR-32), in canonical
 * {@link VALIDATION_MESSAGE_KEYS} order.
 *
 * Carrying a constraint is stricter than the type permitting one: a `shortText`
 * with no `minLength` can never produce that error, so a message for it could
 * never be shown and publish reports the key as orphaned.
 */
export function authoredMessageKeys(
  definition: QuestionDefinition,
): readonly ValidationMessageKey[] {
  const active: Partial<Record<ValidationMessageKey, unknown>> = {
    required: definition.required,
    ...constraintBag(definition),
  };
  return VALIDATION_MESSAGE_KEYS.filter((key) => {
    const value = active[key];
    return value !== undefined && value !== false;
  });
}

/**
 * The shape the library stores per question version (DOMAIN_SCHEMA §4.2).
 * Immutability of a published version is enforced by storage and publish.
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
 * Parse an unknown value as a QuestionDefinition. Every violated refinement is
 * reported with its typed code and path, never only the first.
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
 * Parse an unknown value as a QuestionVersionRecord. An issue inside the
 * embedded definition keeps its own code, with a path rooted at "definition".
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
