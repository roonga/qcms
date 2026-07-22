import { describe, expect, it } from "vitest";

import { diffFlow, nextFocusTargetAfterRemoval, type FlowView } from "./a11y";

const base: FlowView = {
  stepId: "stp_1",
  stepIndex: 0,
  visibleQuestions: ["q_a", "q_b"],
};

describe("diffFlow", () => {
  it("reports no delta on the first render (no previous view)", () => {
    expect(diffFlow(undefined, base)).toEqual({ stepChanged: false, added: [], removed: [] });
  });

  it("detects a branch insertion (question added) in the new order", () => {
    const next: FlowView = { ...base, visibleQuestions: ["q_a", "q_b", "q_c"] };
    expect(diffFlow(base, next)).toEqual({ stepChanged: false, added: ["q_c"], removed: [] });
  });

  it("detects a branch removal (question removed) in the old order", () => {
    const next: FlowView = { ...base, visibleQuestions: ["q_a"] };
    expect(diffFlow(base, next)).toEqual({ stepChanged: false, added: [], removed: ["q_b"] });
  });

  it("detects a step change between two real steps (both ids non-null and different)", () => {
    const next: FlowView = { stepId: "stp_2", stepIndex: 1, visibleQuestions: ["q_x"] };
    expect(diffFlow(base, next).stepChanged).toBe(true);
  });

  it("does NOT treat a step index change alone (same step) as a step change", () => {
    const next: FlowView = { ...base, stepIndex: 1 };
    expect(diffFlow(base, next).stepChanged).toBe(false);
  });

  it("does NOT treat the step going to null (flow ready/complete) as a step change", () => {
    const next: FlowView = { stepId: null, stepIndex: 1, visibleQuestions: ["q_a"] };
    const delta = diffFlow(base, next);
    expect(delta.stepChanged).toBe(false);
    // The branch removal is still reported so it can be announced instead.
    expect(delta.removed).toEqual(["q_b"]);
  });

  it("reports no change when the visible set and step are identical", () => {
    expect(diffFlow(base, { ...base })).toEqual({
      stepChanged: false,
      added: [],
      removed: [],
    });
  });
});

describe("nextFocusTargetAfterRemoval", () => {
  it("returns the next still-visible question after the removed one", () => {
    const order = ["q_a", "q_b", "q_c"];
    expect(nextFocusTargetAfterRemoval(order, "q_b", new Set(["q_a", "q_c"]))).toBe("q_c");
  });

  it("skips a following question that is also gone", () => {
    const order = ["q_a", "q_b", "q_c", "q_d"];
    expect(nextFocusTargetAfterRemoval(order, "q_b", new Set(["q_a", "q_d"]))).toBe("q_d");
  });

  it("returns undefined when the removed question was last (fall back to heading)", () => {
    const order = ["q_a", "q_b"];
    expect(nextFocusTargetAfterRemoval(order, "q_b", new Set(["q_a"]))).toBeUndefined();
  });

  it("returns undefined when the id was not in the previous order", () => {
    expect(nextFocusTargetAfterRemoval(["q_a"], "q_z", new Set(["q_a"]))).toBeUndefined();
  });
});
