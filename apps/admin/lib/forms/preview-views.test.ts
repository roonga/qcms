import { describe, expect, it } from "vitest";

import {
  previewInstanceLabel,
  previewViewNarrowing,
  previewViews,
  type PreviewView,
} from "./preview-views";
import type { CompiledStep, DraftForm, DraftGroup, PreviewFlow } from "./types";

/**
 * The preview pane's page list (task 076, ADR-28 as amended 2026-09-29, Q22).
 *
 * The pane renders what a respondent renders, through the same `documentForVisible` and
 * the same `A2UIStepRenderer`, so after this task it also has to WALK what a respondent
 * walks: views, not steps. These cases are the two halves of that - a draft with no
 * repeating group previewing exactly as it did, and a paginated step previewing as one
 * page per live instance.
 */

const step = (stepId: string): CompiledStep => ({ stepId, root: { type: "Form" } });
const DOCUMENTS = [step("stp_one"), step("stp_pax"), step("stp_three")];

/**
 * A preview flow with the fields a case cares about overridden.
 *
 * `rosters` is listed rather than spread in, because task 074 made it a required field
 * and `exactOptionalPropertyTypes` will not take a `Partial` spread over one: an absent
 * key and a key holding `undefined` are different things to it. The overrides are named
 * one at a time for the same reason.
 */
const flow = (over: {
  readonly visibleSteps?: readonly string[];
  readonly visibleStepViews?: readonly {
    readonly stepId: string;
    readonly instanceId: string | null;
  }[];
}): PreviewFlow => ({
  visibleSteps: over.visibleSteps ?? DOCUMENTS.map((document) => document.stepId),
  visibleQuestions: [],
  complete: false,
  rosters: [],
  ...(over.visibleStepViews === undefined ? {} : { visibleStepViews: over.visibleStepViews }),
});

describe("previewViews", () => {
  it("is the visible steps in document order when the draft holds no group", () => {
    // The kernel omits every repetition field for such a draft, so the absence of the
    // view list is the signal and not a fallback for a failure.
    const views = previewViews(DOCUMENTS, flow({}));
    expect(views.map((view) => view.step.stepId)).toEqual(["stp_one", "stp_pax", "stp_three"]);
    expect(views.every((view) => view.instanceId === null)).toBe(true);
  });

  it("orders from the documents rather than from the projection list", () => {
    // A projection list is a set rather than a sequence, and the compiled documents are
    // emitted in the definition's step order, which is the order a respondent walks.
    const views = previewViews(DOCUMENTS, flow({ visibleSteps: ["stp_three", "stp_one"] }));
    expect(views.map((view) => view.step.stepId)).toEqual(["stp_one", "stp_three"]);
  });

  it("walks one page per live instance for a paginated step", () => {
    const views = previewViews(
      DOCUMENTS,
      flow({
        visibleStepViews: [
          { stepId: "stp_one", instanceId: null },
          { stepId: "stp_pax", instanceId: "ins_a" },
          { stepId: "stp_pax", instanceId: "ins_b" },
          { stepId: "stp_pax", instanceId: "ins_c" },
          { stepId: "stp_three", instanceId: null },
        ],
      }),
    );
    // Five pages for three steps, so the pane's "of N" says five and Next moves one view.
    expect(views).toHaveLength(5);
    expect(views.map((view) => `${view.step.stepId}/${view.instanceId ?? "-"}`)).toEqual([
      "stp_one/-",
      "stp_pax/ins_a",
      "stp_pax/ins_b",
      "stp_pax/ins_c",
      "stp_three/-",
    ]);
    // The same compiled document three times, which is what a paginated step is.
    expect(views[1]!.step).toBe(views[3]!.step);
  });

  it("uses the view list as given, because it is already a sequence", () => {
    const views = previewViews(
      DOCUMENTS,
      flow({
        visibleStepViews: [
          { stepId: "stp_three", instanceId: null },
          { stepId: "stp_one", instanceId: null },
        ],
      }),
    );
    expect(views.map((view) => view.step.stepId)).toEqual(["stp_three", "stp_one"]);
  });

  it("drops a view naming a step with no compiled document rather than rendering a hole", () => {
    const views = previewViews(
      DOCUMENTS,
      flow({
        visibleStepViews: [
          { stepId: "stp_missing", instanceId: null },
          { stepId: "stp_one", instanceId: null },
        ],
      }),
    );
    expect(views.map((view) => view.step.stepId)).toEqual(["stp_one"]);
  });

  it("is empty with no preview at all, so the pane clamps to nothing rather than throwing", () => {
    expect(previewViews([], undefined)).toEqual([]);
  });
});

const group = (
  groupId: string,
  presentation: DraftGroup["presentation"],
  instanceLabel = "Passenger {n}",
): DraftGroup => ({
  groupId,
  label: { en: "Passengers" },
  instanceLabel: { en: instanceLabel },
  items: [{ questionId: `q_${groupId}`, version: 1 }],
  count: { source: "open", min: 1, max: 5 },
  presentation,
});

const draftWith = (...items: DraftGroup[]): DraftForm => ({
  formId: "frm_trip",
  defaultLocale: "en",
  title: { en: "Trip" },
  steps: [
    { stepId: "stp_one", title: { en: "One" }, items: [] },
    { stepId: "stp_pax", title: { en: "Passengers" }, items },
  ],
  rules: [],
});

/** The served roster the narrowing cases read against. */
const SERVED: Readonly<Record<string, readonly string[]>> = {
  grp_pax: ["ins_p1", "ins_p2", "ins_p3"],
  grp_first: ["ins_p1"],
};

const page = (stepId: string, instanceId: string | null): PreviewView => ({
  step: step(stepId),
  instanceId,
});

describe("previewViewNarrowing", () => {
  it("names the step's perInstanceStep group and the page's instance", () => {
    const draft = draftWith(group("grp_pax", "perInstanceStep"));
    expect(previewViewNarrowing(draft, page("stp_pax", "ins_p2"), SERVED)).toEqual({
      groupId: "grp_pax",
      instanceId: "ins_p2",
    });
  });

  it("picks the FIRST perInstanceStep group, as the kernel and the API do", () => {
    const draft = draftWith(
      group("grp_stacked", "stacked"),
      group("grp_first", "perInstanceStep"),
      group("grp_second", "perInstanceStep"),
    );
    expect(previewViewNarrowing(draft, page("stp_pax", "ins_p1"), SERVED)?.groupId).toBe(
      "grp_first",
    );
  });

  it("narrows nothing on an ordinary page", () => {
    const draft = draftWith(group("grp_pax", "perInstanceStep"));
    expect(previewViewNarrowing(draft, page("stp_one", null), SERVED)).toBeUndefined();
    expect(previewViewNarrowing(draft, undefined, SERVED)).toBeUndefined();
    expect(previewViewNarrowing(null, page("stp_pax", "ins_p1"), SERVED)).toBeUndefined();
  });

  it("narrows nothing while the draft no longer paginates the step", () => {
    // The author switched the group to stacked and the debounced re-ask has not answered.
    const draft = draftWith(group("grp_pax", "stacked"));
    expect(previewViewNarrowing(draft, page("stp_pax", "ins_p1"), SERVED)).toBeUndefined();
  });

  it("narrows nothing to an instance the served roster does not carry", () => {
    // The author lowered the count and the debounced re-ask has not answered: the page list
    // still names an instance the projection no longer serves.
    const draft = draftWith(group("grp_pax", "perInstanceStep"));
    expect(previewViewNarrowing(draft, page("stp_pax", "ins_p9"), SERVED)).toBeUndefined();
    expect(previewViewNarrowing(draft, page("stp_pax", "ins_p1"), {})).toBeUndefined();
  });
});

describe("previewInstanceLabel", () => {
  const draft = draftWith(group("grp_pax", "perInstanceStep"));
  const rosters = { grp_pax: ["ins_p1", "ins_p2", "ins_p3"] };

  it("resolves the template at the instance's ordinal in the full roster", () => {
    expect(previewInstanceLabel(draft, rosters, { groupId: "grp_pax", instanceId: "ins_p2" })).toBe(
      "Passenger 2",
    );
  });

  it("is undefined with no narrowing, an unknown instance or an empty template", () => {
    expect(previewInstanceLabel(draft, rosters, undefined)).toBeUndefined();
    expect(
      previewInstanceLabel(draft, rosters, { groupId: "grp_pax", instanceId: "ins_gone" }),
    ).toBeUndefined();
    const blank = draftWith(group("grp_pax", "perInstanceStep", ""));
    expect(
      previewInstanceLabel(blank, rosters, { groupId: "grp_pax", instanceId: "ins_p1" }),
    ).toBeUndefined();
  });
});
