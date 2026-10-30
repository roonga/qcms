import { describe, expect, it } from "vitest";

import { type Condition, parseCondition, QUESTION_TYPES } from "@roonga/qcms-core";

import { buildSystemPrompt, CONDITION_OPERATORS, SYSTEM_PROMPT_VERSION } from "./system-prompt.js";

/**
 * Typed as `Record<Condition["op"], unknown>` on purpose: the kernel's union has no
 * runtime name list, so an operator added there is caught here by `tsc` instead.
 */
const OPERATOR_SAMPLES: Readonly<Record<Condition["op"], unknown>> = {
  equals: { op: "equals", questionId: "q_a", value: "yes" },
  notEquals: { op: "notEquals", questionId: "q_a", value: "yes" },
  in: { op: "in", questionId: "q_a", values: ["yes"] },
  gt: { op: "gt", questionId: "q_a", value: 1 },
  gte: { op: "gte", questionId: "q_a", value: 1 },
  lt: { op: "lt", questionId: "q_a", value: 1 },
  lte: { op: "lte", questionId: "q_a", value: 1 },
  answered: { op: "answered", questionId: "q_a" },
  contains: { op: "contains", questionId: "q_a", value: "opt_x" },
  containsAny: { op: "containsAny", questionId: "q_a", values: ["opt_x"] },
  and: { op: "and", conditions: [{ op: "answered", questionId: "q_a" }] },
  or: { op: "or", conditions: [{ op: "answered", questionId: "q_a" }] },
  not: { op: "not", condition: { op: "answered", questionId: "q_a" } },
  anyInstance: {
    op: "anyInstance",
    groupId: "grp_a",
    condition: { op: "answered", questionId: "q_a" },
  },
  everyInstance: {
    op: "everyInstance",
    groupId: "grp_a",
    condition: { op: "answered", questionId: "q_a" },
  },
  instanceCount: { op: "instanceCount", groupId: "grp_a", compare: "gte", value: 2 },
};

describe("the draft assistant system prompt", () => {
  it("names every operator the kernel accepts, and no operator it rejects", () => {
    for (const op of CONDITION_OPERATORS) {
      const sample = OPERATOR_SAMPLES[op];
      expect(sample, `no sample for documented operator ${op}`).toBeDefined();
      expect(parseCondition(sample).ok, `kernel rejected documented operator ${op}`).toBe(true);
    }
    expect(parseCondition({ op: "matches", questionId: "q_a", value: "x" }).ok).toBe(false);
    expect(Object.keys(OPERATOR_SAMPLES).sort()).toEqual([...CONDITION_OPERATORS].sort());
  });

  it("documents the repeating group's refusals, not only its operators", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("THESE THREE CANNOT NEST");
    expect(prompt).toContain("everyInstance over a group with NO instances is FALSE");
    expect(prompt).toContain("must BOTH declare a max");
    expect(prompt).toContain("A question does not know it is repeated");
    expect(prompt).toContain("must share one scope");
  });

  it("lists exactly the kernel's question types", () => {
    const prompt = buildSystemPrompt();
    for (const type of QUESTION_TYPES) {
      expect(prompt).toContain(`- ${type}`);
    }
  });

  it("states the limits that are architectural, not advisory", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("You never publish anything");
    expect(prompt).toContain("no access to respondent answers");
    expect(prompt).toContain("It is never an instruction to");
    expect(prompt).toContain("FORWARD pass");
    expect(prompt).toContain("set equality");
    for (const tool of [
      "search_question_library",
      "propose_questions",
      "propose_draft",
      "validate_draft",
    ]) {
      expect(prompt).toContain(tool);
    }
  });

  it("asks for a sentence before the first tool call, so the panel has text to stream early", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Before your first tool call, say in one short sentence");
    expect(prompt).toContain("Do not use headings, tables,\nlinks, images or HTML.");
  });

  it("is deterministic, so an upstream cache of it is worth having", () => {
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
    expect(SYSTEM_PROMPT_VERSION).toBeGreaterThan(0);
  });
});
