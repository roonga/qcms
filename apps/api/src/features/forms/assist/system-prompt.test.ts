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
 * Operators the kernel accepts that the prompt deliberately does not document.
 *
 * The three whole-group operators arrived with the repeating group (ADR-42, task
 * 071), and they name a `groupId` the assistant has no way to invent: a proposal
 * can pin a question the library search found, but a group id exists only once an
 * author has created the group, and the admin cannot create one until task 074.
 * A prompt that offered these would produce confidently wrong proposals naming
 * groups that do not exist, which is exactly the staleness this file exists to
 * prevent, pointing the other way.
 *
 * The exclusion is a named, deliberate edit rather than a hole: every operator
 * outside this set must still be documented, and every operator inside it must
 * still be one the kernel accepts, both asserted below.
 */
const NOT_DOCUMENTED: ReadonlySet<Condition["op"]> = new Set([
  "anyInstance",
  "everyInstance",
  "instanceCount",
]);

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
    expect(
      Object.keys(OPERATOR_SAMPLES)
        .filter((op) => !NOT_DOCUMENTED.has(op as Condition["op"]))
        .sort(),
    ).toEqual([...CONDITION_OPERATORS].sort());
  });

  it("the operators it deliberately omits are ones the kernel still accepts", () => {
    for (const op of NOT_DOCUMENTED) {
      expect(CONDITION_OPERATORS as readonly string[]).not.toContain(op);
      expect(parseCondition(OPERATOR_SAMPLES[op]).ok, `kernel rejected ${op}`).toBe(true);
    }
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
