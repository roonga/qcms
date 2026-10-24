import { z } from "zod";

import { err, ok, qcmsError, type Result } from "./errors.js";
import { OptionId } from "./ids.js";
import { parseWithCode } from "./internal/parse.js";

/**
 * Canonical AnswerValue encodings, one per question type (DOMAIN_SCHEMA §2.4).
 * They freeze into snapshots, ledger rows, exports and rule comparisons.
 */

/**
 * NFC-normalized string. Non-NFC input is normalized on parse rather than
 * refused, so equality and storage always see one byte form.
 *
 * Not trimmed and with no `.min(1)`: what a respondent typed is what is stored.
 * The rules that make an empty or whitespace-only string not an answer live one
 * layer up, in `validateAnswer` and {@link isBlankAnswerValue}, so that storage
 * stays faithful.
 */
export const TextAnswerValue = z.string().transform((value) => value.normalize("NFC"));
export type TextAnswerValue = z.infer<typeof TextAnswerValue>;

/**
 * Finite IEEE double. The `integer` constraint is validation, not encoding, and
 * `z.number()` already refuses NaN and infinities, so no refinement is needed.
 */
export const NumberAnswerValue = z.number();
export type NumberAnswerValue = z.infer<typeof NumberAnswerValue>;

/** Gregorian leap-year rule (proleptic). */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** True when `YYYY-MM-DD` names a real calendar date. */
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
 * Timezone-less ISO `YYYY-MM-DD`: no time and no offset, so a date is
 * respondent-local by design. Lexicographic order over this fixed-width
 * encoding is calendar order.
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

/**
 * Deduplicated on parse, first occurrence winning, so the canonical form is
 * always duplicate-free and equality over it is set equality (ADR-21).
 */
export const MultiChoiceAnswerValue = z.array(OptionId).transform((ids) => [...new Set(ids)]);
export type MultiChoiceAnswerValue = z.infer<typeof MultiChoiceAnswerValue>;

/**
 * The union of canonical encodings, untagged by design: the wire and storage
 * form is the raw JSON value, and pairing a value with its question type is
 * `validateAnswer`'s job. A date and a singleChoice are therefore
 * indistinguishable from text here, which is expected.
 */
export const AnswerValue = z.union([
  TextAnswerValue,
  NumberAnswerValue,
  BooleanAnswerValue,
  MultiChoiceAnswerValue,
]);
export type AnswerValue = z.infer<typeof AnswerValue>;

/**
 * Operand type for the ordered operators. Cross-type comparison is a typed
 * error here and unreachable post-publish, where rule type-checking refuses it.
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

/** Error messages here never echo answer values (SECURITY_DESIGN). */
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
 * A blank answer is a text value that is empty or whitespace-only.
 *
 * Blankness is a presence question rather than an encoding one: the stored value
 * is kept verbatim in the ledger and in exports, but it does not count as an
 * answer wherever presence is tested, so a required question cannot be
 * satisfied with the space bar.
 *
 * Only text can be blank. A `date` and a `singleChoice` are strings too, but
 * their canonical encodings have no whitespace-only spelling, so the predicate
 * is exact without knowing the question type, which is what lets the evaluator
 * apply it over a bare `AnswerMap`. An empty selection is not blank here; it is
 * refused at the boundary by `validateAnswer` instead.
 */
export function isBlankAnswerValue(value: AnswerValue): boolean {
  return typeof value === "string" && value.trim() === "";
}

/**
 * Canonical value equality (ADR-21): strict on scalars, with strings compared
 * after NFC normalization, and set equality for a multiChoice array. Values of
 * different canonical types are never equal.
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
