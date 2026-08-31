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
  type Condition,
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

/**
 * **ADR-03: the operator set is closed, and changing it is a deliberate edit.**
 *
 * ADR-03 makes branching a closed, typed DSL whose new operators are versioned core
 * changes. Its own note flagged that nothing enforced the "versioned" half: no operator
 * set was written down anywhere, so an operator could be added to
 * {@link Condition} in one diff and nobody would be asked about it. A closed set that
 * nothing pins is a convention, not a decision.
 *
 * This is the pin, in the spirit of `packages/a2ui-compiler/src/version.test.ts`: a
 * constant that has to be edited by hand, checked against the thing it mirrors.
 *
 * `satisfies Record<Condition["op"], ...>` makes the table exhaustive in **both**
 * directions at compile time - a new operator in the union is a missing key here, and a
 * key the union does not carry is an excess property - and the assertions below add the
 * runtime half: the schema accepts each of these and refuses anything else. So an
 * operator change costs a typecheck failure, a test edit, and a changeset conversation,
 * which is what "versioned core change" was supposed to mean.
 *
 * The admin keeps a parallel copy of this set (R2 stops it importing the kernel as a
 * value), and `apps/admin/lib/forms/condition.ts` pins that copy to the same union with
 * a type-only import. The two halves together are what close the ADR's note: neither
 * side can move without the other going red.
 */
const OPERATOR_SAMPLES = {
  equals: { op: "equals", questionId: "q_a", value: true },
  notEquals: { op: "notEquals", questionId: "q_a", value: 3 },
  in: { op: "in", questionId: "q_a", values: [1, 2] },
  gt: { op: "gt", questionId: "q_a", value: 10 },
  gte: { op: "gte", questionId: "q_a", value: "2001-02-28" },
  lt: { op: "lt", questionId: "q_a", value: 0.5 },
  lte: { op: "lte", questionId: "q_a", value: "1999-12-31" },
  answered: { op: "answered", questionId: "q_a" },
  contains: { op: "contains", questionId: "q_multi", value: "opt_a" },
  containsAny: { op: "containsAny", questionId: "q_multi", values: ["opt_a"] },
  and: { op: "and", conditions: [{ op: "answered", questionId: "q_a" }] },
  or: { op: "or", conditions: [{ op: "answered", questionId: "q_a" }] },
  not: { op: "not", condition: { op: "answered", questionId: "q_a" } },
} satisfies Record<Condition["op"], { op: string }>;

describe("ADR-03: the closed operator set", () => {
  it("is exactly these thirteen operators", () => {
    // Spelled out rather than derived, on purpose: this line is the tripwire. A diff that
    // changes it is a diff someone has to explain, which is the whole point of a closed
    // DSL whose operators are versioned core changes.
    expect(Object.keys(OPERATOR_SAMPLES)).toEqual([
      "equals",
      "notEquals",
      "in",
      "gt",
      "gte",
      "lt",
      "lte",
      "answered",
      "contains",
      "containsAny",
      "and",
      "or",
      "not",
    ]);
  });

  it.each(Object.entries(OPERATOR_SAMPLES))("the schema accepts `%s`", (_op, sample) => {
    expectParses(sample);
  });

  it("refuses an operator that is not in the set, however plausible it reads", () => {
    for (const op of ["startsWith", "matches", "between", "isEmpty"]) {
      expectRejects({ op, questionId: "q_a", value: "x" }, "INVALID_CONDITION");
    }
  });
});

describe("Condition parses every operator", () => {
  it.each([
    ["equals (boolean)", { op: "equals", questionId: "q_at_fault_accident", value: true }],
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
      ruleId: "rul_accident_followup",
      when: { op: "equals", questionId: "q_at_fault_accident", value: true },
      show: ["q_accident_count", "stp_history"],
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
