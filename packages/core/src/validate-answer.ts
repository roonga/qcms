import { z } from "zod";

import {
  BooleanAnswerValue,
  DateAnswerValue,
  MultiChoiceAnswerValue,
  NumberAnswerValue,
  SingleChoiceAnswerValue,
  TextAnswerValue,
  type AnswerValue,
} from "./answer-value.js";
import { err, ok, type Result } from "./errors.js";
import { optionIdsOf, type QuestionDefinition } from "./question-definition.js";

/**
 * Answer validation (DOMAIN_SCHEMA §2.4 and the §2.2 constraints). Every failed
 * constraint is returned rather than only the first, so the portal can render
 * the full list beside the input.
 *
 * `required` is deliberately not checked here: presence is a flow and
 * submission concern (I9) rather than a property of a value.
 *
 * `code` is the stable localization key and the actual contract; `message` is
 * the built-in fallback. A message may quote a constraint bound, which is
 * definition content, but never the submitted value (SECURITY_DESIGN).
 */

/** The constraint that failed, with `"encoding"` for the parse stage. */
export const ValidationConstraint = z.enum([
  "encoding",
  "minLength",
  "maxLength",
  "pattern",
  "min",
  "max",
  "integer",
  "options",
  "minSelected",
  "maxSelected",
]);
export type ValidationConstraint = z.infer<typeof ValidationConstraint>;

/**
 * The UI localization contract. The encoding stage reuses the `INVALID_*`
 * parse codes, so a value failing the same schema fails with the same code
 * everywhere. `EMPTY_ANSWER_NOT_ALLOWED` is the one code with no constraint
 * behind it; see {@link emptyAnswerError}.
 */
export const ValidationErrorCode = z.enum([
  "EMPTY_ANSWER_NOT_ALLOWED",
  "INVALID_TEXT_ANSWER",
  "INVALID_NUMBER_ANSWER",
  "INVALID_DATE_ANSWER",
  "INVALID_BOOLEAN_ANSWER",
  "INVALID_SINGLE_CHOICE_ANSWER",
  "INVALID_MULTI_CHOICE_ANSWER",
  "LENGTH_BELOW_MIN",
  "LENGTH_ABOVE_MAX",
  "PATTERN_MISMATCH",
  "VALUE_BELOW_MIN",
  "VALUE_ABOVE_MAX",
  "NOT_AN_INTEGER",
  "UNKNOWN_OPTION",
  "TOO_FEW_SELECTED",
  "TOO_MANY_SELECTED",
]);
export type ValidationErrorCode = z.infer<typeof ValidationErrorCode>;

export const ValidationError = z.object({
  code: ValidationErrorCode,
  constraint: ValidationConstraint,
  message: z.string().min(1),
});
export type ValidationError = z.infer<typeof ValidationError>;

function failure(
  code: ValidationErrorCode,
  constraint: ValidationConstraint,
  message: string,
): ValidationError {
  return { code, constraint, message };
}

function encodingError(question: QuestionDefinition): ValidationError {
  switch (question.type) {
    case "shortText":
    case "longText":
      return failure("INVALID_TEXT_ANSWER", "encoding", "Answer must be text");
    case "number":
      return failure("INVALID_NUMBER_ANSWER", "encoding", "Answer must be a finite number");
    case "date":
      return failure(
        "INVALID_DATE_ANSWER",
        "encoding",
        "Answer must be a real calendar date in YYYY-MM-DD form",
      );
    case "boolean":
      return failure("INVALID_BOOLEAN_ANSWER", "encoding", "Answer must be a boolean");
    case "singleChoice":
      return failure(
        "INVALID_SINGLE_CHOICE_ANSWER",
        "encoding",
        "Answer must be a single option id",
      );
    case "multiChoice":
      return failure(
        "INVALID_MULTI_CHOICE_ANSWER",
        "encoding",
        "Answer must be an array of option ids",
      );
  }
}

/**
 * ADR-33 at the ingest boundary: empty text and empty selections are absence
 * rather than answers, so they are refused rather than stored. The rule lives
 * here, in front of every caller of the kernel, rather than at the control
 * boundary alone, where a direct API post of `""` could satisfy `required`
 * while holding nothing.
 *
 * It rejects and never rewrites the post into a retraction: clearing an answer
 * has one spelling on the wire, a literal `null`, and the message names it so
 * the fix is in the response.
 *
 * Reported as an `"encoding"` constraint and returned alone rather than joined
 * to the constraint sweep, because the value is not a legal answer of this type
 * at all. A `minSelected: 1` question would otherwise say "select at least 1"
 * beside it, which reads as "select more" when nothing was selected.
 *
 * Whitespace-only text is deliberately not refused here: it is stored as typed
 * and denied presence instead ({@link isBlankAnswerValue}).
 */
function emptyAnswerError(): ValidationError {
  return failure(
    "EMPTY_ANSWER_NOT_ALLOWED",
    "encoding",
    "An empty value is not an answer; send null to clear the answer",
  );
}

/**
 * Lengths count UTF-16 code units of the canonical string, the same unit as
 * HTML `maxlength`, so the kernel enforces what the portal input shows.
 */
function checkTextConstraints(
  value: string,
  constraints: {
    minLength?: number | undefined;
    maxLength?: number | undefined;
    pattern?: string | undefined;
  },
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { minLength, maxLength, pattern } = constraints;
  if (minLength !== undefined && value.length < minLength) {
    errors.push(
      failure(
        "LENGTH_BELOW_MIN",
        "minLength",
        `Answer must be at least ${String(minLength)} characters`,
      ),
    );
  }
  if (maxLength !== undefined && value.length > maxLength) {
    errors.push(
      failure(
        "LENGTH_ABOVE_MAX",
        "maxLength",
        `Answer must be at most ${String(maxLength)} characters`,
      ),
    );
  }
  if (pattern !== undefined && !matchesPattern(value, pattern)) {
    errors.push(
      failure("PATTERN_MISMATCH", "pattern", "Answer does not match the required format"),
    );
  }
  return errors;
}

/**
 * Patterns run under the `u` flag, the flag the safe-pattern subset validated
 * them against, so every accepted pattern is linear-time-safe here and this
 * `.test` cannot be a ReDoS vector. They are tested as authored and never
 * implicitly anchored.
 *
 * A pattern that does not compile is unreachable through
 * `parseQuestionDefinition`, but this stays total: a hand-constructed
 * definition reports a mismatch rather than throwing.
 */
function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "u").test(value);
  } catch {
    return false;
  }
}

/** A date compares lexicographically, which over the canonical fixed-width
 * encoding is calendar order. */
function checkBounds(
  value: number | string,
  min: number | string | undefined,
  max: number | string | undefined,
  describe: (bound: number | string) => string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (min !== undefined && value < min) {
    errors.push(failure("VALUE_BELOW_MIN", "min", `Answer must be at least ${describe(min)}`));
  }
  if (max !== undefined && value > max) {
    errors.push(failure("VALUE_ABOVE_MAX", "max", `Answer must be at most ${describe(max)}`));
  }
  return errors;
}

/**
 * Validate an unknown value as an answer to `question`, returning the canonical
 * value or every failed constraint. Never throws, and never checks `required`.
 */
export function validateAnswer(
  question: QuestionDefinition,
  value: unknown,
): Result<AnswerValue, readonly ValidationError[]> {
  switch (question.type) {
    case "shortText":
    case "longText": {
      const parsed = TextAnswerValue.safeParse(value);
      if (!parsed.success) {
        return err([encodingError(question)]);
      }
      if (parsed.data === "") {
        return err([emptyAnswerError()]);
      }
      const errors = checkTextConstraints(parsed.data, question.constraints);
      return errors.length > 0 ? err(errors) : ok(parsed.data);
    }
    case "number": {
      const parsed = NumberAnswerValue.safeParse(value);
      if (!parsed.success) {
        return err([encodingError(question)]);
      }
      const { min, max, integer } = question.constraints;
      const errors = checkBounds(parsed.data, min, max, (bound) => String(bound));
      if (integer && !Number.isInteger(parsed.data)) {
        errors.push(failure("NOT_AN_INTEGER", "integer", "Answer must be a whole number"));
      }
      return errors.length > 0 ? err(errors) : ok(parsed.data);
    }
    case "date": {
      const parsed = DateAnswerValue.safeParse(value);
      if (!parsed.success) {
        return err([encodingError(question)]);
      }
      const { min, max } = question.constraints;
      const errors = checkBounds(parsed.data, min, max, (bound) => String(bound));
      return errors.length > 0 ? err(errors) : ok(parsed.data);
    }
    case "boolean": {
      const parsed = BooleanAnswerValue.safeParse(value);
      return parsed.success ? ok(parsed.data) : err([encodingError(question)]);
    }
    case "singleChoice": {
      const parsed = SingleChoiceAnswerValue.safeParse(value);
      if (!parsed.success) {
        return err([encodingError(question)]);
      }
      if (!optionIdsOf(question).includes(parsed.data)) {
        return err([
          failure(
            "UNKNOWN_OPTION",
            "options",
            "Selected option is not one of the question's options",
          ),
        ]);
      }
      return ok(parsed.data);
    }
    case "multiChoice": {
      const parsed = MultiChoiceAnswerValue.safeParse(value);
      if (!parsed.success) {
        return err([encodingError(question)]);
      }
      if (parsed.data.length === 0) {
        return err([emptyAnswerError()]);
      }
      const errors: ValidationError[] = [];
      const known = new Set(optionIdsOf(question));
      // One membership error however many selections are unknown: the
      // constraint failed once, and the ids must not be echoed.
      if (parsed.data.some((optionId) => !known.has(optionId))) {
        errors.push(
          failure(
            "UNKNOWN_OPTION",
            "options",
            "One or more selected options are not among the question's options",
          ),
        );
      }
      // Counts apply to the canonical, deduplicated selection.
      const { minSelected, maxSelected } = question.constraints;
      if (minSelected !== undefined && parsed.data.length < minSelected) {
        errors.push(
          failure(
            "TOO_FEW_SELECTED",
            "minSelected",
            `Select at least ${String(minSelected)} option(s)`,
          ),
        );
      }
      if (maxSelected !== undefined && parsed.data.length > maxSelected) {
        errors.push(
          failure(
            "TOO_MANY_SELECTED",
            "maxSelected",
            `Select at most ${String(maxSelected)} option(s)`,
          ),
        );
      }
      return errors.length > 0 ? err(errors) : ok(parsed.data);
    }
  }
}
