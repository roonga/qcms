import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  compareValues,
  isAnswerValue,
  isComparable,
  isDateAnswerValue,
  parseAnswerValue,
  parseBooleanAnswerValue,
  parseComparable,
  parseDateAnswerValue,
  parseMultiChoiceAnswerValue,
  parseNumberAnswerValue,
  parseOptionId,
  parseSingleChoiceAnswerValue,
  parseTextAnswerValue,
  valuesEqual,
  type OptionId,
  type QcmsError,
  type Result,
} from "./index.js";

/** Test helper: unwrap an ok Result or fail loudly. */
function unwrap<T>(result: Result<T, QcmsError>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

/** Test helper: assert failure and return the typed error. */
function unwrapErr<T>(result: Result<T, QcmsError>): QcmsError {
  if (result.ok) {
    throw new Error("expected a typed error, got ok");
  }
  return result.error;
}

/** Test helper: branded OptionId from a known-good literal. */
function oid(value: string): OptionId {
  return unwrap(parseOptionId(value));
}

describe("round-trips: every valid canonical encoding parses and re-serializes identically", () => {
  it("text (already NFC)", () => {
    for (const value of ["hello", "Café", "", "line one\nline two"]) {
      expect(unwrap(parseTextAnswerValue(value))).toBe(value);
      expect(unwrap(parseAnswerValue(value))).toBe(value);
    }
  });

  it("number (finite doubles)", () => {
    for (const value of [0, 42, -0.5, 1e308, Number.MIN_SAFE_INTEGER]) {
      expect(unwrap(parseNumberAnswerValue(value))).toBe(value);
      expect(unwrap(parseAnswerValue(value))).toBe(value);
    }
  });

  it("date (real calendar dates, incl. leap days)", () => {
    for (const value of ["2026-02-28", "2024-02-29", "2000-02-29", "1999-12-31"]) {
      expect(unwrap(parseDateAnswerValue(value))).toBe(value);
      expect(isDateAnswerValue(value)).toBe(true);
    }
  });

  it("boolean", () => {
    for (const value of [true, false]) {
      expect(unwrap(parseBooleanAnswerValue(value))).toBe(value);
      expect(unwrap(parseAnswerValue(value))).toBe(value);
    }
  });

  it("singleChoice (OptionId)", () => {
    expect(unwrap(parseSingleChoiceAnswerValue("opt_yes"))).toBe("opt_yes");
  });

  it("multiChoice (already-deduplicated OptionId[])", () => {
    const value = ["opt_a", "opt_b", "opt_c"];
    expect(unwrap(parseMultiChoiceAnswerValue(value))).toEqual(value);
    expect(unwrap(parseAnswerValue(value))).toEqual(value);
  });

  it("JSON round-trip is byte-identical for canonical values", () => {
    for (const value of ["Café", 42, true, "2026-02-28", "opt_yes", ["opt_a", "opt_b"]]) {
      const json = JSON.stringify(value);
      expect(JSON.stringify(unwrap(parseAnswerValue(JSON.parse(json))))).toBe(json);
    }
  });
});

describe("rejections carry typed error codes", () => {
  it("rejects NaN and ±Infinity with INVALID_NUMBER_ANSWER", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(unwrapErr(parseNumberAnswerValue(bad)).code).toBe("INVALID_NUMBER_ANSWER");
      expect(unwrapErr(parseAnswerValue(bad)).code).toBe("INVALID_ANSWER_VALUE");
      expect(isAnswerValue(bad)).toBe(false);
    }
  });

  it("rejects impossible calendar dates (2026-02-30) with INVALID_DATE_ANSWER", () => {
    for (const bad of [
      "2026-02-30",
      "2025-02-29", // not a leap year
      "1900-02-29", // century, not a leap year
      "2026-13-01",
      "2026-00-10",
      "2026-01-32",
      "2026-01-00",
    ]) {
      expect(unwrapErr(parseDateAnswerValue(bad)).code).toBe("INVALID_DATE_ANSWER");
      expect(isDateAnswerValue(bad)).toBe(false);
    }
  });

  it("rejects non-canonical date shapes (time parts, offsets, loose digits)", () => {
    for (const bad of ["2026-1-2", "2026-01-02T00:00:00Z", "2026/01/02", "20260102", ""]) {
      expect(unwrapErr(parseDateAnswerValue(bad)).code).toBe("INVALID_DATE_ANSWER");
    }
  });

  it("normalizes non-NFC text instead of rejecting it", () => {
    const nfc = `Caf${String.fromCharCode(0xe9)}`; // precomposed e-acute (NFC)
    const nfd = nfc.normalize("NFD"); // e + combining acute (U+0301)
    expect(nfd).not.toBe(nfc); // the two byte forms really differ
    expect(unwrap(parseTextAnswerValue(nfd))).toBe(nfc);
    expect(unwrap(parseAnswerValue(nfd))).toBe(nfc);
  });

  it("deduplicates multiChoice options, preserving first-occurrence order", () => {
    const result = unwrap(parseMultiChoiceAnswerValue(["opt_b", "opt_a", "opt_b", "opt_a"]));
    expect(result).toEqual(["opt_b", "opt_a"]);
  });

  it("rejects bad OptionId prefixes in choice answers", () => {
    expect(unwrapErr(parseSingleChoiceAnswerValue("q_smoker")).code).toBe(
      "INVALID_SINGLE_CHOICE_ANSWER",
    );
    expect(unwrapErr(parseMultiChoiceAnswerValue(["opt_a", "zzz_b"])).code).toBe(
      "INVALID_MULTI_CHOICE_ANSWER",
    );
  });

  it("rejects non-Comparable input with INVALID_COMPARABLE", () => {
    for (const bad of [true, "not-a-date", ["opt_a"], Number.NaN, null]) {
      expect(unwrapErr(parseComparable(bad)).code).toBe("INVALID_COMPARABLE");
      expect(isComparable(bad)).toBe(false);
    }
    expect(unwrap(parseComparable("2026-01-31"))).toBe("2026-01-31");
    expect(unwrap(parseComparable(3.5))).toBe(3.5);
  });
});

describe("compareValues", () => {
  /** Arbitrary valid canonical date via epoch-day, spanning years ~54–9999. */
  const isoDate = fc
    .integer({ min: -700_000, max: 2_932_896 })
    .map((epochDay) => new Date(epochDay * 86_400_000).toISOString().slice(0, 10));

  it("agrees with Date comparison for 1000 random valid date pairs", () => {
    fc.assert(
      fc.property(isoDate, isoDate, (a, b) => {
        const expected = Math.sign(new Date(a).getTime() - new Date(b).getTime());
        expect(unwrap(compareValues(a, b))).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it("agrees with numeric comparison for random finite doubles", () => {
    const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(finite, finite, (a, b) => {
        let expected = 0;
        if (a < b) {
          expected = -1;
        } else if (a > b) {
          expected = 1;
        }
        expect(unwrap(compareValues(a, b))).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it("rejects number-vs-date with COMPARE_TYPE_MISMATCH (both directions)", () => {
    const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(finite, isoDate, (num, date) => {
        expect(unwrapErr(compareValues(num, date)).code).toBe("COMPARE_TYPE_MISMATCH");
        expect(unwrapErr(compareValues(date, num)).code).toBe("COMPARE_TYPE_MISMATCH");
      }),
      { numRuns: 200 },
    );
  });

  it("returns 0 for equal operands", () => {
    expect(unwrap(compareValues("2026-02-28", "2026-02-28"))).toBe(0);
    expect(unwrap(compareValues(7, 7))).toBe(0);
  });

  it("rejects operands that are not Comparable with NOT_COMPARABLE", () => {
    expect(unwrapErr(compareValues(true, false)).code).toBe("NOT_COMPARABLE");
    expect(unwrapErr(compareValues("abc", "2026-01-01")).code).toBe("NOT_COMPARABLE");
    expect(unwrapErr(compareValues("2026-02-30", "2026-01-01")).code).toBe("NOT_COMPARABLE");
    expect(unwrapErr(compareValues([oid("opt_a")], 1)).code).toBe("NOT_COMPARABLE");
    expect(unwrapErr(compareValues(Number.NaN, 1)).code).toBe("NOT_COMPARABLE");
    expect(unwrapErr(compareValues(true, 1)).code).toBe("NOT_COMPARABLE");
  });
});

describe("valuesEqual (ADR-21 canonical equality)", () => {
  it("multiChoice is order-insensitive: [a,b] equals [b,a]", () => {
    expect(valuesEqual([oid("opt_a"), oid("opt_b")], [oid("opt_b"), oid("opt_a")])).toBe(true);
  });

  it("multiChoice is duplicate-insensitive", () => {
    expect(
      valuesEqual([oid("opt_a"), oid("opt_a"), oid("opt_b")], [oid("opt_b"), oid("opt_a")]),
    ).toBe(true);
    expect(valuesEqual([oid("opt_a")], [oid("opt_a"), oid("opt_a")])).toBe(true);
  });

  it("multiChoice set inequality", () => {
    expect(valuesEqual([oid("opt_a")], [oid("opt_a"), oid("opt_b")])).toBe(false);
    expect(valuesEqual([oid("opt_a")], [])).toBe(false);
    expect(valuesEqual([], [])).toBe(true);
  });

  it("scalars compare strictly", () => {
    expect(valuesEqual("opt_a", "opt_a")).toBe(true);
    expect(valuesEqual(1.5, 1.5)).toBe(true);
    expect(valuesEqual(true, true)).toBe(true);
    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual("a", "b")).toBe(false);
    expect(valuesEqual(true, false)).toBe(false);
  });

  it("strings compare after NFC normalization", () => {
    const nfc = `Caf${String.fromCharCode(0xe9)}`;
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(valuesEqual(nfd, nfc)).toBe(true);
  });

  it("cross-type values are never equal", () => {
    expect(valuesEqual("1", 1)).toBe(false);
    expect(valuesEqual(1, true)).toBe(false);
    expect(valuesEqual(0, false)).toBe(false);
    expect(valuesEqual("", false)).toBe(false);
    expect(valuesEqual("true", true)).toBe(false);
    expect(valuesEqual([oid("opt_a")], "opt_a")).toBe(false);
    expect(valuesEqual("opt_a", [oid("opt_a")])).toBe(false);
  });
});
