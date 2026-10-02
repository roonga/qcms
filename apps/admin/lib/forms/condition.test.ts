import {
  CONDITION_MAX_DEPTH,
  parseVisibilityRule,
  REPEAT_EVALUATION_BUDGET as KERNEL_REPEAT_EVALUATION_BUDGET,
} from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { QUESTION_TYPES, type QuestionType } from "../questions/types.ts";

import {
  addBranch,
  conditionDepth,
  conditionForOp,
  conditionGroupReferences,
  conditionReferences,
  isCombinator,
  isGroupOp,
  isOpSupported,
  MAX_CONDITION_DEPTH,
  nodeAt,
  removeBranch,
  replaceAt,
  operandKind,
  REPEAT_EVALUATION_BUDGET,
  withGroupId,
  withInstanceCount,
} from "./condition.ts";
import {
  CONDITION_OPS,
  INSTANCE_COUNT_COMPARISONS,
  type DraftCondition,
  type LeafConditionOp,
} from "./types.ts";

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

/**
 * The twelve ops that read ONE QUESTION.
 *
 * `!isCombinator` alone stopped being the test in task 074: the three whole-group operators are a
 * third arity, reading a `groupId` rather than a `questionId` (ADR-42), so a list built that way
 * would hand `operandKind` an op it has no case for. Their own coverage is the group block below.
 */
const LEAF_OPS = CONDITION_OPS.filter(
  (op): op is LeafConditionOp => !isCombinator(op) && !isGroupOp(op),
);

/** The group a whole-group operator is built against in this file. */
const GROUP_ID = "grp_passengers";

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

/**
 * The three whole-group operators (task 074; ADR-42; ADR-03 as amended 2026-09-29).
 *
 * Exit criterion 4 applies to them exactly as it does to the twelve question operators: no picker
 * sequence may leave a node the kernel refuses. What is different is that they carry a `groupId`
 * instead of a `questionId`, so the construction has a second input and a second failure mode -
 * a form with no group to read - and both are covered here.
 */
describe("whole-group operators", () => {
  const GROUP_OPS = CONDITION_OPS.filter((op) => isGroupOp(op));

  it("is the arity the kernel's own union says it is", () => {
    expect([...GROUP_OPS]).toStrictEqual(["anyInstance", "everyInstance", "instanceCount"]);
  });

  for (const op of GROUP_OPS) {
    it(`${op} builds a legal node when there is a group to read`, () => {
      const condition = conditionForOp(op, QUESTION_ID, "boolean", OPTIONS, undefined, GROUP_ID);
      expect(condition.op).toBe(op);
      expect(parses(condition), JSON.stringify(condition)).toBe(true);
    });

    it(`${op} falls back to a legal node when the form declares no group`, () => {
      // `DANGLING_GROUP_REF` (Q24) refused at the CONTROL rather than explained at publish: a
      // form with no repeating group cannot be given one of these by any picker sequence.
      const condition = conditionForOp(op, QUESTION_ID, "boolean", OPTIONS);
      expect(condition.op).toBe("answered");
      expect(parses(condition)).toBe(true);
    });
  }

  it("switching between every pair of operators stays legal with a group in hand", () => {
    for (const type of QUESTION_TYPES) {
      let condition: DraftCondition = { op: "answered", questionId: QUESTION_ID };
      for (const first of CONDITION_OPS) {
        for (const second of CONDITION_OPS) {
          condition = conditionForOp(first, QUESTION_ID, type, OPTIONS, condition, GROUP_ID);
          expect(parses(condition), `${type}: ${first}`).toBe(true);
          condition = conditionForOp(second, QUESTION_ID, type, OPTIONS, condition, GROUP_ID);
          expect(parses(condition), `${type}: ${first} -> ${second}`).toBe(true);
        }
      }
    }
  });

  it("keeps the nested condition when the author changes which group is read", () => {
    const nested: DraftCondition = { op: "answered", questionId: "q_passport" };
    const moved = withGroupId({ op: "anyInstance", groupId: GROUP_ID, condition: nested }, "grp_bags");

    expect(moved).toStrictEqual({ op: "anyInstance", groupId: "grp_bags", condition: nested });
    expect(parses(moved)).toBe(true);
  });

  it("keeps the group when the author changes the comparison or the number", () => {
    const counted: DraftCondition = {
      op: "instanceCount",
      groupId: GROUP_ID,
      compare: "gte",
      value: 1,
    };
    for (const compare of INSTANCE_COUNT_COMPARISONS) {
      const next = withInstanceCount(counted, { compare });
      expect(next).toMatchObject({ groupId: GROUP_ID, compare });
      expect(parses(next)).toBe(true);
    }
    // `min(0)` in the kernel's schema, so a negative is a node that does not parse rather than a
    // comparison that never matches. Clamped, so no keystroke can produce one.
    expect(withInstanceCount(counted, { value: -4 })).toMatchObject({ value: 0 });
    expect(parses(withInstanceCount(counted, { value: -4 }))).toBe(true);
  });

  it("counts a nested condition toward the depth cap, as the kernel does", () => {
    // ADR-03 as amended: `anyInstance` and `everyInstance` recurse exactly as `not` does, and
    // `CONDITION_MAX_DEPTH` stays 8. `instanceCount` carries no condition and is a leaf.
    expect(
      conditionDepth({
        op: "anyInstance",
        groupId: GROUP_ID,
        condition: { op: "answered", questionId: QUESTION_ID },
      }),
    ).toBe(2);
    expect(
      conditionDepth({ op: "instanceCount", groupId: GROUP_ID, compare: "gte", value: 1 }),
    ).toBe(1);
  });

  it("reads a nested node by path and replaces it without losing the group", () => {
    const tree: DraftCondition = {
      op: "everyInstance",
      groupId: GROUP_ID,
      condition: { op: "answered", questionId: "q_passport" },
    };

    // Addressed as child 0, exactly as `not`'s nested condition is, which is what lets the editor
    // render the nested tree through the same recursion rather than a second one.
    expect(nodeAt(tree, [0])).toStrictEqual({ op: "answered", questionId: "q_passport" });
    const replaced = replaceAt(tree, [0], { op: "answered", questionId: "q_dob" });
    expect(replaced).toStrictEqual({
      op: "everyInstance",
      groupId: GROUP_ID,
      condition: { op: "answered", questionId: "q_dob" },
    });
    expect(parses(replaced)).toBe(true);
  });

  it("separates what a condition reads from which groups it reads WHOLE", () => {
    const tree: DraftCondition = {
      op: "and",
      conditions: [
        { op: "answered", questionId: "q_trip" },
        {
          op: "anyInstance",
          groupId: GROUP_ID,
          condition: { op: "answered", questionId: "q_passport" },
        },
        { op: "instanceCount", groupId: "grp_bags", compare: "gt", value: 0 },
      ],
    };

    // The two cut document order in different places - a question at its own position, a whole
    // group at its span's end - which is the distinction `eligibleTargets` is built on.
    expect(conditionReferences(tree)).toStrictEqual(["q_trip", "q_passport"]);
    expect(conditionGroupReferences(tree)).toStrictEqual([GROUP_ID, "grp_bags"]);
    // `instanceCount` reads no question at all, and a walker with a `default:` branch reading
    // `condition.questionId` would push `undefined` as though it were one.
    expect(
      conditionReferences({ op: "instanceCount", groupId: GROUP_ID, compare: "gt", value: 0 }),
    ).toStrictEqual([]);
  });
});

/**
 * The two kernel VALUES this module restates rather than imports (R2).
 *
 * The admin takes no value import from `@roonga/qcms-core`, so both numbers are written out in
 * `condition.ts` - and a restated constant is a constant that can drift. A `.test.ts` is outside
 * the import-surface scan, which is what makes pinning them here possible at all.
 */
describe("the kernel constants this app restates", () => {
  it("pins the condition depth cap", () => {
    expect(MAX_CONDITION_DEPTH).toBe(CONDITION_MAX_DEPTH);
  });

  it("pins the evaluator's cross-group cost budget", () => {
    // Quoted so the admin can SAY the number in the sentence that explains
    // `REPEAT_EVALUATION_BUDGET_EXCEEDED`. Nothing in the admin checks it: the refusal is the
    // kernel's, and it bounds one rule shape's cost rather than any group's size (Q14).
    expect(REPEAT_EVALUATION_BUDGET).toBe(KERNEL_REPEAT_EVALUATION_BUDGET);
  });
});
