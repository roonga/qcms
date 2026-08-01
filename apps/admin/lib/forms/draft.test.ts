import { describe, expect, it } from "vitest";

import { addRule, addStep, blankDraft, removeStep, updateRule } from "./draft.ts";
import type { DraftForm } from "./types.ts";

/**
 * Step-id minting is permanence, not uniqueness (PR #245 review).
 *
 * `removeStep` leaves a rule's `show: ["stp_gone"]` dangling on purpose so the author is
 * told (`DANGLING_STEP_REF`) rather than having their rule rewritten under them. The whole
 * value of that choice depends on the retired id never being handed out again: if it is,
 * the orphaned rule silently re-attaches to an unrelated step and the issue the author was
 * meant to answer vanishes with no signal. These tests pin that.
 */

/** A draft with one step and one rule pointing at it, built the way the builder builds. */
function draftWithRuleTargetingCover(): { draft: DraftForm; coverStepId: string } {
  let draft = addStep(blankDraft("frm_claims"), "Cover");
  const coverStepId = draft.steps[0]?.stepId ?? "";
  draft = addRule(draft, "q_cover_level");
  const rule = draft.rules[0];
  if (rule === undefined) throw new Error("addRule did not append a rule");
  draft = updateRule(draft, rule.ruleId, { ...rule, show: [coverStepId] });
  return { draft, coverStepId };
}

describe("addStep id minting", () => {
  it("mints a readable id from the title", () => {
    const draft = addStep(blankDraft("frm_claims"), "Driving history");
    expect(draft.steps[0]?.stepId).toBe("stp_driving_history");
  });

  it("suffixes when a live step already holds the id", () => {
    const draft = addStep(addStep(blankDraft("frm_claims"), "Cover"), "Cover");
    expect(draft.steps.map((step) => step.stepId)).toStrictEqual(["stp_cover", "stp_cover_2"]);
  });

  it("does not re-mint an id a dangling rule still targets", () => {
    const { draft: built, coverStepId } = draftWithRuleTargetingCover();
    expect(coverStepId).toBe("stp_cover");

    // Delete the step. The rule keeps pointing at the dead id, by design.
    const afterRemoval = removeStep(built, coverStepId);
    expect(afterRemoval.steps).toHaveLength(0);
    expect(afterRemoval.rules[0]?.show).toStrictEqual([coverStepId]);

    // Re-add a step with the same title. It must NOT inherit the orphaned rule.
    const reAdded = addStep(afterRemoval, "Cover");
    expect(reAdded.steps[0]?.stepId).not.toBe(coverStepId);
    expect(reAdded.steps[0]?.stepId).toBe("stp_cover_2");
    expect(reAdded.rules[0]?.show).toStrictEqual([coverStepId]);
    expect(reAdded.rules[0]?.show).not.toContain(reAdded.steps[0]?.stepId);
  });

  it("keeps reserving the id across repeated add/remove cycles", () => {
    const { draft: built, coverStepId } = draftWithRuleTargetingCover();
    let draft = removeStep(built, coverStepId);
    const minted: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      draft = addStep(draft, "Cover");
      const added = draft.steps.at(-1)?.stepId ?? "";
      minted.push(added);
      draft = removeStep(draft, added);
    }
    // Live steps free up again, so the second and third reuse `stp_cover_2`; what never
    // comes back is the id the dangling rule is holding.
    expect(minted).not.toContain(coverStepId);
    expect(new Set(minted)).toStrictEqual(new Set(["stp_cover_2"]));
    expect(draft.rules[0]?.show).toStrictEqual([coverStepId]);
  });

  it("reserves an id a rule targets even while the step is still live", () => {
    const { draft, coverStepId } = draftWithRuleTargetingCover();
    // Belt and braces: the live-steps list already covers this, but the reservation must
    // not depend on which of the two lists happens to hold the name.
    const next = addStep(draft, "Cover");
    expect(next.steps.map((step) => step.stepId)).toStrictEqual([coverStepId, "stp_cover_2"]);
  });
});
