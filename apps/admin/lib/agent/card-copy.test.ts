import { describe, expect, it } from "vitest";

import type { AgentPlanStep } from "../forms/assist-stream.ts";

import {
  environmentLabel,
  planNames,
  planTitleSubject,
  stepArguments,
  stepConsequences,
  stepTitle,
  subjectIds,
} from "./card-copy.ts";

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

function publishQuestion(questionId: string): AgentPlanStep {
  return step({
    kind: "question.publish",
    screen: "/questions/[questionId]",
    args: { questionId, version: 1 },
    card: { titleKey: "agent.card.question.publish.title", consequenceKeys: [] },
  });
}

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

  it("names a question the screen looked up, and keeps its id for support", () => {
    const publish = publishQuestion("q_patient_full_name");
    const { steps, names } = plan([publish], new Map([["q_patient_full_name", "Full name"]]));
    expect(stepTitle(publish, {}, steps, names)).toBe(
      "Publish version 1 of the question Full name",
    );
    const line = stepArguments(publish, {}, names).find((entry) => entry.name === "questionId");
    expect(line?.value).toBe("Full name");
    expect(line?.id).toBe("q_patient_full_name");
  });

  it("tells unnamed steps apart by the tail of each id", () => {
    const steps = [
      publishQuestion("q_patient_full_name"),
      publishQuestion("q_patient_date_of_birth"),
    ];
    const { names } = plan(steps);
    const titles = steps.map((entry) => stepTitle(entry, {}, steps, names));
    expect(titles).toEqual([
      "Publish version 1 of the question \u2026ull_name",
      "Publish version 1 of the question \u2026of_birth",
    ]);
  });

  it("keeps the plain word when one step is the whole plan", () => {
    const one = publishQuestion("q_patient_full_name");
    const { steps, names } = plan([one]);
    expect(stepTitle(one, {}, steps, names)).toBe(
      "Publish version 1 of the question this question",
    );
  });

  it("lists the form and question ids a plan names outright", () => {
    expect(subjectIds([MINT, publishQuestion("q_patient_full_name"), SAVE_DRAFT])).toEqual([
      "frm_patient_onboarding",
      "q_patient_full_name",
    ]);
  });

  it("names a question by its label", () => {
    const { steps, names } = plan([CREATE_QUESTION]);
    expect(stepTitle(CREATE_QUESTION, {}, steps, names)).toBe(
      "Add the question Phone number to the library",
    );
  });

  it("gives the whole plan the subject of its last step, which is its outcome", () => {
    const { steps, names } = plan([CREATE_FORM, MINT, SAVE_DRAFT]);
    expect(planTitleSubject(steps, {}, names)).toBe("Save the draft of Patient onboarding");
  });

  it("keeps the id of a named argument for support, out of the line itself", () => {
    const { names } = plan([MINT], BUILDER_KNOWS);
    const line = stepArguments(MINT, {}, names).find((entry) => entry.name === "formId");
    expect(line?.value).toBe("Patient onboarding");
    expect(line?.id).toBe("frm_patient_onboarding");
  });

  it("keeps the title the screen knows when the plan writes another one for that id", () => {
    const save = step({
      kind: "form.saveDraft",
      args: {
        formId: "frm_patient_onboarding",
        definition: { title: { en: "Patient intake" }, steps: [] },
      },
      card: { titleKey: "agent.card.form.saveDraft.title", consequenceKeys: [] },
    });
    const { steps, names } = plan([save], BUILDER_KNOWS);
    expect(stepTitle(save, {}, steps, names)).toBe("Save the draft of Patient onboarding");
    const line = stepArguments(save, {}, names).find((entry) => entry.name === "formId");
    expect(line?.value).toBe("Patient onboarding, renamed to Patient intake");
    expect(line?.id).toBe("frm_patient_onboarding");
  });

  it("reports no rename when the plan repeats the title the screen knows", () => {
    const save = step({
      kind: "form.saveDraft",
      args: {
        formId: "frm_patient_onboarding",
        definition: { title: { en: "Patient onboarding" }, steps: [] },
      },
      card: { titleKey: "agent.card.form.saveDraft.title", consequenceKeys: [] },
    });
    const { names } = plan([save], BUILDER_KNOWS);
    const line = stepArguments(save, {}, names).find((entry) => entry.name === "formId");
    expect(line?.value).toBe("Patient onboarding");
  });

  it("names an existing form by its address rather than by the title the plan writes", () => {
    const save = step({
      kind: "form.saveDraft",
      args: {
        formId: "frm_patient_onboarding",
        slug: "patient-onboarding",
        definition: { title: { en: "Patient intake" }, steps: [] },
      },
      card: { titleKey: "agent.card.form.saveDraft.title", consequenceKeys: [] },
    });
    const { steps, names } = plan([save]);
    expect(stepTitle(save, {}, steps, names)).toBe("Save the draft of patient-onboarding");
    const line = stepArguments(save, {}, names).find((entry) => entry.name === "formId");
    expect(line?.value).toBe("frm_patient_onboarding");
  });

  it("says which language a form is authored in by its name", () => {
    const { names } = plan([CREATE_FORM]);
    const line = stepArguments(CREATE_FORM, {}, names).find(
      (entry) => entry.name === "defaultLocale",
    );
    expect(line?.value).toBe("English");
    expect(line?.id).toBeUndefined();
  });

  it("moves an id the plan cannot name out of the line and under Identifiers", () => {
    const { names } = plan([MINT]);
    const line = stepArguments(MINT, {}, names).find((entry) => entry.name === "formId");
    expect(line?.idOnly).toBe(true);
    expect(line?.id).toBe("frm_patient_onboarding");
  });
});

describe("a counted title agrees with its count", () => {
  it("reads as one link for one link, and names the form it is for", () => {
    const { steps, names } = plan([MINT], BUILDER_KNOWS);
    expect(stepTitle(MINT, {}, steps, names)).toBe("Create 1 test link for Patient onboarding");
  });

  it("reads as several links for several", () => {
    const many = step({ ...MINT, args: { ...MINT.args, count: 3 } });
    const { steps, names } = plan([many], BUILDER_KNOWS);
    expect(stepTitle(many, {}, steps, names)).toBe("Create 3 test links for Patient onboarding");
  });

  it("falls back to the generic subject where nothing names the form", () => {
    const { steps, names } = plan([MINT]);
    expect(stepTitle(MINT, {}, steps, names)).toBe("Create 1 test link for this form");
  });
});

describe("what a minted link is called", () => {
  function mint(count: number, environment: string): AgentPlanStep {
    return step({ ...MINT, args: { ...MINT.args, count }, environment });
  }

  it("is a test link in every environment that is not production", () => {
    for (const environment of ["dev", "test", "staging"]) {
      const one = mint(1, environment);
      const many = mint(4, environment);
      expect(stepTitle(one, {}, [one], plan([one]).names)).toBe("Create 1 test link for this form");
      expect(stepTitle(many, {}, [many], plan([many]).names)).toBe(
        "Create 4 test links for this form",
      );
    }
  });

  it("is a respondent link in production, in both plural forms", () => {
    const one = mint(1, "prod");
    const many = mint(4, "prod");
    expect(stepTitle(one, {}, [one], plan([one]).names)).toBe(
      "Create 1 respondent link for this form",
    );
    expect(stepTitle(many, {}, [many], plan([many]).names)).toBe(
      "Create 4 respondent links for this form",
    );
  });

  it("names no environment in the title, which the card carries on its own line", () => {
    for (const environment of ["staging", "prod"]) {
      const one = mint(1, environment);
      expect(stepTitle(one, {}, [one], plan([one]).names)).not.toContain(environment);
    }
  });
});

describe("the words a card uses for a thing the person reads", () => {
  it("names an access group by its name and keeps its id behind the disclosure", () => {
    const grant = step({
      kind: "access.grant",
      screen: "/workspaces/[workspaceId]/access-groups",
      args: { workspaceId: "wsp_clinic", teamId: "tem_authors", email: "sarah@larkmead.test" },
      card: { titleKey: "agent.card.access.grant.title", consequenceKeys: [] },
    });
    const known = new Map([["tem_authors", "Authors"]]);
    const { steps, names } = plan([grant], known);
    expect(stepTitle(grant, {}, steps, names)).toBe(
      "Put sarah@larkmead.test in the access group Authors",
    );
    const [line] = stepArguments(grant, {}, names).filter((entry) => entry.name === "teamId");
    expect(line?.value).toBe("Authors");
    expect(line?.id).toBe("tem_authors");
    expect(line?.idOnly).toBe(false);
  });

  it("falls back to the generic word rather than printing an id the screen cannot name", () => {
    const remove = step({
      kind: "access.groupRemove",
      screen: "/workspaces/[workspaceId]/access-groups",
      args: { workspaceId: "wsp_clinic", teamId: "tem_authors" },
      card: { titleKey: "agent.card.access.groupRemove.title", consequenceKeys: [] },
    });
    const { steps, names } = plan([remove]);
    expect(stepTitle(remove, {}, steps, names)).toBe("Remove the access group this access group");
  });

  it("keeps an identifier behind the disclosure rather than in the step's own body", () => {
    const [line] = stepArguments(CREATE_FORM).filter((entry) => entry.name === "slug");
    expect(line?.label).toBe("Identifier");
    expect(line?.idOnly).toBe(true);
    expect(line?.id).toBe("patient-onboarding");
  });

  it("names production as the glossary names it, and every other environment as the site does", () => {
    expect(environmentLabel("prod")).toBe("Production");
    expect(environmentLabel("test")).toBe("test");
    expect(environmentLabel("staging")).toBe("staging");
  });

  it("writes that name into a title and into a consequence alike", () => {
    const release = step({
      kind: "form.release",
      screen: "/operations/forms/[formId]/releases",
      args: { formId: "frm_patient_onboarding", version: 3 },
      environment: "prod",
      card: {
        titleKey: "agent.card.form.release.title",
        consequenceKeys: ["agent.card.form.release.consequence"],
      },
    });
    const { steps, names } = plan([release], BUILDER_KNOWS);
    expect(stepTitle(release, {}, steps, names)).toBe(
      "Publish version 3 of Patient onboarding to Production",
    );
    expect(stepConsequences(release).join(" ")).toContain("in Production");
  });
});
