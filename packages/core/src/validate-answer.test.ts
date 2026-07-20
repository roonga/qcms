import { describe, expect, it } from "vitest";

import {
  parseQuestionDefinition,
  validateAnswer,
  ValidationError,
  type AnswerValue,
  type QuestionDefinition,
  type ValidationConstraint,
  type ValidationErrorCode,
} from "./index.js";

function makeQuestion(definition: unknown): QuestionDefinition {
  const result = parseQuestionDefinition(definition);
  if (!result.ok) {
    throw new Error(`test question did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function question(
  type: string,
  constraints?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): QuestionDefinition {
  return makeQuestion({
    type,
    questionId: "q_test",
    label: { en: "Test" },
    ...(constraints === undefined ? {} : { constraints }),
    ...extra,
  });
}

const OPTIONS = {
  options: [
    { optionId: "opt_a", label: { en: "A" } },
    { optionId: "opt_b", label: { en: "B" } },
    { optionId: "opt_c", label: { en: "C" } },
  ],
};

function valueOf(definition: QuestionDefinition, value: unknown): AnswerValue {
  const result = validateAnswer(definition, value);
  if (!result.ok) {
    throw new Error(`expected ok, got: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function errorsOf(definition: QuestionDefinition, value: unknown): readonly ValidationError[] {
  const result = validateAnswer(definition, value);
  if (result.ok) {
    throw new Error("expected err, got ok");
  }
  return result.error;
}

/** Assert exactly these (code, constraint) pairs, in order. */
function expectErrors(
  errors: readonly ValidationError[],
  expected: readonly [ValidationErrorCode, ValidationConstraint][],
): void {
  expect(errors.map((error) => [error.code, error.constraint])).toEqual(expected);
  for (const error of errors) {
    expect(ValidationError.safeParse(error).success).toBe(true);
  }
}

describe("validateAnswer - shortText", () => {
  const constrained = question("shortText", {
    minLength: 3,
    maxLength: 5,
    pattern: "^[a-z]+$",
  });

  it("accepts a value satisfying every constraint", () => {
    expect(valueOf(constrained, "abcd")).toBe("abcd");
  });

  it("accepts anything string-shaped when unconstrained (required is not checked here)", () => {
    expect(valueOf(question("shortText"), "")).toBe("");
  });

  it("returns the NFC-normalized canonical value", () => {
    const decomposed = "état"; // état in NFD
    expect(valueOf(question("shortText"), decomposed)).toBe("état");
  });

  it("counts length in UTF-16 code units of the NFC form", () => {
    // NFD é is 2 code units, NFC é is 1 - the canonical form is measured.
    const decomposed = "ééé"; // three NFD e-acutes: 6 units raw, 3 canonical
    expectErrors(errorsOf(question("shortText", { minLength: 4, pattern: "^.+$" }), decomposed), [
      ["LENGTH_BELOW_MIN", "minLength"],
    ]);
  });

  it("non-string → exactly the encoding error", () => {
    expectErrors(errorsOf(constrained, 42), [["INVALID_TEXT_ANSWER", "encoding"]]);
  });

  it("minLength violated alone → exactly LENGTH_BELOW_MIN", () => {
    expectErrors(errorsOf(constrained, "ab"), [["LENGTH_BELOW_MIN", "minLength"]]);
  });

  it("maxLength violated alone → exactly LENGTH_ABOVE_MAX", () => {
    expectErrors(errorsOf(constrained, "abcdef"), [["LENGTH_ABOVE_MAX", "maxLength"]]);
  });

  it("pattern violated alone → exactly PATTERN_MISMATCH", () => {
    expectErrors(errorsOf(constrained, "abc1"), [["PATTERN_MISMATCH", "pattern"]]);
  });

  it("compound violation → all failed constraints", () => {
    expectErrors(errorsOf(constrained, "A1"), [
      ["LENGTH_BELOW_MIN", "minLength"],
      ["PATTERN_MISMATCH", "pattern"],
    ]);
    expectErrors(errorsOf(constrained, "ABCDEFG"), [
      ["LENGTH_ABOVE_MAX", "maxLength"],
      ["PATTERN_MISMATCH", "pattern"],
    ]);
  });

  it("messages never echo the submitted value", () => {
    const secret = "supersecretvalue1";
    for (const error of errorsOf(constrained, secret)) {
      expect(error.message).not.toContain(secret);
    }
  });

  it("an uncompilable pattern (unreachable via parse) fails closed as PATTERN_MISMATCH", () => {
    // Cast justified: constructing the definition parseQuestionDefinition
    // would reject, to exercise validateAnswer's totality contract.
    const broken = {
      ...question("shortText"),
      constraints: { pattern: "(unclosed" },
    } as QuestionDefinition;
    expectErrors(errorsOf(broken, "anything"), [["PATTERN_MISMATCH", "pattern"]]);
  });
});

describe("validateAnswer - longText", () => {
  const constrained = question("longText", { maxLength: 10 });

  it("accepts within bounds and normalizes to NFC", () => {
    expect(valueOf(constrained, "hello")).toBe("hello");
  });

  it("non-string → exactly the encoding error", () => {
    expectErrors(errorsOf(constrained, ["a"]), [["INVALID_TEXT_ANSWER", "encoding"]]);
  });

  it("maxLength violated alone → exactly LENGTH_ABOVE_MAX", () => {
    expectErrors(errorsOf(constrained, "a".repeat(11)), [["LENGTH_ABOVE_MAX", "maxLength"]]);
  });
});

describe("validateAnswer - number", () => {
  const constrained = question("number", { min: 0, max: 100, integer: true });

  it("accepts a conforming value", () => {
    expect(valueOf(constrained, 42)).toBe(42);
  });

  it("accepts non-integers when integer is not set", () => {
    expect(valueOf(question("number"), 3.5)).toBe(3.5);
  });

  it("non-number / non-finite → exactly the encoding error", () => {
    expectErrors(errorsOf(constrained, "42"), [["INVALID_NUMBER_ANSWER", "encoding"]]);
    expectErrors(errorsOf(constrained, Number.NaN), [["INVALID_NUMBER_ANSWER", "encoding"]]);
    expectErrors(errorsOf(constrained, Number.POSITIVE_INFINITY), [
      ["INVALID_NUMBER_ANSWER", "encoding"],
    ]);
  });

  it("min violated alone → exactly VALUE_BELOW_MIN", () => {
    expectErrors(errorsOf(constrained, -1), [["VALUE_BELOW_MIN", "min"]]);
  });

  it("max violated alone → exactly VALUE_ABOVE_MAX", () => {
    expectErrors(errorsOf(constrained, 101), [["VALUE_ABOVE_MAX", "max"]]);
  });

  it("integer violated alone → exactly NOT_AN_INTEGER", () => {
    expectErrors(errorsOf(constrained, 41.5), [["NOT_AN_INTEGER", "integer"]]);
  });

  it("compound violation → all failed constraints", () => {
    expectErrors(errorsOf(constrained, -0.5), [
      ["VALUE_BELOW_MIN", "min"],
      ["NOT_AN_INTEGER", "integer"],
    ]);
    expectErrors(errorsOf(constrained, 100.5), [
      ["VALUE_ABOVE_MAX", "max"],
      ["NOT_AN_INTEGER", "integer"],
    ]);
  });

  it("bounds are inclusive", () => {
    expect(valueOf(constrained, 0)).toBe(0);
    expect(valueOf(constrained, 100)).toBe(100);
  });
});

describe("validateAnswer - date", () => {
  const constrained = question("date", { min: "2000-01-01", max: "2020-12-31" });

  it("accepts a conforming canonical date", () => {
    expect(valueOf(constrained, "2010-06-15")).toBe("2010-06-15");
  });

  it("non-date / non-calendar input → exactly the encoding error", () => {
    expectErrors(errorsOf(constrained, "15/06/2010"), [["INVALID_DATE_ANSWER", "encoding"]]);
    expectErrors(errorsOf(constrained, "2010-02-30"), [["INVALID_DATE_ANSWER", "encoding"]]);
    expectErrors(errorsOf(constrained, 20100615), [["INVALID_DATE_ANSWER", "encoding"]]);
  });

  it("min violated alone → exactly VALUE_BELOW_MIN", () => {
    expectErrors(errorsOf(constrained, "1999-12-31"), [["VALUE_BELOW_MIN", "min"]]);
  });

  it("max violated alone → exactly VALUE_ABOVE_MAX", () => {
    expectErrors(errorsOf(constrained, "2021-01-01"), [["VALUE_ABOVE_MAX", "max"]]);
  });

  it("bounds are inclusive", () => {
    expect(valueOf(constrained, "2000-01-01")).toBe("2000-01-01");
    expect(valueOf(constrained, "2020-12-31")).toBe("2020-12-31");
  });
});

describe("validateAnswer - boolean", () => {
  it("accepts both values", () => {
    expect(valueOf(question("boolean"), true)).toBe(true);
    expect(valueOf(question("boolean"), false)).toBe(false);
  });

  it("non-boolean → exactly the encoding error", () => {
    expectErrors(errorsOf(question("boolean"), "true"), [["INVALID_BOOLEAN_ANSWER", "encoding"]]);
    expectErrors(errorsOf(question("boolean"), 1), [["INVALID_BOOLEAN_ANSWER", "encoding"]]);
  });
});

describe("validateAnswer - singleChoice", () => {
  const choice = question("singleChoice", undefined, OPTIONS);

  it("accepts a declared option", () => {
    expect(valueOf(choice, "opt_b")).toBe("opt_b");
  });

  it("non-optionId-shaped input → exactly the encoding error", () => {
    expectErrors(errorsOf(choice, 7), [["INVALID_SINGLE_CHOICE_ANSWER", "encoding"]]);
    expectErrors(errorsOf(choice, "not-an-option-id"), [
      ["INVALID_SINGLE_CHOICE_ANSWER", "encoding"],
    ]);
  });

  it("a well-formed but undeclared optionId → exactly UNKNOWN_OPTION", () => {
    expectErrors(errorsOf(choice, "opt_zzz"), [["UNKNOWN_OPTION", "options"]]);
  });
});

describe("validateAnswer - multiChoice", () => {
  const choice = question("multiChoice", { minSelected: 1, maxSelected: 2 }, OPTIONS);

  it("accepts a conforming selection, deduplicated preserving order", () => {
    expect(valueOf(choice, ["opt_b", "opt_a", "opt_b"])).toEqual(["opt_b", "opt_a"]);
  });

  it("non-array / non-optionId elements → exactly the encoding error", () => {
    expectErrors(errorsOf(choice, "opt_a"), [["INVALID_MULTI_CHOICE_ANSWER", "encoding"]]);
    expectErrors(errorsOf(choice, [1, 2]), [["INVALID_MULTI_CHOICE_ANSWER", "encoding"]]);
  });

  it("undeclared option → exactly UNKNOWN_OPTION (once, however many)", () => {
    expectErrors(errorsOf(choice, ["opt_x", "opt_y"]), [["UNKNOWN_OPTION", "options"]]);
  });

  it("minSelected violated alone → exactly TOO_FEW_SELECTED", () => {
    expectErrors(errorsOf(choice, []), [["TOO_FEW_SELECTED", "minSelected"]]);
  });

  it("maxSelected violated alone → exactly TOO_MANY_SELECTED", () => {
    expectErrors(errorsOf(choice, ["opt_a", "opt_b", "opt_c"]), [
      ["TOO_MANY_SELECTED", "maxSelected"],
    ]);
  });

  it("selection counts apply to the deduplicated canonical selection", () => {
    // Three raw entries, two distinct - within maxSelected 2.
    expect(valueOf(choice, ["opt_a", "opt_a", "opt_b"])).toEqual(["opt_a", "opt_b"]);
  });

  it("compound violation → all failed constraints", () => {
    const strict = question("multiChoice", { minSelected: 2, maxSelected: 3 }, OPTIONS);
    expectErrors(errorsOf(strict, ["opt_x"]), [
      ["UNKNOWN_OPTION", "options"],
      ["TOO_FEW_SELECTED", "minSelected"],
    ]);
  });
});
