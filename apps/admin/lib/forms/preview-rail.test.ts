import { describe, expect, it } from "vitest";

import { previewRail } from "./preview-rail.ts";
import type { PreviewView } from "./preview-views.ts";
import type { DraftForm } from "./types.ts";

const draft: DraftForm = {
  formId: "frm_rail",
  defaultLocale: "en",
  title: { en: "Rail" },
  rules: [],
  steps: ["stp_a", "stp_b", "stp_c", "stp_d"].map((stepId) => ({
    stepId,
    title: { en: stepId.toUpperCase() },
    items: [],
  })),
};

function views(...stepIds: string[]): PreviewView[] {
  return stepIds.map((stepId) => ({ step: { stepId, root: null }, instanceId: null }));
}

describe("the preview's step rail", () => {
  it("lists every step in form order with the portal's states", () => {
    const rail = previewRail(draft, views("stp_a", "stp_b", "stp_d"), 1);
    expect(rail.map(({ stepId, state, cursor }) => [stepId, state, cursor])).toEqual([
      ["stp_a", "completed", 0],
      ["stp_b", "current", null],
      ["stp_c", "notNeeded", null],
      ["stp_d", "ahead", null],
    ]);
    expect(rail.map((step) => step.label)).toEqual(["STP_A", "STP_B", "STP_C", "STP_D"]);
  });

  it("keeps a paginated step current on each of its pages and points back at its first", () => {
    const paged = views("stp_a", "stp_b", "stp_b", "stp_c");
    expect(previewRail(draft, paged, 2).map((step) => step.state)).toEqual([
      "completed",
      "current",
      "ahead",
      "notNeeded",
    ]);
    expect(previewRail(draft, paged, 3)[1]).toMatchObject({ state: "completed", cursor: 1 });
  });

  it("labels an untitled step with nothing, as the portal does", () => {
    const untitled = { ...draft, steps: [{ stepId: "stp_a", title: {}, items: [] }] };
    expect(previewRail(untitled, views("stp_a"), 0)[0]?.label).toBe("");
  });
});
