import { describe, expect, it } from "vitest";

import { MAX_PLAN_TITLE, readPlanTitle, type PlanTitleOutcome } from "./plan-title.js";

function refusal(outcome: PlanTitleOutcome): string {
  if (!("reason" in outcome)) throw new Error("expected the title to be refused");
  return outcome.reason;
}

function accepted(outcome: PlanTitleOutcome): string | undefined {
  if ("reason" in outcome) throw new Error(outcome.reason);
  return outcome.title;
}

describe("the plan's own title", () => {
  it("is absent when the model wrote none", () => {
    expect(accepted(readPlanTitle(undefined))).toBeUndefined();
    expect(accepted(readPlanTitle("   "))).toBeUndefined();
  });

  it("keeps a plain outcome line as written", () => {
    expect(accepted(readPlanTitle("Ask about allergies, then publish to test"))).toBe(
      "Ask about allergies, then publish to test",
    );
  });

  it("flattens the markdown a model writes anyway, and the lines it wraps on", () => {
    expect(accepted(readPlanTitle("**Ask about allergies**,\n  then publish to test"))).toBe(
      "Ask about allergies, then publish to test",
    );
  });

  it("refuses a title naming an id, because a card names its subject by title", () => {
    expect(refusal(readPlanTitle("Save the draft of frm_patient_onboarding"))).toBe(
      "The plan's title names frm_patient_onboarding. A title names the subject by its " +
        "title, never by an id.",
    );
  });

  it("refuses a title using a word the person may never be written to in", () => {
    expect(refusal(readPlanTitle("Release the patient form to prod"))).toContain('"release"');
    expect(refusal(readPlanTitle("Mint a link for the patient form"))).toContain('"mint"');
  });

  it("leaves a word that merely contains a forbidden one alone", () => {
    expect(accepted(readPlanTitle("Ask how they were released from hospital"))).toBe(
      "Ask how they were released from hospital",
    );
  });

  it("refuses a title longer than a heading, and says the limit", () => {
    expect(refusal(readPlanTitle("Publish ".repeat(20)))).toContain(String(MAX_PLAN_TITLE));
  });

  it("refuses anything that is not a line of text", () => {
    expect(refusal(readPlanTitle(42))).toContain("short line");
  });
});
