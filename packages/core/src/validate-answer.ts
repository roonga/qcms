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
 * Answer validation (task 009, DOMAIN_SCHEMA §2.4 + §2.2 constraints).
 *
 * `validateAnswer` pairs an unknown value with its question: first the value
 * is parsed against the canonical encoding for the question's type (task 002
 * - text is NFC-normalized, multiChoice deduplicated), then **every**
 * constraint on the definition (task 003) is checked. All failed constraints
 * are returned, never just the first - the portal renders the full list next
 * to the input.
 *
 * `required` is deliberately *not* checked here: presence is a flow/submission
 * concern (`prepareSubmission`, invariant I9), not a property of a value.
 * `EMPTY_ANSWER_NOT_ALLOWED` is not an exception to that - it does not ask
 * whether the question was answered, it refuses `""` and `[]` as *encodings*
 * of an answer for every question, required or not (ADR-33, below).
 *
 * Error contract: `{ code, constraint, message }`. `code` is the stable
 * localization key (the portal's shell catalog maps it later - codes are the
 * contract, messages are the built-in fallback); `constraint` names which
 * constraint failed (`"encoding"` for the parse stage). Messages may quote
 * constraint bounds (definition content) but never the submitted value
 * (SECURITY_DESIGN: answer values are never logged).
 */

/** Which check failed: a constraint key from the definition, or `"encoding"`
 * for the canonical-encoding parse stage, or `"options"` for membership. */
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
 * Closed union of validation error codes - the UI localization contract.
 * The `INVALID_*_ANSWER` members are the task-002 parse codes (the encoding
 * stage reuses them so a value that fails the same schema fails with the same
 * code everywhere); most of the rest map one-to-one onto the §2.2 constraints.
 * `EMPTY_ANSWER_NOT_ALLOWED` is the one code with no constraint behind it: it
 * carries ADR-33's "empty text and empty selections are absence, not answers"
 * (see {@link emptyAnswerError}).
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

/** One failed check, suitable for direct UI display next to the input. */
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

/** The encoding-stage failure for each question type (task-002 codes). */
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
 * ADR-33's rule at the ingest boundary: **empty text and empty selections are
 * absence, not answers**, so `""` and `[]` are refused rather than stored.
 *
 * Until this check existed the rule was enforced only at the control boundary
 * (the renderer's `absentIfEmptyText` / `absentIfNoSelection` and the no-JS
 * decoder), which left a hole one layer down: a direct API post of `""` or `[]`
 * was accepted, stored, and then *satisfied* `required` while holding nothing.
 * The rule belongs here because it is a single-value rule (R5), which puts it in
 * front of every caller of the kernel rather than in front of the two clients
 * that already got it right.
 *
 * It **rejects**; it never quietly rewrites the post into a retraction. Clearing
 * an answer has one spelling on the wire - a literal `null` body value (ADR-33,
 * `POST /sessions/{id}/answers`) - and a client that meant to clear should say
 * so, not have an empty value reinterpreted for it. The message names that
 * spelling so the fix is in the response; it quotes no value (SECURITY_DESIGN:
 * answer values are never echoed, and there is nothing to echo here anyway).
 *
 * Reported as an `"encoding"` constraint: like the parse codes, it says the
 * value is not a legal answer of this question's type at all, which is also why
 * it is not authorable (ADR-32 - no author wrote a constraint to produce it) and
 * why it is returned alone rather than joined to the constraint sweep. A
 * `minSelected: 1` question would otherwise report "select at least 1" beside
 * it, which reads as "select more" when the answer is "that was never a
 * selection".
 *
 * Whitespace-only text is deliberately NOT refused here. Issue #128's ruling
 * keeps stored values faithful: `" "` is stored as typed and is denied
 * *presence* instead (`isBlankAnswerValue`), so it cannot satisfy `required`.
 */
function emptyAnswerError(): ValidationError {
  return failure(
    "EMPTY_ANSWER_NOT_ALLOWED",
    "encoding",
    "An empty value is not an answer; send null to clear the answer",
  );
}

/**
 * Length constraints count UTF-16 code units of the NFC-normalized canonical
 * string - the same unit as JS `String.length` and HTML `maxlength`, so what
 * the kernel enforces is what the portal input shows.
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
 * Patterns run under the `u` flag, exactly as validated by the safe-pattern
 * subset at definition parse (task 003 - every accepted pattern is
 * linear-time-safe on the backtracking engine, so `.test` here cannot be a
 * ReDoS vector). Patterns are tested as authored - not implicitly anchored;
 * authors write `^...$` when they mean the whole value.
 *
 * An uncompilable pattern is unreachable through `parseQuestionDefinition`
 * (PATTERN_INVALID at parse), but `validateAnswer` is total over its input
 * types: a hand-constructed definition with a broken pattern reports
 * PATTERN_MISMATCH rather than throwing (the value cannot be shown to match).
 */
function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "u").test(value);
  } catch {
    return false;
  }
}

/** min/max bounds for number (numeric order) and date (lexicographic order
 * over the canonical fixed-width YYYY-MM-DD encoding = calendar order). */
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
 * Validate an unknown value as an answer to `question`: parse against the
 * canonical encoding for the question's type, then check every constraint.
 * Returns the canonical value (NFC-normalized text, deduplicated multiChoice)
 * or **all** failed constraints. Never throws; never checks `required`.
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
      // One membership error regardless of how many selections are unknown:
      // the constraint failed once (and the ids must not be echoed).
      if (parsed.data.some((optionId) => !known.has(optionId))) {
        errors.push(
          failure(
            "UNKNOWN_OPTION",
            "options",
            "One or more selected options are not among the question's options",
          ),
        );
      }
      // Selection counts apply to the canonical (deduplicated) selection.
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
