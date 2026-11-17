import { describe, expect, it } from "vitest";

import { MAX_PLAN_TITLE, readPlanTitle } from "./plan-title.js";

describe("the plan's own title", () => {
  it("is absent when the model wrote none", () => {
    expect(readPlanTitle(undefined)).toEqual({ title: undefined });
    expect(readPlanTitle("   ")).toEqual({ title: undefined });
  });

  it("keeps a plain outcome line as written", () => {
    expect(readPlanTitle("Ask about allergies, then publish to test")).toEqual({
      title: "Ask about allergies, then publish to test",
    });
  });

  it("flattens the markdown a model writes anyway, and the lines it wraps on", () => {
    expect(readPlanTitle("**Ask about allergies**,\n  then publish to test")).toEqual({
      title: "Ask about allergies, then publish to test",
    });
  });

  it("refuses a title naming an id, because a card names its subject by title", () => {
    const outcome = readPlanTitle("Save the draft of frm_patient_onboarding");
    expect(outcome).toEqual({
      reason:
        "The plan's title names frm_patient_onboarding. A title names the subject by its " +
        "title, never by an id.",
    });
  });

  it("refuses a title using a word the person may never be written to in", () => {
    expect(readPlanTitle("Release the patient form to prod")).toMatchObject({
      reason: expect.stringContaining('"release"'),
    });
    expect(readPlanTitle("Mint a link for the patient form")).toMatchObject({
      reason: expect.stringContaining('"mint"'),
    });
  });

  it("leaves a word that merely contains a forbidden one alone", () => {
    expect(readPlanTitle("Ask how they were released from hospital")).toMatchObject({
      title: "Ask how they were released from hospital",
    });
  });

  it("refuses a title longer than a heading, and says the limit", () => {
    const outcome = readPlanTitle("Publish ".repeat(20));
    expect(outcome).toMatchObject({ reason: expect.stringContaining(String(MAX_PLAN_TITLE)) });
  });

  it("refuses anything that is not a line of text", () => {
    expect(readPlanTitle(42)).toMatchObject({ reason: expect.stringContaining("short line") });
  });
});
