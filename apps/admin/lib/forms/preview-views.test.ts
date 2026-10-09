import { describe, expect, it } from "vitest";

import { previewViews } from "./preview-views";
import type { CompiledStep, PreviewFlow } from "./types";

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
