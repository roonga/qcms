import { describe, expect, it } from "vitest";

import { countTargets, filterTargets, targetGroups, type TargetGroups } from "./rule-targets.ts";
import type { DraftForm } from "./types.ts";

/**
 * The target list at the scale the Code Owner named: an insurance organisation with ten
 * or more steps and hundreds of questions.
 *
 * That scale is the whole reason this module exists, so the fixture is built at it rather
 * than at the two-step size the rest of the builder's tests use. Ten steps of twenty
 * questions is two hundred targets plus ten step targets, which is enough for "grouped by
 * step" and "narrowed by a filter" to be claims about something rather than restatements
 * of a short list.
 */
function insuranceDraft(): DraftForm {
  return {
    formId: "frm_motor",
    defaultLocale: "en",
    title: { en: "Motor" },
    steps: Array.from({ length: 10 }, (_, stepIndex) => ({
      stepId: `stp_section_${String(stepIndex)}`,
      title: { en: `Section ${String(stepIndex)}` },
      items: Array.from({ length: 20 }, (_, itemIndex) => ({
        questionId: `q_s${String(stepIndex)}_q${String(itemIndex)}`,
        version: 1,
      })),
    })),
    rules: [],
  };
}

/** Every option id a set of groups holds, in the order a reader meets them. */
function idsOf(groups: readonly { readonly options: readonly { readonly id: string }[] }[]) {
  return groups.flatMap((group) => group.options.map((option) => option.id));
}

/** The step ids a set of groups renders headings for. */
function stepIdsOf(groups: readonly { readonly stepId: string }[]) {
  return groups.map((group) => group.stepId);
}

describe("targetGroups", () => {
  it("offers every question and every step of the form, and nothing else", () => {
    const groups = targetGroups(insuranceDraft(), []);

    // 200 questions plus 10 whole-step targets. A condition that reads nothing pinned
    // constrains nothing, so with no references every one of them is legal.
    expect(countTargets(groups)).toBe(210);
    expect(groups.ineligible).toEqual([]);
    expect(stepIdsOf(groups.eligible)).toHaveLength(10);
  });

  it("leads each step with the whole-step target, then that step's questions in order", () => {
    const groups = targetGroups(insuranceDraft(), []);
    const first = groups.eligible[0];

    expect(first?.stepId).toBe("stp_section_0");
    expect(first?.title).toBe("Section 0");
    expect(first?.options[0]).toEqual({
      id: "stp_section_0",
      label: "stp_section_0",
      kind: "step",
    });
    expect(first?.options[1]?.id).toBe("q_s0_q0");
    expect(first?.options.at(-1)?.id).toBe("q_s0_q19");
  });

  it("puts what comes before the condition in its own group rather than hiding it", () => {
    // ADR-16: the cut is at the LAST question the condition reads, so a condition reading
    // the third question of section 2 makes everything up to and including it illegal.
    const groups = targetGroups(insuranceDraft(), ["q_s2_q2"]);

    // `e2e/forms-builder.pw.ts` exit criterion 2 depends on this: the backward attempt has
    // to stay reachable, so the count of everything on offer is unchanged by the cut.
    expect(countTargets(groups)).toBe(210);
    expect(idsOf(groups.ineligible)).toContain("q_s0_q0");
    expect(idsOf(groups.ineligible)).toContain("q_s2_q2");
    expect(idsOf(groups.eligible)).toContain("q_s2_q3");
    expect(idsOf(groups.eligible)).not.toContain("q_s2_q2");
  });

  it("lists the one straddling step in both groups, which is what the engine would do", () => {
    const groups = targetGroups(insuranceDraft(), ["q_s2_q2"]);

    // Section 2 is cut in half. Its whole-step target is ILLEGAL, because the kernel
    // expands a step target to every question in it and three of section 2's questions
    // come before the condition; its later questions are legal on their own.
    expect(stepIdsOf(groups.ineligible)).toContain("stp_section_2");
    expect(stepIdsOf(groups.eligible)).toContain("stp_section_2");
    expect(idsOf(groups.ineligible)).toContain("stp_section_2");
    expect(idsOf(groups.eligible)).not.toContain("stp_section_2");

    // And it is the only step that can straddle, because eligibility is one cut through
    // document order rather than a per-step judgement.
    const both = stepIdsOf(groups.eligible).filter((id) =>
      stepIdsOf(groups.ineligible).includes(id),
    );
    expect(both).toEqual(["stp_section_2"]);
  });

  it("skips a step with no pins, which has nothing to show and no legal step target", () => {
    const draft = insuranceDraft();
    const withEmpty: DraftForm = {
      ...draft,
      steps: [...draft.steps, { stepId: "stp_empty", title: { en: "Empty" }, items: [] }],
    };
    const groups = targetGroups(withEmpty, []);

    expect(stepIdsOf(groups.eligible)).not.toContain("stp_empty");
    expect(stepIdsOf(groups.ineligible)).not.toContain("stp_empty");
  });

  it("falls back to the step id when a step has no title yet", () => {
    const draft = insuranceDraft();
    const untitled: DraftForm = {
      ...draft,
      steps: draft.steps.map((step, index) => (index === 0 ? { ...step, title: {} } : step)),
    };

    expect(targetGroups(untitled, []).eligible[0]?.title).toBe("stp_section_0");
  });
});

describe("filterTargets", () => {
  const groups: TargetGroups = targetGroups(insuranceDraft(), ["q_s2_q2"]);

  it("returns everything for an empty query, so the control starts unnarrowed", () => {
    expect(countTargets(filterTargets(groups, ""))).toBe(210);
    expect(countTargets(filterTargets(groups, "   "))).toBe(210);
  });

  it("keeps a whole step when the step's own title matches, questions included", () => {
    // The gesture this exists for: "show the claim details step". Its questions are not
    // named after it, so matching only ids would return the step target and nothing else.
    const narrowed = filterTargets(groups, "Section 7");

    expect(stepIdsOf(narrowed.eligible)).toEqual(["stp_section_7"]);
    expect(narrowed.ineligible).toEqual([]);
    expect(countTargets(narrowed)).toBe(21);
  });

  it("keeps a whole step when the step's id matches", () => {
    expect(countTargets(filterTargets(groups, "stp_section_7"))).toBe(21);
  });

  it("keeps a single question wherever it sits, under its own step's heading", () => {
    const narrowed = filterTargets(groups, "q_s5_q13");

    expect(idsOf(narrowed.eligible)).toEqual(["q_s5_q13"]);
    expect(stepIdsOf(narrowed.eligible)).toEqual(["stp_section_5"]);
  });

  it("narrows both groups at once, so a filtered backward target stays visible", () => {
    // "_q3" is the fourth question of every step and of no other question: "_q13" does not
    // contain it. So this is one match per step, spread across the cut at section 2.
    const narrowed = filterTargets(groups, "_q3");

    expect(countTargets(narrowed)).toBe(10);
    expect(idsOf(narrowed.ineligible)).toContain("q_s0_q3");
    expect(idsOf(narrowed.eligible)).toContain("q_s9_q3");
  });

  it("is case-insensitive, because an id is copied and a title is typed", () => {
    expect(countTargets(filterTargets(groups, "SECTION 7"))).toBe(21);
    expect(countTargets(filterTargets(groups, "Q_S5_Q13"))).toBe(1);
  });

  it("drops a step group that matches nothing rather than leaving an empty heading", () => {
    const narrowed = filterTargets(groups, "nothing_matches_this");

    expect(narrowed.eligible).toEqual([]);
    expect(narrowed.ineligible).toEqual([]);
    expect(countTargets(narrowed)).toBe(0);
  });
});
