import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PublishError,
  PublishErrorCode,
  err,
  ok,
  parseFormDefinition,
  publishErrorLocation,
  type FrozenSnapshot,
  type PublishResult,
} from "./index.js";

/**
 * Compile-time lockstep check: the discriminated union's `code` literals and
 * the PublishErrorCode enum are mutually assignable. Drifting either way (a
 * variant without an enum member, or vice versa) turns this into `never`.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const codesInLockstep: MutuallyAssignable<PublishError["code"], PublishErrorCode> = true;

/** One representative instance per code, with the location the admin renders. */
const samples: { raw: unknown; location: string }[] = [
  {
    raw: {
      code: "DANGLING_QUESTION_REF",
      message: "Step pins a question that does not exist",
      path: { step: "stp_history", question: "q_at_fault_accident" },
    },
    location: 'question "q_at_fault_accident" in step "stp_history"',
  },
  {
    raw: {
      code: "DANGLING_QUESTION_REF",
      message: "Rule condition references a question that is not in the form",
      path: { rule: "rul_accident_followup", question: "q_at_fault_accident" },
    },
    location: 'question "q_at_fault_accident" in rule "rul_accident_followup"',
  },
  {
    raw: {
      code: "DANGLING_OPTION_REF",
      message: "Rule references an option the pinned question version does not carry",
      path: {
        rule: "rul_condition_details",
        question: "q_preexisting_conditions",
        option: "opt_gout",
      },
    },
    location:
      'option "opt_gout" of question "q_preexisting_conditions" in rule "rul_condition_details"',
  },
  {
    raw: {
      code: "DANGLING_STEP_REF",
      message: "Rule shows a step that is not in the form",
      path: { rule: "rul_accident_followup", step: "stp_gone" },
    },
    location: 'step "stp_gone" in rule "rul_accident_followup"',
  },
  {
    raw: {
      code: "UNPUBLISHED_QUESTION_PIN",
      message: "Pinned question version is not published",
      path: { step: "stp_history", question: "q_at_fault_accident", version: 3 },
    },
    location: 'question "q_at_fault_accident"@3 in step "stp_history"',
  },
  {
    raw: {
      code: "LOCALE_INCOMPLETE",
      message: "Form title is missing the default locale",
      path: { locale: "en" },
    },
    location: 'locale "en" missing on form title',
  },
  {
    raw: {
      code: "LOCALE_INCOMPLETE",
      message: "Option label is missing the default locale",
      path: { locale: "en", question: "q_coverage_level", option: "opt_basic" },
    },
    location: 'locale "en" missing on option "opt_basic" of question "q_coverage_level"',
  },
  {
    raw: {
      code: "RULE_BACKWARD_TARGET",
      message: "Rule target does not appear after the questions its condition reads",
      path: { rule: "rul_accident_followup", target: "q_at_fault_accident" },
    },
    location: 'target "q_at_fault_accident" of rule "rul_accident_followup"',
  },
  {
    raw: {
      code: "RULE_CYCLE",
      message: "Cycle in the reads->shows graph",
      path: { rules: ["rul_a_shows_b", "rul_b_shows_a"] },
    },
    location: 'rules "rul_a_shows_b" -> "rul_b_shows_a"',
  },
  {
    raw: {
      code: "RULE_DEPTH_EXCEEDED",
      message: "Condition nesting exceeds the cap of 8",
      path: { rule: "rul_deep" },
    },
    location: 'rule "rul_deep"',
  },
  {
    raw: {
      code: "RULE_TYPE_MISMATCH",
      message: "contains is only valid against multiChoice questions",
      path: { rule: "rul_accident_followup", question: "q_at_fault_accident" },
    },
    location: 'question "q_at_fault_accident" in rule "rul_accident_followup"',
  },
  {
    raw: {
      code: "DUPLICATE_QUESTION_IN_FORM",
      message: "Question is pinned more than once",
      path: { step: "stp_lifestyle", question: "q_at_fault_accident" },
    },
    location: 'question "q_at_fault_accident" in step "stp_lifestyle"',
  },
  {
    raw: {
      code: "DUPLICATE_STEP_ID",
      message: "Duplicate stepId",
      path: { step: "stp_history" },
    },
    location: 'step "stp_history"',
  },
];

describe("PublishError", () => {
  it("codes and union variants stay in lockstep (compile-time)", () => {
    expect(codesInLockstep).toBe(true);
    expect(PublishErrorCode.options).toHaveLength(11);
  });

  it.each(
    samples.map((sample) => [String((sample.raw as { code: string }).code), sample] as const),
  )("%s round-trips through the schema and renders its location", (_code, sample) => {
    const parsed = PublishError.parse(sample.raw);
    expect(publishErrorLocation(parsed)).toBe(sample.location);
  });

  it("samples cover every code", () => {
    const covered = new Set(samples.map((sample) => (sample.raw as { code: string }).code));
    for (const code of PublishErrorCode.options) {
      expect(covered, `no sample covers ${code}`).toContain(code);
    }
  });

  it("rejects an unknown code", () => {
    expect(PublishError.safeParse({ code: "SOMETHING_ELSE", message: "x", path: {} }).success).toBe(
      false,
    );
  });

  it("rejects a variant whose path misses a required key or carries a wrong ID shape", () => {
    expect(
      PublishError.safeParse({
        code: "DANGLING_STEP_REF",
        message: "missing rule key",
        path: { step: "stp_gone" },
      }).success,
    ).toBe(false);
    expect(
      PublishError.safeParse({
        code: "DUPLICATE_STEP_ID",
        message: "not a step id",
        path: { step: "q_at_fault_accident" },
      }).success,
    ).toBe(false);
    expect(
      PublishError.safeParse({
        code: "DANGLING_QUESTION_REF",
        message: "empty message is rejected too",
        path: { question: "q_at_fault_accident" },
      }).success,
    ).toBe(true);
  });
});

describe("PublishResult contract", () => {
  const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));
  const minimal: unknown = JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, "forms", "valid", "minimal.json"), "utf8"),
  );

  it("ok carries a frozen-snapshot-shaped value (implementation is task 008)", () => {
    const parsed = parseFormDefinition(minimal);
    if (!parsed.ok) {
      throw new Error("minimal fixture did not parse");
    }
    const snapshot: FrozenSnapshot = {
      definition: parsed.value,
      questions: [],
      semanticsVersion: 1,
      schemaVersion: 1,
    };
    const result: PublishResult = ok(snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.semanticsVersion).toBe(1);
      expect(result.value.definition.formId).toBe("frm_minimal");
    }
  });

  it("err carries ALL errors, never first-only", () => {
    const errors = samples.map((sample) => PublishError.parse(sample.raw));
    const result: PublishResult = err(errors);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveLength(samples.length);
      expect(new Set(result.error.map((error) => error.code)).size).toBe(
        PublishErrorCode.options.length,
      );
    }
  });
});
