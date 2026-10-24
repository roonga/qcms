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

// `code` is the contract and `message` the built-in fallback. A message may
// quote a constraint bound, which is definition content, but never the
// submitted value (SECURITY_DESIGN).

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
 * The localization contract. The encoding stage reuses the parse codes, so a
 * value failing one schema fails with the same code everywhere.
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

// Empty text and an empty selection are absence rather than answers (ADR-33),
// refused here in front of every caller of the kernel, since at the control
// boundary alone a direct post could satisfy `required` while holding nothing.
// It never rewrites the post into a retraction: clearing has one spelling on the
// wire, which the message names. Returned alone, or a `minSelected: 1` question
// would also say "select at least 1", reading as "select more". Whitespace-only
// text is not refused here; `isBlankAnswerValue` denies it presence instead.
function emptyAnswerError(): ValidationError {
  return failure(
    "EMPTY_ANSWER_NOT_ALLOWED",
    "encoding",
    "An empty value is not an answer; send null to clear the answer",
  );
}

// Lengths count UTF-16 code units of the canonical string, the unit HTML
// `maxlength` uses, so the kernel enforces what the input shows.
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

// The `u` flag is the one the safe-pattern subset validated against, so this
// `.test` cannot be a ReDoS vector. Tested as authored, never implicitly
// anchored, and a pattern that does not compile reports a mismatch rather than
// throwing, so this stays total over a hand-constructed definition.
function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "u").test(value);
  } catch {
    return false;
  }
}

// A date compares lexicographically, which over its encoding is calendar order.
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
 * Returns the canonical value or every failed constraint, never only the first.
 * Never throws, and never checks `required`, presence being a flow concern (I9).
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
      // One error however many are unknown, and the ids are not echoed.
      if (parsed.data.some((optionId) => !known.has(optionId))) {
        errors.push(
          failure(
            "UNKNOWN_OPTION",
            "options",
            "One or more selected options are not among the question's options",
          ),
        );
      }
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
