/**
 * The system prompt is reviewed like code, so it is tested like code (041).
 *
 * The point of these is staleness: a prompt that describes a DSL the kernel no
 * longer speaks is worse than no prompt, because it produces confidently wrong
 * proposals. Each assertion ties a claim in the prompt back to the kernel.
 */

import { describe, expect, it } from "vitest";

import { type Condition, parseCondition, QUESTION_TYPES } from "@roonga/qcms-core";

import { buildSystemPrompt, CONDITION_OPERATORS, SYSTEM_PROMPT_VERSION } from "./system-prompt.js";

/**
 * One minimal, valid sample per documented operator.
 *
 * Typed as `Record<Condition["op"], unknown>` rather than `Record<string, unknown>`,
 * which is what makes the staleness claim below true in both directions (PO review,
 * 2026-08-13). Parsing one sample each catches an operator the kernel REMOVED; it
 * cannot catch one the kernel GAINED, because nothing here enumerates the kernel's
 * own set - `Condition` is a `z.lazy` discriminated union with no runtime name list.
 * The type annotation enumerates it at compile time instead: adding a verb to
 * `packages/core/src/visibility-rule.ts` makes this object fail `tsc` for the missing
 * key, before any test runs. Verified red rather than assumed: deleting the
 * `containsAny` sample fails the API typecheck naming that exact property.
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

/**
 * THERE IS NO EXCLUSION SET ANY MORE, and its removal is task 074's.
 *
 * Task 071 carried a named `NOT_DOCUMENTED` set holding the three whole-group
 * operators, for a reason that was true at the time: they name a `groupId` the
 * assistant had no way to invent, because a group id exists only once an author
 * has created the group and the admin could not create one. Task 074 is where an
 * author can, so the operators joined `CONDITION_OPERATORS`, the set went away,
 * and `SYSTEM_PROMPT_VERSION` moved with the text.
 *
 * The assertion below is therefore the plain one again: every operator the kernel
 * accepts is documented, and nothing it rejects is. A set reintroduced here would
 * have to say which operator the prompt is deliberately silent about and why.
 */
describe("the draft assistant system prompt", () => {
  it("names every operator the kernel accepts, and no operator it rejects", () => {
    for (const op of CONDITION_OPERATORS) {
      const sample = OPERATOR_SAMPLES[op];
      expect(sample, `no sample for documented operator ${op}`).toBeDefined();
      expect(parseCondition(sample).ok, `kernel rejected documented operator ${op}`).toBe(true);
    }
    // The negative half: an operator the prompt does not name is one the kernel
    // does not have, so the list cannot silently fall behind without this failing.
    expect(parseCondition({ op: "matches", questionId: "q_a", value: "x" }).ok).toBe(false);
    expect(Object.keys(OPERATOR_SAMPLES).sort()).toEqual([...CONDITION_OPERATORS].sort());
  });

  it("documents the repeating group's refusals, not only its operators", () => {
    const prompt = buildSystemPrompt();
    // Q25, ruled 2026-09-29: a model that nests two whole-group reads writes a
    // draft publish refuses (`REPEAT_OPERATOR_NESTING_NOT_ALLOWED`), so the
    // prompt has to say so rather than leaving the proposal to be rejected.
    expect(prompt).toContain("THESE THREE CANNOT NEST");
    // Q7: the empty-group reading, which is the one semantic a model would
    // otherwise supply classically and get exactly backwards.
    expect(prompt).toContain("everyInstance over a group with NO instances is FALSE");
    // Q4 as amended by Q14: `max` required on both bounded sources, because
    // nothing above the group bounds a respondent's instance count.
    expect(prompt).toContain("must BOTH declare a max");
    // ADR-42's load-bearing property: repetition is not a question type.
    expect(prompt).toContain("A question does not know it is repeated");
    // ADR-42 §3.4: one rule, one scope, with the remedy named.
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
    expect(prompt).toContain("no access to respondent data");
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

  it("is deterministic, so an upstream cache of it is worth having", () => {
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
    expect(SYSTEM_PROMPT_VERSION).toBeGreaterThan(0);
  });
});
