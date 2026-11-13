import { describe, expect, it } from "vitest";

import type { AgentPlanStep } from "../forms/assist-stream.ts";

import { planNames, stepArguments, stepTitle } from "./card-copy.ts";

function step(overrides: Partial<AgentPlanStep> = {}): AgentPlanStep {
  return {
    kind: "form.create",
    screen: "/forms",
    args: {},
    environment: "test",
    handOff: false,
    local: false,
    card: { titleKey: "agent.card.form.create.title", consequenceKeys: [] },
    resultAllowlist: [],
    ...overrides,
  };
}

const CREATE_FORM = step({ args: { slug: "patient-onboarding", defaultLocale: "en" } });

const SAVE_DRAFT = step({
  kind: "form.saveDraft",
  screen: "/forms/[formId]",
  args: {
    formId: { fromStep: 0, field: "formId" },
    definition: { title: { en: "Patient onboarding" }, steps: [] },
  },
  card: { titleKey: "agent.card.form.saveDraft.title", consequenceKeys: [] },
});

const MINT = step({
  kind: "link.mint",
  screen: "/operations/forms/[formId]/links",
  args: { formId: "frm_patient_onboarding", count: 1 },
  card: { titleKey: "agent.card.link.mint.title", consequenceKeys: [] },
});

const CREATE_QUESTION = step({
  kind: "question.create",
  screen: "/questions",
  args: { slug: "patient-phone", definition: { label: { en: "Phone number" } } },
  card: { titleKey: "agent.card.question.create.title", consequenceKeys: [] },
});

function plan(steps: readonly AgentPlanStep[], known?: ReadonlyMap<string, string>) {
  return { steps, names: planNames({ steps }, known) };
}

const BUILDER_KNOWS = new Map([["frm_patient_onboarding", "Patient onboarding"]]);

describe("a card names what it acts on", () => {
  it("titles the step that creates a form with the title a later step gives the draft", () => {
    const { steps, names } = plan([CREATE_FORM, SAVE_DRAFT]);
    expect(stepTitle(CREATE_FORM, {}, steps, names)).toBe("Create the Patient onboarding form");
    expect(stepTitle(SAVE_DRAFT, {}, steps, names)).toBe("Save the draft of Patient onboarding");
  });

  it("falls back to the address when the plan carries no title for the form", () => {
    const { steps, names } = plan([CREATE_FORM]);
    expect(stepTitle(CREATE_FORM, {}, steps, names)).toBe("Create the patient-onboarding form");
  });

  it("says this form when neither a title nor an address is in the plan", () => {
    const close = step({
      kind: "form.close",
      args: { formId: "frm_patient_onboarding" },
      card: { titleKey: "agent.card.form.close.title", consequenceKeys: [] },
    });
    const { steps, names } = plan([close]);
    expect(stepTitle(close, {}, steps, names)).toBe("Close this form to new responses in test");
  });

  it("names a question by its label", () => {
    const { steps, names } = plan([CREATE_QUESTION]);
    expect(stepTitle(CREATE_QUESTION, {}, steps, names)).toBe(
      "Add the question Phone number to the library",
    );
  });

  it("keeps the id of a named argument for support, out of the line itself", () => {
    const { names } = plan([MINT], BUILDER_KNOWS);
    const line = stepArguments(MINT, {}, names).find((entry) => entry.name === "formId");
    expect(line?.value).toBe("Patient onboarding");
    expect(line?.id).toBe("frm_patient_onboarding");
  });

  it("leaves an id the plan cannot name in the line itself", () => {
    const { names } = plan([MINT]);
    const line = stepArguments(MINT, {}, names).find((entry) => entry.name === "formId");
    expect(line?.value).toBe("frm_patient_onboarding");
    expect(line?.id).toBeUndefined();
  });
});
