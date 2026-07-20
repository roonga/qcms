import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  QUESTION_TYPES,
  QuestionDefinitionErrorCode,
  isQuestionDefinition,
  isQuestionVersionRecord,
  optionIdsOf,
  parseQuestionDefinition,
  parseQuestionVersionRecord,
} from "./index.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/questions/", import.meta.url));

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, ...segments), "utf8"));
}

/** Shape of every fixture under fixtures/questions/invalid/. */
const InvalidFixture = z.object({
  description: z.string().min(1),
  expected: z.object({
    code: QuestionDefinitionErrorCode,
    path: z.array(z.union([z.string(), z.number()])),
  }),
  definition: z.unknown(),
});

const validFiles = readdirSync(path.join(FIXTURES_DIR, "valid"));
const invalidFiles = readdirSync(path.join(FIXTURES_DIR, "invalid"));

describe("valid fixtures", () => {
  it.each(validFiles)("%s parses", (file) => {
    const result = parseQuestionDefinition(readJson("valid", file));
    expect(result.ok).toBe(true);
  });

  it("cover every question type exactly once (they seed the kitchen-sink form)", () => {
    const types = validFiles.map((file) => {
      const result = parseQuestionDefinition(readJson("valid", file));
      if (!result.ok) {
        throw new Error(`fixture ${file} did not parse`);
      }
      return result.value.type;
    });
    expect([...types].sort()).toEqual([...QUESTION_TYPES].sort());
  });

  it("include q_smoker (boolean) and q_cigs_daily (number) for the insurance flow", () => {
    const definitions = validFiles.map((file) => {
      const result = parseQuestionDefinition(readJson("valid", file));
      if (!result.ok) {
        throw new Error(`fixture ${file} did not parse`);
      }
      return result.value;
    });
    expect(definitions.find((d) => d.questionId === "q_smoker")?.type).toBe("boolean");
    expect(definitions.find((d) => d.questionId === "q_cigs_daily")?.type).toBe("number");
  });

  it("apply defaults: required=false, constraints={} with inner defaults", () => {
    const longText = parseQuestionDefinition(readJson("valid", "long-text.json"));
    if (!longText.ok) {
      throw new Error("long-text fixture did not parse");
    }
    expect(longText.value.required).toBe(false);

    const minimalNumber = parseQuestionDefinition({
      type: "number",
      questionId: "q_cigs_daily",
      label: { en: "How many per day?" },
    });
    if (!minimalNumber.ok || minimalNumber.value.type !== "number") {
      throw new Error("minimal number definition did not parse");
    }
    expect(minimalNumber.value.required).toBe(false);
    expect(minimalNumber.value.constraints).toEqual({ integer: false });
  });
});

describe("invalid fixtures", () => {
  it.each(invalidFiles)("%s fails with its asserted code and path", (file) => {
    const fixture = InvalidFixture.parse(readJson("invalid", file));
    const result = parseQuestionDefinition(fixture.definition);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: fixture.expected.code,
            path: fixture.expected.path,
          }),
        ]),
      );
    }
  });

  it("cover every refinement code", () => {
    const covered = new Set(
      invalidFiles.map((file) => InvalidFixture.parse(readJson("invalid", file)).expected.code),
    );
    const refinementCodes = QuestionDefinitionErrorCode.options.filter(
      (code) => code !== "INVALID_QUESTION_VERSION_RECORD",
    );
    for (const code of refinementCodes) {
      expect(covered, `no invalid fixture asserts ${code}`).toContain(code);
    }
  });

  it("reports all errors, not just the first", () => {
    const result = parseQuestionDefinition({
      type: "shortText",
      questionId: "q_full_name",
      label: { en: "Full name" },
      constraints: { minLength: 9, maxLength: 3, pattern: "^(a+)+$" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.error.map((error) => error.code);
      expect(codes).toContain("MIN_LENGTH_ABOVE_MAX_LENGTH");
      expect(codes).toContain("PATTERN_UNSUPPORTED");
    }
  });

  it("rejects an unknown type discriminant with the structural code", () => {
    const result = parseQuestionDefinition({
      type: "rating",
      questionId: "q_rating",
      label: { en: "Rate us" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      for (const error of result.error) {
        expect(error.code).toBe("INVALID_QUESTION_DEFINITION");
      }
    }
    expect(isQuestionDefinition({ type: "rating" })).toBe(false);
  });
});

describe("optionId scoping (R6)", () => {
  it("allows the same optionId in two different questions", () => {
    const single = parseQuestionDefinition(readJson("valid", "single-choice.json"));
    const multi = parseQuestionDefinition(readJson("valid", "multi-choice.json"));
    expect(single.ok).toBe(true);
    expect(multi.ok).toBe(true);
    if (single.ok && multi.ok) {
      // Both fixtures deliberately carry opt_none - scoped per question.
      expect(optionIdsOf(single.value)).toContain("opt_none");
      expect(optionIdsOf(multi.value)).toContain("opt_none");
    }
  });

  it("optionIdsOf is [] for non-choice types and ordered for choice types", () => {
    const smoker = parseQuestionDefinition(readJson("valid", "boolean.json"));
    const single = parseQuestionDefinition(readJson("valid", "single-choice.json"));
    if (!smoker.ok || !single.ok) {
      throw new Error("fixtures did not parse");
    }
    expect(optionIdsOf(smoker.value)).toEqual([]);
    expect(optionIdsOf(single.value)).toEqual([
      "opt_basic",
      "opt_standard",
      "opt_premium",
      "opt_none",
    ]);
  });
});

describe("QUESTION_TYPES", () => {
  it("is the closed seven-type set", () => {
    expect(QUESTION_TYPES).toEqual([
      "shortText",
      "longText",
      "number",
      "date",
      "boolean",
      "singleChoice",
      "multiChoice",
    ]);
  });
});

describe("QuestionVersionRecord", () => {
  const definition = readJson("valid", "boolean.json");

  it("parses a valid record", () => {
    const result = parseQuestionVersionRecord({ questionId: "q_smoker", version: 1, definition });
    expect(result.ok).toBe(true);
    expect(isQuestionVersionRecord({ questionId: "q_smoker", version: 3, definition })).toBe(true);
  });

  it.each([0, -1, 1.5, "1"])("rejects version %j with the record code", (version) => {
    const result = parseQuestionVersionRecord({ questionId: "q_smoker", version, definition });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_QUESTION_VERSION_RECORD", path: ["version"] }),
        ]),
      );
    }
  });

  it("keeps refinement codes for issues inside the embedded definition", () => {
    const bad = InvalidFixture.parse(
      readJson("invalid", "multi-choice-min-selected-above-max.json"),
    );
    const result = parseQuestionVersionRecord({
      questionId: "q_preexisting_conditions",
      version: 1,
      definition: bad.definition,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "MIN_SELECTED_ABOVE_MAX_SELECTED",
            path: ["definition", "constraints", "minSelected"],
          }),
        ]),
      );
    }
  });
});
