import { parseVisibilityRule } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { QUESTION_TYPES, type QuestionType } from "../questions/types.ts";

import {
  addBranch,
  conditionDepth,
  conditionForOp,
  conditionReferences,
  isCombinator,
  isOpSupported,
  MAX_CONDITION_DEPTH,
  nodeAt,
  removeBranch,
  replaceAt,
  operandKind,
} from "./condition.ts";
import { CONDITION_OPS, type DraftCondition, type LeafConditionOp } from "./types.ts";

/**
 * Exit criterion 4: **the editor never emits DSL the schema rejects.**
 *
 * The fuzz below is the criterion stated as a property. Every operator the picker offers,
 * against every question type the library can hold, with and without declared options,
 * built through the one function every edit path goes through - then serialized and
 * parsed with 005's own `parseVisibilityRule`. If any picker sequence could produce a
 * shape the kernel refuses, this is where it shows up, rather than as a 422 on an
 * author's autosave.
 *
 * The kernel schema is imported here on purpose: a hand-rolled restatement of it in the
 * test would drift from the thing it is supposed to be checking against. `.test.ts` files
 * are outside the R2 import-surface scan for exactly this reason.
 */

const QUESTION_ID = "q_at_fault_accident";
const OPTIONS = ["opt_yes", "opt_no"] as const;

/** Parse a condition by wrapping it in the smallest legal rule the kernel accepts. */
function parses(condition: DraftCondition): boolean {
  return parseVisibilityRule({
    ruleId: "rul_fuzz",
    when: condition,
    show: ["q_accident_count"],
  }).ok;
}

const LEAF_OPS = CONDITION_OPS.filter((op): op is LeafConditionOp => !isCombinator(op));

describe("conditionForOp emits only DSL the kernel accepts (exit criterion 4)", () => {
  for (const type of QUESTION_TYPES) {
    for (const op of LEAF_OPS) {
      it(`${op} against a ${type} question with options`, () => {
        const condition = conditionForOp(op, QUESTION_ID, type, OPTIONS);
        expect(parses(condition), JSON.stringify(condition)).toBe(true);
      });

      it(`${op} against a ${type} question with no declared options`, () => {
        // The state a non-choice question is always in, and the state a choice question
        // is in for the instant before its first option exists.
        const condition = conditionForOp(op, QUESTION_ID, type, []);
        expect(parses(condition), JSON.stringify(condition)).toBe(true);
      });
    }
  }

  for (const op of LEAF_OPS) {
    it(`${op} against an unresolvable question falls back to a legal node`, () => {
      const condition = conditionForOp(op, QUESTION_ID, undefined, []);
      expect(condition.op).toBe("answered");
      expect(parses(condition)).toBe(true);
    });
  }

  for (const op of ["and", "or", "not"] as const) {
    it(`${op} builds a legal combinator`, () => {
      expect(parses(conditionForOp(op, QUESTION_ID, "boolean", []))).toBe(true);
    });
  }

  it("switching between every pair of operators leaves a legal node each time", () => {
    // The real hazard is not one operator, it is the sequence: a node rebuilt from a
    // previous one of a different shape. This walks every ordered pair.
    for (const type of QUESTION_TYPES) {
      let condition: DraftCondition = { op: "answered", questionId: QUESTION_ID };
      for (const first of CONDITION_OPS) {
        for (const second of CONDITION_OPS) {
          condition = conditionForOp(first, QUESTION_ID, type, OPTIONS, condition);
          expect(parses(condition), `${type}: ${first}`).toBe(true);
          condition = conditionForOp(second, QUESTION_ID, type, OPTIONS, condition);
          expect(parses(condition), `${type}: ${first} -> ${second}`).toBe(true);
        }
      }
    }
  });
});

describe("operator support is decided by the referenced question's type", () => {
  it("offers ordering only against number and date (DOMAIN_SCHEMA 2.4)", () => {
    for (const type of QUESTION_TYPES) {
      const ordered = type === "number" || type === "date";
      for (const op of ["gt", "gte", "lt", "lte"] as const) {
        expect(isOpSupported(op, type), `${op}/${type}`).toBe(ordered);
      }
    }
  });

  it("offers contains and containsAny only against multiChoice (ADR-21)", () => {
    for (const type of QUESTION_TYPES) {
      const multi = type === "multiChoice";
      expect(isOpSupported("contains", type)).toBe(multi);
      expect(isOpSupported("containsAny", type)).toBe(multi);
    }
  });

  it("compares a multiChoice equals as a whole answer, not a membership test", () => {
    // ADR-21: multiChoice equality is set equality over the whole answer.
    expect(operandKind("equals", "multiChoice")).toBe("optionList");
    const condition = conditionForOp("equals", QUESTION_ID, "multiChoice", OPTIONS);
    expect(condition).toMatchObject({ op: "equals", value: ["opt_yes"] });
  });

  it("offers answered against every type", () => {
    for (const type of QUESTION_TYPES) {
      expect(isOpSupported("answered", type)).toBe(true);
    }
  });

  it("does not offer `in` where a whole-answer list would be the operand", () => {
    // See the module note: multiChoice `in` is legal DSL and a list-of-lists control.
    expect(isOpSupported("in", "multiChoice")).toBe(false);
    expect(isOpSupported("in", "boolean")).toBe(false);
    expect(isOpSupported("in", "singleChoice")).toBe(true);
  });

  it("treats an unresolved question as supporting nothing", () => {
    for (const op of LEAF_OPS) {
      expect(isOpSupported(op, undefined as unknown as QuestionType)).toBe(false);
    }
  });
});

describe("tree editing", () => {
  const tree: DraftCondition = {
    op: "and",
    conditions: [
      { op: "answered", questionId: "q_one" },
      { op: "not", condition: { op: "answered", questionId: "q_two" } },
    ],
  };

  it("reads a node by its path", () => {
    expect(nodeAt(tree, [])).toBe(tree);
    expect(nodeAt(tree, [0])).toMatchObject({ questionId: "q_one" });
    expect(nodeAt(tree, [1, 0])).toMatchObject({ questionId: "q_two" });
    expect(nodeAt(tree, [9])).toBeUndefined();
  });

  it("replaces a nested node without touching its siblings", () => {
    const next = replaceAt(tree, [1, 0], { op: "answered", questionId: "q_three" });
    expect(nodeAt(next, [1, 0])).toMatchObject({ questionId: "q_three" });
    expect(nodeAt(next, [0])).toMatchObject({ questionId: "q_one" });
    expect(parses(next)).toBe(true);
  });

  it("collects every referenced question once, in first-encounter order", () => {
    expect(conditionReferences(tree)).toEqual(["q_one", "q_two"]);
  });

  it("refuses to nest past the kernel's depth cap", () => {
    let deep: DraftCondition = { op: "answered", questionId: "q_one" };
    for (let level = 1; level < MAX_CONDITION_DEPTH; level += 1) {
      deep = { op: "and", conditions: [deep] };
    }
    expect(conditionDepth(deep)).toBe(MAX_CONDITION_DEPTH);
    expect(parses(deep)).toBe(true);
    // At the cap, adding a branch is a no-op rather than an error to explain later.
    expect(addBranch(deep, [], "q_two")).toBe(deep);
  });

  it("adds a branch below the cap and keeps the tree legal", () => {
    const grown = addBranch(tree, [], "q_three");
    expect(nodeAt(grown, [2])).toMatchObject({ questionId: "q_three" });
    expect(parses(grown)).toBe(true);
  });

  it("never removes a combinator's last branch (the kernel requires one)", () => {
    const single: DraftCondition = {
      op: "or",
      conditions: [{ op: "answered", questionId: "q_one" }],
    };
    expect(removeBranch(single, [], 0)).toBe(single);
    expect(removeBranch(tree, [], 0)).toMatchObject({
      op: "and",
      conditions: [tree.conditions[1]],
    });
  });
});
