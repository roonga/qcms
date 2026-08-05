import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  VALIDATION_MESSAGE_KEYS,
  ValidationConstraint,
  ValidationMessageKey,
  ValidationMessages,
  authoredMessageKeys,
  parseQuestionDefinition,
  type QuestionDefinition,
} from "./index.js";

/**
 * Author-supplied validation messages and boolean label overrides (task 048,
 * ADR-32 / ADR-36).
 *
 * The load-bearing properties are additivity (existing content is untouched -
 * `question-definition.test.ts` owns the round-trip half) and the closed key
 * set: a message may only decorate a constraint the question actually carries,
 * which is what `authoredMessageKeys` answers for publish and for the editor.
 */

function question(definition: unknown): QuestionDefinition {
  const result = parseQuestionDefinition(definition);
  if (!result.ok) {
    throw new Error(`definition did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const QUESTION_FIXTURES = fileURLToPath(new URL("../fixtures/questions/valid/", import.meta.url));

describe("additivity: content stored before task 048", () => {
  const files = readdirSync(QUESTION_FIXTURES).filter((file) => file.endsWith(".json"));

  it.each(files)("%s parses with none of the new fields present", (file) => {
    const raw = JSON.parse(readFileSync(path.join(QUESTION_FIXTURES, file), "utf8")) as unknown;
    const parsed = question(raw);
    // Absent, not `undefined`: the parsed object must not gain a key, or every
    // serialization of stored content would change shape.
    expect("messages" in parsed).toBe(false);
    expect("yesLabel" in parsed).toBe(false);
    expect("noLabel" in parsed).toBe(false);
  });

  it.each(files)("%s round-trips byte-identically through parse", (file) => {
    const raw = JSON.parse(readFileSync(path.join(QUESTION_FIXTURES, file), "utf8")) as unknown;
    const once = JSON.stringify(question(raw));
    const twice = JSON.stringify(question(JSON.parse(once)));
    expect(twice).toBe(once);
  });
});

describe("ValidationMessageKey", () => {
  it("is the constraint set an author writes, which is not the runtime constraint set", () => {
    // `required` is authored but is never a runtime ValidationConstraint
    // (presence is a flow concern, checked by prepareSubmission).
    const runtime = new Set<string>(ValidationConstraint.options);
    expect(runtime.has("required")).toBe(false);
    expect(VALIDATION_MESSAGE_KEYS).toContain("required");
    // Every other authored key IS a runtime constraint, so a 422's `constraint`
    // field addresses an authored message directly.
    for (const key of VALIDATION_MESSAGE_KEYS) {
      if (key === "required") continue;
      expect(runtime.has(key)).toBe(true);
    }
    // The runtime-only members are deliberately not authorable: neither is a
    // constraint anybody wrote on the definition.
    const authorable = new Set<string>(VALIDATION_MESSAGE_KEYS);
    expect([...runtime].filter((c) => !authorable.has(c)).sort()).toEqual(["encoding", "options"]);
  });

  it("exposes its canonical order, which projections iterate for determinism", () => {
    expect(VALIDATION_MESSAGE_KEYS).toEqual(ValidationMessageKey.options);
    expect(VALIDATION_MESSAGE_KEYS[0]).toBe("required");
  });
});

describe("ValidationMessages", () => {
  it("is a partial map: any subset of keys, including none", () => {
    expect(ValidationMessages.safeParse({}).success).toBe(true);
    expect(ValidationMessages.safeParse({ pattern: { en: "Use ABC-123" } }).success).toBe(true);
  });

  it("rejects a key that is not a constraint (a typo can never silently not show)", () => {
    expect(ValidationMessages.safeParse({ patern: { en: "oops" } }).success).toBe(false);
    expect(ValidationMessages.safeParse({ encoding: { en: "nope" } }).success).toBe(false);
  });

  it("rejects a non-LocalizedText value", () => {
    expect(ValidationMessages.safeParse({ pattern: "Use ABC-123" }).success).toBe(false);
  });
});

describe("question definitions carrying messages", () => {
  it("accepts a message map on any question type", () => {
    const parsed = question({
      questionId: "q_policy",
      type: "shortText",
      label: { en: "Policy number" },
      required: true,
      constraints: { pattern: "^[A-Z]{3}-\\d{3}$" },
      messages: {
        required: { en: "We need your policy number" },
        pattern: { en: "Policy numbers look like ABC-123" },
      },
    });
    expect(parsed.messages?.pattern).toEqual({ en: "Policy numbers look like ABC-123" });
  });

  it("leaves messages absent when the author supplied none (additive-optional)", () => {
    const parsed = question({
      questionId: "q_plain",
      type: "shortText",
      label: { en: "Plain" },
    });
    expect("messages" in parsed).toBe(false);
  });

  it("accepts boolean label overrides independently (ADR-36)", () => {
    const parsed = question({
      questionId: "q_at_fault",
      type: "boolean",
      label: { en: "At fault?" },
      yesLabel: { en: "I was at fault" },
    });
    expect(parsed.type).toBe("boolean");
    if (parsed.type !== "boolean") throw new Error("unreachable");
    expect(parsed.yesLabel).toEqual({ en: "I was at fault" });
    // Overriding one label leaves the other on the compiler lexicon.
    expect(parsed.noLabel).toBeUndefined();
  });

  it("rejects a boolean label that is not LocalizedText", () => {
    const result = parseQuestionDefinition({
      questionId: "q_at_fault",
      type: "boolean",
      label: { en: "At fault?" },
      yesLabel: "I was at fault",
    });
    expect(result.ok).toBe(false);
  });
});

describe("authoredMessageKeys", () => {
  it("names `required` only when the question is required", () => {
    expect(
      authoredMessageKeys(question({ questionId: "q_a", type: "boolean", label: { en: "A" } })),
    ).toEqual([]);
    expect(
      authoredMessageKeys(
        question({ questionId: "q_a", type: "boolean", label: { en: "A" }, required: true }),
      ),
    ).toEqual(["required"]);
  });

  it("names only the constraints actually set, not everything the type could carry", () => {
    const q = question({
      questionId: "q_name",
      type: "shortText",
      label: { en: "Name" },
      constraints: { minLength: 2 },
    });
    expect(authoredMessageKeys(q)).toEqual(["minLength"]);
  });

  it("returns keys in canonical order regardless of how the constraints were written", () => {
    const q = question({
      questionId: "q_name",
      type: "shortText",
      label: { en: "Name" },
      required: true,
      constraints: { pattern: "^a+$", maxLength: 9, minLength: 2 },
    });
    expect(authoredMessageKeys(q)).toEqual(["required", "minLength", "maxLength", "pattern"]);
  });

  it("treats the number `integer` flag as carried only when it is on", () => {
    const off = question({
      questionId: "q_n",
      type: "number",
      label: { en: "N" },
      constraints: { integer: false },
    });
    const on = question({
      questionId: "q_n",
      type: "number",
      label: { en: "N" },
      constraints: { integer: true, max: 10 },
    });
    expect(authoredMessageKeys(off)).toEqual([]);
    expect(authoredMessageKeys(on)).toEqual(["max", "integer"]);
  });

  it("covers every question type, so a new type cannot be added without deciding this", () => {
    const byType: Record<string, unknown> = {
      shortText: { constraints: { minLength: 1, maxLength: 2, pattern: "^a$" } },
      longText: { constraints: { maxLength: 5 } },
      number: { constraints: { min: 0, max: 1, integer: true } },
      date: { constraints: { min: "2020-01-01", max: "2030-01-01" } },
      boolean: {},
      singleChoice: { options: [{ optionId: "opt_a", label: { en: "A" } }] },
      multiChoice: {
        options: [{ optionId: "opt_a", label: { en: "A" } }],
        constraints: { minSelected: 1, maxSelected: 1 },
      },
    };
    const expected: Record<string, readonly string[]> = {
      shortText: ["minLength", "maxLength", "pattern"],
      longText: ["maxLength"],
      number: ["min", "max", "integer"],
      date: ["min", "max"],
      boolean: [],
      singleChoice: [],
      multiChoice: ["minSelected", "maxSelected"],
    };
    for (const [type, extra] of Object.entries(byType)) {
      const q = question({
        questionId: "q_x",
        type,
        label: { en: type },
        ...(extra as Record<string, unknown>),
      });
      expect(authoredMessageKeys(q), type).toEqual(expected[type]);
    }
  });
});
