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

/**
 * A proposal that carries a repeating group (task 074, ADR-42).
 *
 * ## Why this block exists, and what it was red against
 *
 * This file's parser read a step's item list as "every entry carrying a `questionId`", which was
 * total while a step held nothing else and silently DROPS a group. Two consequences, the second
 * worse:
 *
 * - the diff an author approves omits the group and every question inside it, so they approve a
 *   change that does not mention what they are accepting;
 * - `acceptedDraft` takes `steps` wholesale, so accepting a proposal that merely echoes back an
 *   existing group DELETES the author's authored group and leaves the step empty - which trips
 *   `unsaveableReason` to `emptyStep` and parks autosave.
 *
 * Task 074 is the task that makes the shape reachable: it is where an author can create a group,
 * and where the draft assistant's prompt starts documenting one. Both readers of these bytes now
 * share `lib/forms/draft-payload.ts`, so the fix cannot come apart again.
 *
 * Red-first, verified rather than assumed: with `readStepItems` reverted to the question-only
 * filter, every case below fails - the added-step case reports `"items": []` in its own detail,
 * the echo case reports an unexpected `changed` entry, and both accept cases hand back a step
 * with no items at all.
 */

/** One group as a proposal carries it: the airline shape the prompt now describes. */
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

/** The same group, as the builder's own draft holds it. */
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
    // The member questions are listed as questions in their own right, with their types: a
    // question does not know it is repeated, so the diff names it the way it names any pin.
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

    // An echo is not a change. A parser that dropped the group would report the step as
    // `changed` and show an author a diff of their own group disappearing.
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

    // `acceptedDraft` takes `steps` wholesale, so this is the whole of the data-loss case: the
    // accepted draft has to still hold the group and its two members.
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

    // Loud rather than silent, for the reason `draft-payload.ts` gives: an invented count source
    // would be shown in the panel and stored by the next autosave.
    expect(acceptedDraft(BASE, proposed).steps[1]?.items).toEqual([
      { questionId: "q_purpose", version: 1 },
    ]);
  });
});
