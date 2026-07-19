import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CONDITION_MAX_DEPTH,
  conditionDepth,
  isCondition,
  isVisibilityRule,
  parseCondition,
  parseVisibilityRule,
} from "./index.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, ...segments), "utf8"));
}

/** A condition tree of exactly the given depth: a leaf wrapped in `not`s. */
function nested(depth: number): unknown {
  let condition: unknown = { op: "answered", questionId: "q_a" };
  for (let level = 1; level < depth; level += 1) {
    condition = { op: "not", condition };
  }
  return condition;
}

function expectParses(condition: unknown): void {
  const result = parseCondition(condition);
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

function expectRejects(condition: unknown, code?: string): void {
  const result = parseCondition(condition);
  expect(result.ok).toBe(false);
  if (!result.ok && code !== undefined) {
    expect(result.error.map((error) => error.code)).toContain(code);
  }
}

describe("Condition parses every operator", () => {
  it.each([
    ["equals (boolean)", { op: "equals", questionId: "q_smoker", value: true }],
    ["equals (string)", { op: "equals", questionId: "q_full_name", value: "Ada" }],
    ["equals (multiChoice set)", { op: "equals", questionId: "q_multi", value: ["opt_a"] }],
    ["notEquals", { op: "notEquals", questionId: "q_num", value: 3 }],
    ["in", { op: "in", questionId: "q_num", values: [1, 2, 3] }],
    ["gt (number)", { op: "gt", questionId: "q_num", value: 10 }],
    ["gte (date)", { op: "gte", questionId: "q_dob", value: "2001-02-28" }],
    ["lt", { op: "lt", questionId: "q_num", value: 0.5 }],
    ["lte", { op: "lte", questionId: "q_dob", value: "1999-12-31" }],
    ["answered", { op: "answered", questionId: "q_dob" }],
    ["contains", { op: "contains", questionId: "q_multi", value: "opt_a" }],
    ["containsAny", { op: "containsAny", questionId: "q_multi", values: ["opt_a", "opt_b"] }],
    ["and", { op: "and", conditions: [{ op: "answered", questionId: "q_a" }] }],
    [
      "or",
      {
        op: "or",
        conditions: [
          { op: "answered", questionId: "q_a" },
          { op: "equals", questionId: "q_b", value: false },
        ],
      },
    ],
    ["not", { op: "not", condition: { op: "answered", questionId: "q_a" } }],
  ])("%s", (_label, condition) => {
    expectParses(condition);
    expect(isCondition(condition)).toBe(true);
  });
});

describe("Condition rejects malformed operators", () => {
  it("rejects an unknown op (closed language)", () => {
    expectRejects({ op: "matches", questionId: "q_a", value: "x" }, "INVALID_CONDITION");
  });

  it("rejects a non-object", () => {
    expectRejects("answered", "INVALID_CONDITION");
    expect(isCondition(42)).toBe(false);
  });

  it("rejects empty `in` values", () => {
    expectRejects({ op: "in", questionId: "q_a", values: [] }, "INVALID_CONDITION");
  });

  it("rejects empty `and`/`or` conditions", () => {
    expectRejects({ op: "and", conditions: [] }, "INVALID_CONDITION");
    expectRejects({ op: "or", conditions: [] }, "INVALID_CONDITION");
  });

  it("rejects empty `containsAny` values", () => {
    expectRejects({ op: "containsAny", questionId: "q_multi", values: [] }, "INVALID_CONDITION");
  });

  it("rejects `contains` with a non-OptionId value", () => {
    expectRejects({ op: "contains", questionId: "q_multi", value: "diabetes" });
    expectRejects({ op: "contains", questionId: "q_multi", value: 3 });
  });

  it("rejects ordered operators with a non-Comparable value", () => {
    expectRejects({ op: "gt", questionId: "q_a", value: true });
    expectRejects({ op: "lt", questionId: "q_a", value: "not-a-date" });
    expectRejects({ op: "gte", questionId: "q_a", value: [1] });
  });

  it("rejects `not` without a condition and `equals` without a value", () => {
    expectRejects({ op: "not" });
    expectRejects({ op: "equals", questionId: "q_a" });
  });

  it("rejects a malformed questionId", () => {
    expectRejects({ op: "answered", questionId: "frm_a" });
  });
});

describe("nesting depth cap (DOMAIN_SCHEMA §3)", () => {
  it("accepts depth 8 exactly", () => {
    expectParses(nested(CONDITION_MAX_DEPTH));
  });

  it("rejects depth 9 with RULE_DEPTH_EXCEEDED", () => {
    expectRejects(nested(CONDITION_MAX_DEPTH + 1), "RULE_DEPTH_EXCEEDED");
  });

  it("measures depth as the deepest branch of and/or", () => {
    const result = parseCondition({
      op: "and",
      conditions: [{ op: "answered", questionId: "q_a" }, nested(4)],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(conditionDepth(result.value)).toBe(5);
    }
  });

  it("flags the offending rule when the deep condition sits inside a rule", () => {
    const result = parseVisibilityRule({
      ruleId: "rul_deep",
      when: nested(9),
      show: ["q_b"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "RULE_DEPTH_EXCEEDED", path: ["when"] }),
        ]),
      );
    }
  });
});

describe("VisibilityRule", () => {
  it("parses question and step targets", () => {
    const result = parseVisibilityRule({
      ruleId: "rul_smoker_followup",
      when: { op: "equals", questionId: "q_smoker", value: true },
      show: ["q_cigs_daily", "stp_health"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty show list", () => {
    const result = parseVisibilityRule({
      ruleId: "rul_x",
      when: { op: "answered", questionId: "q_a" },
      show: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_VISIBILITY_RULE", path: ["show"] }),
        ]),
      );
    }
  });

  it("rejects show targets that are neither QuestionId nor StepId", () => {
    expect(
      isVisibilityRule({
        ruleId: "rul_x",
        when: { op: "answered", questionId: "q_a" },
        show: ["opt_a"],
      }),
    ).toBe(false);
  });

  it("rejects a malformed ruleId", () => {
    expect(
      isVisibilityRule({
        ruleId: "rule-1",
        when: { op: "answered", questionId: "q_a" },
        show: ["q_b"],
      }),
    ).toBe(false);
  });
});

describe("fixture regression: form fixtures' rules parse under the real DSL", () => {
  it.each(["kitchen-sink.json", "insurance.json"])("%s", (file) => {
    const form = readJson("forms", "valid", file) as { rules: unknown[] };
    expect(form.rules.length).toBeGreaterThan(0);
    for (const rule of form.rules) {
      const result = parseVisibilityRule(rule);
      expect(result.ok, `rule did not parse: ${JSON.stringify(result)}`).toBe(true);
    }
  });
});
