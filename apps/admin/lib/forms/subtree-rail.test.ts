import { describe, expect, it } from "vitest";

import type { DraftStep } from "./types.ts";
import { formDisplayName, formSubtreeRail, railIssueTotal, RAIL_SECTIONS } from "./subtree-rail.ts";

const STEPS: readonly DraftStep[] = [
  { stepId: "stp_about", title: { en: "About you" }, items: [] },
  { stepId: "stp_health", title: { en: "Health" }, items: [] },
  { stepId: "stp_blank", title: { en: "" }, items: [] },
];

const FORM_ID = "frm_life";
const SLUG = "life-insurance";

const TITLE = "Life insurance";

function rail(current: Parameters<typeof formSubtreeRail>[0]["current"], counts = new Map()) {
  return formSubtreeRail({
    formId: FORM_ID,
    slug: SLUG,
    title: TITLE,
    steps: STEPS,
    issueCounts: counts,
    current,
  });
}

describe("the form-subtree rail's contents", () => {
  it("carries the eight sibling routes in §7's order, and Validation is not one of them", () => {
    expect([...RAIL_SECTIONS]).toStrictEqual([
      "builder",
      "rules",
      "preview",
      "versions",
      "publish",
      "links",
      "responses",
      "webhooks",
    ]);
  });

  it("puts the form's children first and its siblings second", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.label)).toStrictEqual([
      "About you",
      "Health",

      "Untitled step",
    ]);
    expect(groups.siblings.map((item) => item.label)).toStrictEqual([
      TITLE,

      "Rules",
      "Preview",

      "Versions",

      "Publish",
      "Links",
      "Responses",
      "Webhooks",
    ]);
  });

  it("points each sibling at its own route, with the builder as the form itself", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.siblings.map((item) => item.href)).toStrictEqual([
      "/forms/frm_life",
      "/forms/frm_life/rules",
      "/forms/frm_life/preview",
      "/forms/frm_life/versions",
      "/forms/frm_life/publish",
      "/forms/frm_life/links",
      "/forms/frm_life/responses",
      "/forms/frm_life/webhooks",
    ]);
  });

  it("points a step at the builder's anchor for it, which is the only address a step has", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.href)).toStrictEqual([
      "/forms/frm_life#step-stp_about",
      "/forms/frm_life#step-stp_health",
      "/forms/frm_life#step-stp_blank",
    ]);
  });

  it("makes a step row the destination for the id it points at, and a sibling row no destination", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.anchorId)).toStrictEqual([
      "step-stp_about",
      "step-stp_health",
      "step-stp_blank",
    ]);
    expect(groups.siblings.every((item) => item.anchorId === undefined)).toBe(true);
  });

  it("numbers the steps in document order and leaves the sections unnumbered", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.position)).toStrictEqual([1, 2, 3]);
    expect(groups.siblings.every((item) => item.position === undefined)).toBe(true);
  });

  it("marks exactly one row current, and marks the right one", () => {
    const groups = rail({ kind: "section", section: "responses" });
    const current = [...groups.children, ...groups.siblings].filter((item) => item.isCurrent);
    expect(current.map((item) => item.key)).toStrictEqual(["section:responses"]);
  });

  it("marks a step current when the screen is that step", () => {
    const groups = rail({ kind: "step", stepId: "stp_health" });
    const current = [...groups.children, ...groups.siblings].filter((item) => item.isCurrent);
    expect(current.map((item) => item.key)).toStrictEqual(["step:stp_health"]);
  });

  it("badges a step with its own issue count and never badges a section", () => {
    const groups = rail({ kind: "section", section: "links" }, new Map([["stp_health", 2]]));
    expect(groups.children.map((item) => item.issueCount)).toStrictEqual([0, 2, 0]);
    expect(groups.siblings.every((item) => item.issueCount === 0)).toBe(true);
  });

  it("renders without badges rather than claiming a clean form when there is no verdict", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.every((item) => item.issueCount === 0)).toBe(true);
  });

  it("escapes a form id on its way into an href", () => {
    const groups = formSubtreeRail({
      formId: "frm_a b",
      slug: "a b",
      title: "",
      steps: [],
      issueCounts: new Map(),
      current: { kind: "section", section: "builder" },
    });
    expect(groups.siblings[0]?.href).toBe("/forms/frm_a%20b");
  });
});

describe("what the collapsed Header carries", () => {
  it("names the form whatever is current, and counts the form's own issues", () => {
    for (const current of [
      { kind: "section", section: "links" },
      { kind: "step", stepId: "stp_health" },

      { kind: "step", stepId: "stp_gone" },
    ] as const) {
      const groups = rail(current, new Map([["stp_health", 2]]));
      expect(formDisplayName("", "life"), `named the form on ${current.kind}`).toBe("life");
      expect(railIssueTotal(groups), "the form's total, not the current row's").toBe(2);
    }
  });

  it("prefers what the author called the form over how it is addressed", () => {
    expect(formDisplayName("Life insurance", "life")).toBe("Life insurance");
  });

  it("falls back to the slug for a form nobody has named yet, rather than an empty row", () => {
    expect(formDisplayName("", "life")).toBe("life");
    expect(formDisplayName("   ", "life"), "whitespace is not a name").toBe("life");
  });

  it("counts every step's issues, not the current row's", () => {
    const groups = rail(
      { kind: "section", section: "links" },
      new Map([
        ["stp_about", 1],
        ["stp_health", 2],
      ]),
    );
    expect(railIssueTotal(groups)).toBe(3);
  });
});
