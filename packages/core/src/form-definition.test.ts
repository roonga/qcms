import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  FormDefinitionErrorCode,
  isFormDefinition,
  parseFormDefinition,
  parseQuestionDefinition,
} from "./index.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, ...segments), "utf8"));
}

/** Shape of every fixture under fixtures/forms/invalid/. */
const InvalidFixture = z.object({
  description: z.string().min(1),
  expected: z.object({
    code: FormDefinitionErrorCode,
    path: z.array(z.union([z.string(), z.number()])),
  }),
  definition: z.unknown(),
});

const validFiles = readdirSync(path.join(FIXTURES_DIR, "forms", "valid"));
const invalidFiles = readdirSync(path.join(FIXTURES_DIR, "forms", "invalid"));

function parseValid(file: string) {
  const result = parseFormDefinition(readJson("forms", "valid", file));
  if (!result.ok) {
    throw new Error(`fixture ${file} did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** questionId -> type map of the task-003 question fixtures the forms pin. */
function questionFixtureTypes(): Map<string, string> {
  const types = new Map<string, string>();
  for (const file of readdirSync(path.join(FIXTURES_DIR, "questions", "valid"))) {
    const result = parseQuestionDefinition(readJson("questions", "valid", file));
    if (!result.ok) {
      throw new Error(`question fixture ${file} did not parse`);
    }
    types.set(result.value.questionId, result.value.type);
  }
  return types;
}

describe("valid fixtures", () => {
  it.each(validFiles)("%s parses", (file) => {
    expect(parseFormDefinition(readJson("forms", "valid", file)).ok).toBe(true);
    expect(isFormDefinition(readJson("forms", "valid", file))).toBe(true);
  });

  it("only pin questions that exist as question fixtures (no dangling seeds)", () => {
    const known = questionFixtureTypes();
    for (const file of validFiles) {
      const form = parseValid(file);
      for (const step of form.steps) {
        for (const item of step.items) {
          expect(known.has(item.questionId), `${file} pins unknown ${item.questionId}`).toBe(true);
        }
      }
    }
  });
});

describe("kitchen-sink.json (canonical reference form)", () => {
  const form = parseValid("kitchen-sink.json");

  it("has at least 3 steps and at least one rule", () => {
    expect(form.steps.length).toBeGreaterThanOrEqual(3);
    expect(form.rules.length).toBeGreaterThanOrEqual(1);
  });

  it("covers every question type via the question fixtures it pins", () => {
    const known = questionFixtureTypes();
    const pinnedTypes = new Set(
      form.steps.flatMap((step) => step.items.map((item) => known.get(item.questionId))),
    );
    expect([...pinnedTypes].sort()).toEqual(
      ["boolean", "date", "longText", "multiChoice", "number", "shortText", "singleChoice"].sort(),
    );
  });
});

describe("insurance.json (DOMAIN_SCHEMA §6 flow)", () => {
  const form = parseValid("insurance.json");

  it("pins q_smoker@2 then q_cigs_daily@1 in stp_health, with the follow-up rule", () => {
    expect(form.formId).toBe("frm_life_signup");
    expect(form.steps).toHaveLength(1);
    expect(form.steps[0]?.stepId).toBe("stp_health");
    expect(form.steps[0]?.items).toEqual([
      { questionId: "q_smoker", version: 2 },
      { questionId: "q_cigs_daily", version: 1 },
    ]);
    expect(form.rules).toHaveLength(1);
  });
});

describe("minimal.json", () => {
  const form = parseValid("minimal.json");

  it("is one step, one question, no rules", () => {
    expect(form.steps).toHaveLength(1);
    expect(form.steps[0]?.items).toHaveLength(1);
    expect(form.rules).toEqual([]);
  });
});

describe("invalid fixtures", () => {
  it.each(invalidFiles)("%s fails with its asserted code and path", (file) => {
    const fixture = InvalidFixture.parse(readJson("forms", "invalid", file));
    const result = parseFormDefinition(fixture.definition);
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
      invalidFiles.map(
        (file) => InvalidFixture.parse(readJson("forms", "invalid", file)).expected.code,
      ),
    );
    for (const code of FormDefinitionErrorCode.options) {
      expect(covered, `no invalid fixture asserts ${code}`).toContain(code);
    }
  });

  it("reports all errors, not just the first", () => {
    const result = parseFormDefinition({
      formId: "frm_life_signup",
      defaultLocale: "en",
      title: { en: "Life insurance sign-up" },
      steps: [
        {
          stepId: "stp_health",
          title: { en: "Health" },
          items: [
            { questionId: "q_smoker", version: 2 },
            { questionId: "q_smoker", version: 2 },
          ],
        },
        {
          stepId: "stp_health",
          title: { en: "Health again" },
          items: [{ questionId: "q_cigs_daily", version: 1 }],
        },
      ],
      rules: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.error.map((error) => error.code);
      expect(codes).toContain("DUPLICATE_STEP_ID");
      expect(codes).toContain("DUPLICATE_QUESTION_IN_FORM");
    }
  });

  it.each([0, -1, 1.5, "1"])("rejects pin version %j structurally", (version) => {
    const result = parseFormDefinition({
      formId: "frm_minimal",
      defaultLocale: "en",
      title: { en: "Minimal" },
      steps: [
        {
          stepId: "stp_only",
          title: { en: "The only step" },
          items: [{ questionId: "q_full_name", version }],
        },
      ],
      rules: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "INVALID_FORM_DEFINITION",
            path: ["steps", 0, "items", 0, "version"],
          }),
        ]),
      );
    }
  });
});

describe("rules are opaque at parse (task 005 owns the DSL)", () => {
  it("passes arbitrary rule entries through unvalidated", () => {
    const result = parseFormDefinition({
      formId: "frm_minimal",
      defaultLocale: "en",
      title: { en: "Minimal" },
      steps: [
        {
          stepId: "stp_only",
          title: { en: "The only step" },
          items: [{ questionId: "q_full_name", version: 1 }],
        },
      ],
      rules: [{ anything: "goes" }, 42, "not a rule"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rules).toEqual([{ anything: "goes" }, 42, "not a rule"]);
    }
  });
});
