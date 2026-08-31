/**
 * The stored semantics stamp parser (issue #723). Pure, no database: the
 * integration suites cover what each call site does with the result.
 */

import { SEMANTICS_VERSION } from "@qcms/core";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../errors.js";
import { parseSemanticsVersion, unsupportedSemanticsVersion } from "./semantics-version.js";

describe("parseSemanticsVersion", () => {
  it("reads the stamp publish writes", () => {
    expect(parseSemanticsVersion(String(SEMANTICS_VERSION))).toBe(SEMANTICS_VERSION);
  });

  it("reads a stamp this evaluator does not implement, leaving the gate to decide", () => {
    // Not this parser's call: an old snapshot has a perfectly readable stamp.
    expect(parseSemanticsVersion("999")).toBe(999);
  });

  it.each(["", " ", "1 ", " 1", "1.0", "1e3", "0x1", "-1", "one", "NaN", "Infinity"])(
    "refuses %o rather than coercing it to a number that compares wrong",
    (stored) => {
      expect(() => parseSemanticsVersion(stored)).toThrow(ApiError);
    },
  );

  it("refuses with the typed envelope code, at 409, naming no snapshot content", () => {
    try {
      parseSemanticsVersion("not-a-number");
      expect.unreachable("a corrupt stamp must not parse");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");
      expect(apiError.status).toBe(409);
      expect(apiError.message).not.toContain("not-a-number");
    }
  });
});

describe("unsupportedSemanticsVersion", () => {
  it("is the one refusal both causes share, so the envelope reads the same either way", () => {
    const refusal = unsupportedSemanticsVersion();
    expect(refusal.toEnvelope()).toEqual({
      error: {
        code: "UNSUPPORTED_SEMANTICS_VERSION",
        message: refusal.message,
      },
    });
  });
});
