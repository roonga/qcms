import { describe, expect, it } from "vitest";

import {
  acceptedDraft,
  isPendingNewQuestionPin,
  pendingNewQuestionPins,
  proposalDiff,
} from "./assist-diff.ts";
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

  it("reports nothing for an echoed rule whose keys arrive in a different order", () => {
    const current: DraftForm = {
      ...BASE,
      rules: [
        {
          ruleId: "rul_followup",
          when: { op: "equals", value: true, questionId: "q_at_fault" },
          show: ["q_count"],
        },
      ],
    };
    const proposed: unknown = {
      steps: BASE.steps,
      rules: [
        {
          ruleId: "rul_followup",
          when: { questionId: "q_at_fault", op: "equals", value: true },
          show: ["q_count"],
        },
      ],
    };
    expect(proposalDiff(current, proposed, [])).toEqual([]);
  });

  it("still reports a rule whose array order differs, because order is content", () => {
    const current: DraftForm = {
      ...BASE,
      rules: [{ ruleId: "rul_existing", when: BASE.rules[0]!.when, show: ["stp_a", "stp_b"] }],
    };
    const proposed = {
      ...current,
      rules: [{ ruleId: "rul_existing", when: BASE.rules[0]!.when, show: ["stp_b", "stp_a"] }],
    };
    expect(proposalDiff(current, proposed, [])).toEqual([
      expect.objectContaining({ kind: "rule", change: "changed", id: "rul_existing" }),
    ]);
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

describe("isPendingNewQuestionPin (issue #1065)", () => {
  const proposed = {
    steps: [
      {
        stepId: "stp_new",
        title: { en: "New" },
        items: [{ questionId: "q_new", version: 1 }],
      },
    ],
    rules: [],
  };
  const invented = [{ questionId: "q_new", type: "shortText" }];
  const pending = pendingNewQuestionPins(proposed, invented);
  const dangling = (path: Record<string, string>) => ({
    code: "DANGLING_QUESTION_REF",
    message: "x",
    path,
  });

  it("matches the step pin Accept will make resolve", () => {
    expect(isPendingNewQuestionPin(dangling({ step: "stp_new", question: "q_new" }), pending)).toBe(
      true,
    );
  });

  it("does not match a rule reading an invented question, which stays dangling", () => {
    expect(isPendingNewQuestionPin(dangling({ rule: "rul_x", question: "q_new" }), pending)).toBe(
      false,
    );
  });

  it("does not match a step that does not pin the invented question", () => {
    expect(
      isPendingNewQuestionPin(dangling({ step: "stp_other", question: "q_new" }), pending),
    ).toBe(false);
  });

  it("does not match a pin at a version Accept will not create", () => {
    const atV2 = pendingNewQuestionPins(
      { steps: [{ ...proposed.steps[0]!, items: [{ questionId: "q_new", version: 2 }] }] },
      invented,
    );
    expect(isPendingNewQuestionPin(dangling({ step: "stp_new", question: "q_new" }), atV2)).toBe(
      false,
    );
  });

  it("does not match a question the proposal did not invent", () => {
    const none = pendingNewQuestionPins(proposed, []);
    expect(isPendingNewQuestionPin(dangling({ step: "stp_new", question: "q_new" }), none)).toBe(
      false,
    );
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

const PROPOSED_GROUP = {
  groupId: "grp_passengers",
  label: { en: "Passengers" },
  instanceLabel: { en: "Passenger {n}" },
  items: [
    { questionId: "q_passport", version: 1 },
    { questionId: "q_dob", version: 2 },
  ],
  count: { source: "open", min: 1, max: 9 },
  presentation: "stacked",
};

const AUTHORED_GROUP = {
  groupId: "grp_passengers",
  label: { en: "Passengers" },
  instanceLabel: { en: "Passenger {n}" },
  items: [
    { questionId: "q_passport", version: 1 },
    { questionId: "q_dob", version: 2 },
  ],
  count: { source: "open" as const, min: 1, max: 9 },
  presentation: "stacked" as const,
};

describe("a proposal carrying a repeating group", () => {
  it("reports the group, and its member questions, in the diff an author approves", () => {
    const proposed = {
      ...BASE,
      steps: [
        ...BASE.steps,
        { stepId: "stp_travellers", title: { en: "Travellers" }, items: [PROPOSED_GROUP] },
      ],
    };
    const diff = proposalDiff(BASE, proposed, [
      { questionId: "q_passport", type: "shortText" },
      { questionId: "q_dob", type: "date" },
    ]);

    const step = diff.find((entry) => entry.kind === "step" && entry.id === "stp_travellers");
    expect(step?.detail, "the step's own detail must name the group it carries").toContain(
      "grp_passengers",
    );
    expect(step?.detail).toContain("q_passport");

    expect(diff).toContainEqual(
      expect.objectContaining({
        kind: "question",
        change: "added",
        id: "q_passport",
        label: "q_passport (shortText)",
      }),
    );
    expect(diff).toContainEqual(
      expect.objectContaining({ kind: "question", id: "q_dob", label: "q_dob (date)" }),
    );
  });

  it("reports NOTHING when the proposal echoes a group the draft already has", () => {
    const current: DraftForm = {
      ...BASE,
      steps: [
        ...BASE.steps,
        { stepId: "stp_travellers", title: { en: "Travellers" }, items: [AUTHORED_GROUP] },
      ],
    };
    const proposed = {
      ...BASE,
      steps: [
        ...BASE.steps,
        { stepId: "stp_travellers", title: { en: "Travellers" }, items: [PROPOSED_GROUP] },
      ],
      rules: current.rules,
    };

    expect(proposalDiff(current, proposed, [])).toEqual([]);
  });

  it("keeps the group in the draft the builder holds after Accept", () => {
    const proposed = {
      ...BASE,
      steps: [
        ...BASE.steps,
        { stepId: "stp_travellers", title: { en: "Travellers" }, items: [PROPOSED_GROUP] },
      ],
    };

    expect(acceptedDraft(BASE, proposed).steps[1]).toEqual({
      stepId: "stp_travellers",
      title: { en: "Travellers" },
      items: [AUTHORED_GROUP],
    });
  });

  it("does not delete an authored group when the proposal echoes it", () => {
    const current: DraftForm = {
      ...BASE,
      steps: [
        ...BASE.steps,
        { stepId: "stp_travellers", title: { en: "Travellers" }, items: [AUTHORED_GROUP] },
      ],
    };
    const proposed = {
      ...BASE,
      steps: [
        ...BASE.steps,
        { stepId: "stp_travellers", title: { en: "Travellers" }, items: [PROPOSED_GROUP] },
      ],
    };

    expect(acceptedDraft(current, proposed).steps[1]?.items).toEqual([AUTHORED_GROUP]);
  });

  it("drops a group whose count source it cannot read, and keeps the pins beside it", () => {
    const proposed = {
      ...BASE,
      steps: [
        ...BASE.steps,
        {
          stepId: "stp_travellers",
          title: { en: "Travellers" },
          items: [
            { questionId: "q_purpose", version: 1 },
            { ...PROPOSED_GROUP, count: { source: "somethingElse" } },
          ],
        },
      ],
    };

    expect(acceptedDraft(BASE, proposed).steps[1]?.items).toEqual([
      { questionId: "q_purpose", version: 1 },
    ]);
  });
});
