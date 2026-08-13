import { describe, expect, it } from "vitest";

import { acceptedDraft, proposalDiff } from "./assist-diff.ts";
import type { DraftForm } from "./types.ts";

const BASE: DraftForm = {
  formId: "frm_quote",
  defaultLocale: "en",
  title: { en: "Vehicle insurance quote" },
  steps: [
    {
      stepId: "stp_basics",
      title: { en: "Basics" },
      items: [{ questionId: "q_name", version: 1 }],
    },
  ],
  rules: [
    {
      ruleId: "rul_existing",
      when: { op: "answered", questionId: "q_name" },
      show: ["stp_basics"],
    },
  ],
};

describe("proposalDiff", () => {
  it("reports nothing when the proposal is identical to the current draft", () => {
    expect(proposalDiff(BASE, BASE, [])).toEqual([]);
  });

  it("names a new step as added", () => {
    const proposed = {
      ...BASE,
      steps: [
        ...BASE.steps,
        { stepId: "stp_history", title: { en: "Driving history" }, items: [] },
      ],
    };
    const diff = proposalDiff(BASE, proposed, []);
    expect(diff).toContainEqual(
      expect.objectContaining({ kind: "step", change: "added", id: "stp_history" }),
    );
  });

  it("names an existing step whose content differs as changed", () => {
    const proposed = {
      ...BASE,
      steps: [{ ...BASE.steps[0]!, title: { en: "Basics (renamed)" } }],
    };
    const diff = proposalDiff(BASE, proposed, []);
    expect(diff).toEqual([
      expect.objectContaining({ kind: "step", change: "changed", id: "stp_basics" }),
    ]);
  });

  it("names a newly pinned question as added, labelled with its type", () => {
    const proposed = {
      ...BASE,
      steps: [
        {
          stepId: "stp_history",
          title: { en: "Driving history" },
          items: [{ questionId: "q_at_fault", version: 1 }],
        },
      ],
    };
    const newQuestions = [{ questionId: "q_at_fault", type: "boolean" }];
    const diff = proposalDiff(BASE, proposed, newQuestions);
    expect(diff).toContainEqual(
      expect.objectContaining({
        kind: "question",
        change: "added",
        id: "q_at_fault",
        label: "q_at_fault (boolean)",
      }),
    );
  });

  it("names a new rule as added", () => {
    const proposed = {
      ...BASE,
      rules: [
        ...BASE.rules,
        {
          ruleId: "rul_accident",
          when: { op: "answered", questionId: "q_at_fault" },
          show: ["stp_history"],
        },
      ],
    };
    const diff = proposalDiff(BASE, proposed, []);
    expect(diff).toContainEqual(
      expect.objectContaining({ kind: "rule", change: "added", id: "rul_accident" }),
    );
  });

  it("reads a proposal from unparsed wire JSON the same way it reads a DraftForm", () => {
    const wire: unknown = {
      formId: "frm_quote",
      defaultLocale: "en",
      title: { en: "Vehicle insurance quote" },
      steps: [
        {
          stepId: "stp_basics",
          title: { en: "Basics" },
          items: [{ questionId: "q_name", version: 1 }],
        },
        { stepId: "stp_history", title: { en: "Driving history" }, items: [] },
      ],
      rules: BASE.rules,
    };
    const diff = proposalDiff(BASE, wire, []);
    expect(diff).toEqual([
      expect.objectContaining({ kind: "step", change: "added", id: "stp_history" }),
    ]);
  });

  it("drops a proposed step or rule with no id rather than crashing", () => {
    const wire: unknown = {
      steps: [{ title: { en: "No id" }, items: [] }],
      rules: [{ when: { op: "answered", questionId: "q_name" }, show: [] }],
    };
    expect(proposalDiff(BASE, wire, [])).toEqual([]);
  });
});

describe("acceptedDraft", () => {
  it("carries the proposal's steps and rules, addressed at the current form", () => {
    const wire: unknown = {
      steps: [{ stepId: "stp_only", title: { en: "Only step" }, items: [] }],
      rules: [],
    };
    const result = acceptedDraft(BASE, wire);
    expect(result.formId).toBe(BASE.formId);
    expect(result.defaultLocale).toBe(BASE.defaultLocale);
    expect(result.steps).toEqual([{ stepId: "stp_only", title: { en: "Only step" }, items: [] }]);
    expect(result.rules).toEqual([]);
  });

  it("keeps the current title when the proposal carries none", () => {
    const result = acceptedDraft(BASE, { steps: [], rules: [] });
    expect(result.title).toEqual(BASE.title);
  });
});
