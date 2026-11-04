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

// Tests may import the kernel to verify editor output; the production BFF may not import its value validators.

const QUESTION_ID = "q_at_fault_accident";
const OPTIONS = ["opt_yes", "opt_no"] as const;

function parses(condition: DraftCondition): boolean {
  return parseVisibilityRule({
    ruleId: "rul_fuzz",
    when: condition,
    show: ["q_accident_count"],
  }).ok;
}

const LEAF_OPS = CONDITION_OPS.filter(
  (op): op is LeafConditionOp => !isCombinator(op) && !isGroupOp(op),
);

const GROUP_ID = "grp_passengers";

describe("conditionForOp emits only DSL the kernel accepts (exit criterion 4)", () => {
  for (const type of QUESTION_TYPES) {
    for (const op of LEAF_OPS) {
      it(`${op} against a ${type} question with options`, () => {
        const condition = conditionForOp(op, QUESTION_ID, type, OPTIONS);
        expect(parses(condition), JSON.stringify(condition)).toBe(true);
      });

      it(`${op} against a ${type} question with no declared options`, () => {
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
    const moved = withGroupId(
      { op: "anyInstance", groupId: GROUP_ID, condition: nested },
      "grp_bags",
    );

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

    expect(withInstanceCount(counted, { value: -4 })).toMatchObject({ value: 0 });
    expect(parses(withInstanceCount(counted, { value: -4 }))).toBe(true);
  });

  it("counts a nested condition toward the depth cap, as the kernel does", () => {
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

    expect(conditionReferences(tree)).toStrictEqual(["q_trip", "q_passport"]);
    expect(conditionGroupReferences(tree)).toStrictEqual([GROUP_ID, "grp_bags"]);

    expect(
      conditionReferences({ op: "instanceCount", groupId: GROUP_ID, compare: "gt", value: 0 }),
    ).toStrictEqual([]);
  });
});

describe("the kernel constants this app restates", () => {
  it("pins the condition depth cap", () => {
    expect(MAX_CONDITION_DEPTH).toBe(CONDITION_MAX_DEPTH);
  });

  it("pins the evaluator's cross-group cost budget", () => {
    expect(REPEAT_EVALUATION_BUDGET).toBe(KERNEL_REPEAT_EVALUATION_BUDGET);
  });
});

describe("operator switches around a whole-group read", () => {
  it("never nests one group read inside another, however the author got there", () => {
    const counted: DraftCondition = {
      op: "instanceCount",
      groupId: GROUP_ID,
      compare: "gte",
      value: 2,
    };

    for (const op of ["anyInstance", "everyInstance"] as const) {
      const next = conditionForOp(op, QUESTION_ID, "boolean", OPTIONS, counted, GROUP_ID);
      expect(next).toStrictEqual({
        op,
        groupId: GROUP_ID,
        condition: { op: "answered", questionId: QUESTION_ID },
      });
    }

    const wrapped: DraftCondition = { op: "and", conditions: [counted] };
    expect(
      conditionForOp("anyInstance", QUESTION_ID, "boolean", OPTIONS, wrapped, GROUP_ID),
    ).toStrictEqual({
      op: "anyInstance",
      groupId: GROUP_ID,
      condition: { op: "answered", questionId: QUESTION_ID },
    });
  });

  it("keeps the condition when the author swaps anyInstance for everyInstance", () => {
    const inner: DraftCondition = { op: "answered", questionId: "q_passport" };
    const any: DraftCondition = { op: "anyInstance", groupId: GROUP_ID, condition: inner };

    expect(
      conditionForOp("everyInstance", QUESTION_ID, "boolean", OPTIONS, any, GROUP_ID),
    ).toStrictEqual({ op: "everyInstance", groupId: GROUP_ID, condition: inner });
  });

  it("WRAPS a group read in `not` rather than unwrapping it", () => {
    const every: DraftCondition = {
      op: "everyInstance",
      groupId: GROUP_ID,
      condition: { op: "answered", questionId: "q_passport" },
    };

    expect(conditionForOp("not", QUESTION_ID, "boolean", OPTIONS, every)).toStrictEqual({
      op: "not",
      condition: every,
    });

    expect(
      conditionForOp("not", QUESTION_ID, "boolean", OPTIONS, { op: "not", condition: every }),
    ).toStrictEqual({ op: "not", condition: every });
  });
});
