import { describe, expect, it } from "vitest";

import {
  addRule,
  addStep,
  blankDraft,
  newRule,
  removeStep,
  updateRule,
  upsertRule,
} from "./draft.ts";
import type { DraftForm } from "./types.ts";

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

    const afterRemoval = removeStep(built, coverStepId);
    expect(afterRemoval.steps).toHaveLength(0);
    expect(afterRemoval.rules[0]?.show).toStrictEqual([coverStepId]);

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

    expect(minted).not.toContain(coverStepId);
    expect(new Set(minted)).toStrictEqual(new Set(["stp_cover_2"]));
    expect(draft.rules[0]?.show).toStrictEqual([coverStepId]);
  });

  it("reserves an id a rule targets even while the step is still live", () => {
    const { draft, coverStepId } = draftWithRuleTargetingCover();

    const next = addStep(draft, "Cover");
    expect(next.steps.map((step) => step.stepId)).toStrictEqual([coverStepId, "stp_cover_2"]);
  });
});

describe("newRule and upsertRule", () => {
  it("mints a rule without adding it, so a cancelled add leaves nothing behind", () => {
    const draft = addStep(blankDraft("frm_claims"), "Cover");
    const minted = newRule(draft, "q_cover_level");

    expect(minted.ruleId).toBe("rul_cover_level");
    expect(minted.show, "a new rule shows nothing until the author says what").toEqual([]);
    expect(draft.rules, "minting does not touch the draft").toEqual([]);
  });

  it("hands out the same id again when the previous one was never added", () => {
    const draft = addStep(blankDraft("frm_claims"), "Cover");

    expect(newRule(draft, "q_cover_level").ruleId).toBe(newRule(draft, "q_cover_level").ruleId);
  });

  it("mints around a rule the draft already has, so Save cannot collide", () => {
    const draft = addRule(addStep(blankDraft("frm_claims"), "Cover"), "q_cover_level");

    expect(newRule(draft, "q_cover_level").ruleId).toBe("rul_cover_level_2");
  });

  it("appends an unknown rule and replaces a known one, which is the one commit Save makes", () => {
    let draft = addStep(blankDraft("frm_claims"), "Cover");
    const minted = newRule(draft, "q_cover_level");

    draft = upsertRule(draft, { ...minted, show: ["q_notes"] });
    expect(draft.rules).toHaveLength(1);
    expect(draft.rules[0]?.show).toEqual(["q_notes"]);

    draft = upsertRule(draft, { ...minted, show: ["q_other"] });
    expect(draft.rules, "the same id is one rule, not two").toHaveLength(1);
    expect(draft.rules[0]?.show).toEqual(["q_other"]);
  });
});
