import { z } from "zod";

import { err, ok, qcmsError, type Result } from "./errors.js";
import { OptionId } from "./ids.js";
import { parseWithCode } from "./internal/parse.js";

/**
 * NFC-normalized on parse rather than refused, so equality and storage see one
 * byte form. Neither trimmed nor non-empty: what makes an empty or
 * whitespace-only string not an answer lives a layer up, so storage stays
 * faithful to what a respondent typed.
 */
export const TextAnswerValue = z.string().transform((value) => value.normalize("NFC"));
export type TextAnswerValue = z.infer<typeof TextAnswerValue>;

/** `z.number()` already refuses NaN and infinities, so no refinement is added. */
export const NumberAnswerValue = z.number();
export type NumberAnswerValue = z.infer<typeof NumberAnswerValue>;

// Proleptic Gregorian.
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isRealCalendarDate(iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_PER_MONTH[month - 1] ?? 0);
  return day <= maxDay;
}

/**
 * Timezone-less, so a date is respondent-local by design, and lexicographic
 * order over this fixed-width encoding is calendar order.
 */
export const DateAnswerValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealCalendarDate, { message: "Not a real calendar date" });
export type DateAnswerValue = z.infer<typeof DateAnswerValue>;

export const BooleanAnswerValue = z.boolean();
export type BooleanAnswerValue = z.infer<typeof BooleanAnswerValue>;

export const SingleChoiceAnswerValue = OptionId;
export type SingleChoiceAnswerValue = z.infer<typeof SingleChoiceAnswerValue>;

/** Deduplicated on parse, so equality over it is set equality (ADR-21). */
export const MultiChoiceAnswerValue = z.array(OptionId).transform((ids) => [...new Set(ids)]);
export type MultiChoiceAnswerValue = z.infer<typeof MultiChoiceAnswerValue>;

/**
 * Untagged by design, the wire form being the raw JSON value, so pairing a value
 * with its question type is `validateAnswer`'s job.
 */
export const AnswerValue = z.union([
  TextAnswerValue,
  NumberAnswerValue,
  BooleanAnswerValue,
  MultiChoiceAnswerValue,
]);
export type AnswerValue = z.infer<typeof AnswerValue>;

/** The operand type for the ordered operators. */
export const Comparable = z.union([NumberAnswerValue, DateAnswerValue]);
export type Comparable = z.infer<typeof Comparable>;

export function parseTextAnswerValue(value: unknown): Result<TextAnswerValue> {
  return parseWithCode(TextAnswerValue, "INVALID_TEXT_ANSWER", "TextAnswerValue", value);
}
export function parseNumberAnswerValue(value: unknown): Result<NumberAnswerValue> {
  return parseWithCode(NumberAnswerValue, "INVALID_NUMBER_ANSWER", "NumberAnswerValue", value);
}
export function parseDateAnswerValue(value: unknown): Result<DateAnswerValue> {
  return parseWithCode(DateAnswerValue, "INVALID_DATE_ANSWER", "DateAnswerValue", value);
}
export function parseBooleanAnswerValue(value: unknown): Result<BooleanAnswerValue> {
  return parseWithCode(BooleanAnswerValue, "INVALID_BOOLEAN_ANSWER", "BooleanAnswerValue", value);
}
export function parseSingleChoiceAnswerValue(value: unknown): Result<SingleChoiceAnswerValue> {
  return parseWithCode(
    SingleChoiceAnswerValue,
    "INVALID_SINGLE_CHOICE_ANSWER",
    "SingleChoiceAnswerValue",
    value,
  );
}
export function parseMultiChoiceAnswerValue(value: unknown): Result<MultiChoiceAnswerValue> {
  return parseWithCode(
    MultiChoiceAnswerValue,
    "INVALID_MULTI_CHOICE_ANSWER",
    "MultiChoiceAnswerValue",
    value,
  );
}
export function parseAnswerValue(value: unknown): Result<AnswerValue> {
  return parseWithCode(AnswerValue, "INVALID_ANSWER_VALUE", "AnswerValue", value);
}
export function parseComparable(value: unknown): Result<Comparable> {
  return parseWithCode(Comparable, "INVALID_COMPARABLE", "Comparable", value);
}

export function isDateAnswerValue(value: unknown): value is DateAnswerValue {
  return DateAnswerValue.safeParse(value).success;
}
export function isAnswerValue(value: unknown): value is AnswerValue {
  return AnswerValue.safeParse(value).success;
}
export function isComparable(value: unknown): value is Comparable {
  return Comparable.safeParse(value).success;
}

export type Ordering = -1 | 0 | 1;

function orderingOf<T extends number | string>(a: T, b: T): Ordering {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

// No message below echoes an answer value (SECURITY_DESIGN).
function comparableKind(value: AnswerValue): "number" | "date" | undefined {
  if (!isComparable(value)) {
    return undefined;
  }
  return typeof value === "number" ? "number" : "date";
}

export function compareValues(a: AnswerValue, b: AnswerValue): Result<Ordering> {
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return err(qcmsError("NOT_COMPARABLE", "Numbers must be finite to be ordered"));
    }
    return ok(orderingOf(a, b));
  }
  if (typeof a === "string" && typeof b === "string") {
    if (!isDateAnswerValue(a) || !isDateAnswerValue(b)) {
      return err(
        qcmsError("NOT_COMPARABLE", "Strings are ordered only as canonical YYYY-MM-DD dates"),
      );
    }
    return ok(orderingOf(a, b));
  }
  const aKind = comparableKind(a);
  const bKind = comparableKind(b);
  if (aKind !== undefined && bKind !== undefined) {
    return err(qcmsError("COMPARE_TYPE_MISMATCH", `Cannot order ${aKind} against ${bKind}`));
  }
  return err(
    qcmsError(
      "NOT_COMPARABLE",
      "Both operands must be finite numbers or canonical YYYY-MM-DD dates",
    ),
  );
}

/**
 * Whether a value is empty or whitespace-only text. Presence rather than
 * encoding: the value is stored verbatim but does not satisfy `required`. No
 * other canonical encoding has a whitespace-only spelling, so this is exact
 * without the question type, which is what lets the evaluator apply it over a
 * bare answer map. An empty selection is refused by `validateAnswer` instead.
 */
export function isBlankAnswerValue(value: AnswerValue): boolean {
  return typeof value === "string" && value.trim() === "";
}

/**
 * Equality for the value operators (ADR-21): strict on scalars, NFC-normalized
 * on strings, set equality on a multiChoice array.
 */
export function valuesEqual(a: AnswerValue, b: AnswerValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return false;
    }
    const setA = new Set<string>(a);
    const setB = new Set<string>(b);
    if (setA.size !== setB.size) {
      return false;
    }
    for (const id of setA) {
      if (!setB.has(id)) {
        return false;
      }
    }
    return true;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a.normalize("NFC") === b.normalize("NFC");
  }
  return a === b;
}
