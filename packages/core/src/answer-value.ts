import { z } from "zod";

import { err, ok, qcmsError, type Result } from "./errors.js";
import { OptionId } from "./ids.js";
import { parseWithCode } from "./internal/parse.js";

/**
 * Canonical AnswerValue encodings (task 002, DOMAIN_SCHEMA §2.4).
 *
 * One canonical encoding per question type, decided before the evaluator
 * exists because these freeze into snapshots, ledger rows, exports, and rule
 * comparisons:
 *
 * | Question type          | Encoding                                        |
 * |------------------------|-------------------------------------------------|
 * | shortText / longText   | NFC-normalized string (normalized on parse)     |
 * | number                 | finite IEEE double                              |
 * | date                   | timezone-less ISO `YYYY-MM-DD`, real calendar   |
 * | boolean                | JSON boolean                                    |
 * | singleChoice           | OptionId                                        |
 * | multiChoice            | OptionId[], deduplicated, order-preserving      |
 */

/**
 * shortText / longText: NFC-normalized string. Non-NFC input is normalized on
 * parse, never rejected - equality and storage always see one byte form.
 */
export const TextAnswerValue = z.string().transform((value) => value.normalize("NFC"));
export type TextAnswerValue = z.infer<typeof TextAnswerValue>;

/**
 * number: finite IEEE double. NaN and ±Infinity are rejected at the encoding;
 * the `integer` constraint is validation (task 009), not encoding.
 */
// `z.number()` already rejects NaN and ±Infinity in Zod 4, so the previous
// `.finite()` refinement (now deprecated) was a redundant no-op.
export const NumberAnswerValue = z.number();
export type NumberAnswerValue = z.infer<typeof NumberAnswerValue>;

/** Gregorian leap-year rule (proleptic). */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** True when `YYYY-MM-DD` names a real calendar date (rejects 2026-02-30). */
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
 * date: timezone-less ISO `YYYY-MM-DD`, validated as a real calendar date.
 * No time, no offset - respondent-local dates by design. Ordering over this
 * encoding is lexicographic, which is correct for fixed-width ISO dates.
 */
export const DateAnswerValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealCalendarDate, { message: "Not a real calendar date" });
export type DateAnswerValue = z.infer<typeof DateAnswerValue>;

/** boolean: JSON boolean. */
export const BooleanAnswerValue = z.boolean();
export type BooleanAnswerValue = z.infer<typeof BooleanAnswerValue>;

/** singleChoice: the selected OptionId. */
export const SingleChoiceAnswerValue = OptionId;
export type SingleChoiceAnswerValue = z.infer<typeof SingleChoiceAnswerValue>;

/**
 * multiChoice: OptionId[], deduplicated on parse (first occurrence wins),
 * order-preserving. The canonical form is always duplicate-free; equality over
 * it is set equality (ADR-21, `valuesEqual`).
 */
export const MultiChoiceAnswerValue = z.array(OptionId).transform((ids) => [...new Set(ids)]);
export type MultiChoiceAnswerValue = z.infer<typeof MultiChoiceAnswerValue>;

/**
 * The union of canonical encodings. Untagged by design - the wire/storage form
 * is the raw JSON value; pairing a value with its question type is the job of
 * `validateAnswer` (task 009). Date and singleChoice values are strings and
 * thus indistinguishable from text without the question - that is expected.
 */
export const AnswerValue = z.union([
  TextAnswerValue,
  NumberAnswerValue,
  BooleanAnswerValue,
  MultiChoiceAnswerValue,
]);
export type AnswerValue = z.infer<typeof AnswerValue>;

/**
 * Operand type for the DSL's ordered operators (`gt/gte/lt/lte`):
 * finite number or canonical date string. Cross-type comparison is a typed
 * error here and unreachable post-publish (rule type-checking, task 005/008).
 */
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

/** Total order result for `compareValues`. */
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

/**
 * Ordered comparison for the DSL's `gt/gte/lt/lte` (task 002).
 * Numbers compare numerically; dates compare lexicographically on the
 * canonical `YYYY-MM-DD` encoding (equivalent to calendar order).
 * Number-vs-date is `COMPARE_TYPE_MISMATCH`; any operand that is not a
 * Comparable (booleans, arrays, non-date strings, non-finite numbers) is
 * `NOT_COMPARABLE`. Error messages never echo answer values (SEC).
 */
/** The ordered kind of a comparable operand, or `undefined` if not comparable. */
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
 * Canonical value equality used by `equals`/`notEquals`/`in` (ADR-21):
 * strict equality on scalars (strings compared after NFC normalization),
 * set equality for multiChoice arrays (order- and duplicate-insensitive).
 * Values of different canonical types are never equal.
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
