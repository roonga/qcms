import { describe, expect, it } from "vitest";

import { pinRowMenuItems, pinRows, pinStateLabel } from "./pin-grid.ts";
import type { DraftStep, FormIssue, PinnableQuestion } from "./types.ts";

/**
 * The pin list's view model (issue 517).
 *
 * Two things here are conformance rather than convenience, and this file exists so they
 * cannot be trimmed by a later edit without a test going red:
 *
 * 1. **The grip menu carries all five entries.** Insert above and insert below are the
 *    equivalent controls that let a row-boundary insert affordance meet WCAG 2.2
 *    SC 2.5.8 at all, and move up / move down are the single-pointer, non-dragging
 *    reorder path SC 2.5.7 asks for and the one `plan/admin-mobile-stance.md` puts on
 *    the supported-at-390 path. A menu that has quietly lost two of them still looks
 *    fine in a screenshot.
 * 2. **The library's half of a row is read from the library, never from the pin.** A
 *    row whose question the library no longer reports still renders, with the
 *    "not in library" line and no version to move to, rather than throwing.
 */

const DEFINITION = {
  questionId: "q_at_fault_accident",
  type: "boolean" as const,
  label: { en: "Were you at fault?" },
};

function question(overrides: Partial<PinnableQuestion> = {}): PinnableQuestion {
  return {
    questionId: "q_at_fault_accident",
    slug: "at-fault-accident",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [
      { version: 1, status: "published", definition: DEFINITION },
      { version: 2, status: "published", definition: DEFINITION },
      { version: 3, status: "draft", definition: DEFINITION },
    ],
    ...overrides,
  };
}

const STEP: DraftStep = {
  stepId: "stp_history",
  title: { en: "Driving history" },
  items: [
    { questionId: "q_at_fault_accident", version: 1 },
    { questionId: "q_accident_count", version: 2 },
  ],
};

const COUNT = question({
  questionId: "q_accident_count",
  slug: "accident-count",
  label: { en: "How many accidents?" },
  type: "number",
  versions: [{ version: 2, status: "published", definition: { ...DEFINITION, type: "number" } }],
});

describe("pinRows", () => {
  it("reads the library-owned half from the library and the form-owned half from the pin", () => {
    const rows = pinRows(STEP, [question(), COUNT], []);

    expect(rows.map((row) => row.questionId)).toEqual(["q_at_fault_accident", "q_accident_count"]);
    expect(rows[0]?.label).toBe("Were you at fault?");
    expect(rows[0]?.type).toBe("Yes or no");
    // Form-owned: the version this form serves, and where the pin sits in the step.
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.position).toBe(1);
    expect(rows[1]?.position).toBe(2);
    expect(rows[0]?.total).toBe(2);
  });

  it("offers only other PUBLISHED versions to move to, never the current one and never a draft", () => {
    const rows = pinRows(STEP, [question(), COUNT], []);

    // v1 is pinned, v2 is published, v3 is a draft: a pin to something that can still
    // change is not a pin (R7), so only v2 is on offer.
    expect(rows[0]?.otherVersions).toEqual([2]);
    expect(rows[1]?.otherVersions).toEqual([]);
  });

  it("renders a pin whose question the library lost, rather than dropping the row", () => {
    const rows = pinRows(STEP, [COUNT], []);

    expect(rows[0]?.label).toBe("");
    expect(rows[0]?.type).toBe("Unknown");
    expect(rows[0]?.versionStatus).toBeUndefined();
    expect(rows[0]?.otherVersions).toEqual([]);
  });

  it("gives a row the issues about its question and not the ones about a rule", () => {
    const issues: readonly FormIssue[] = [
      { code: "PIN_DEPRECATED", message: "x", path: { question: "q_at_fault_accident" } },
      {
        code: "RULE_BACKWARD_TARGET",
        message: "y",
        path: { question: "q_at_fault_accident", rule: "rul_one" },
      },
      { code: "OTHER", message: "z", path: { question: "q_accident_count" } },
    ];
    const rows = pinRows(STEP, [question(), COUNT], issues);

    expect(rows[0]?.issues.map((issue) => issue.code)).toEqual(["PIN_DEPRECATED"]);
    expect(rows[1]?.issues.map((issue) => issue.code)).toEqual(["OTHER"]);
  });
});

describe("pinRowMenuItems", () => {
  const rows = pinRows(STEP, [question(), COUNT], []);
  const first = rows[0];
  const last = rows[1];

  it("offers insert above, insert below, move up, move down and remove", () => {
    expect(first).toBeDefined();
    if (first === undefined) return;

    expect(pinRowMenuItems(first).map((item) => item.action)).toEqual([
      "insertAbove",
      "insertBelow",
      "moveUp",
      "moveDown",
      "remove",
    ]);
  });

  it("names the row in every label, so two rows' menus stay distinguishable", () => {
    expect(first).toBeDefined();
    if (first === undefined) return;

    for (const item of pinRowMenuItems(first)) {
      expect(item.label).toContain("q_at_fault_accident");
    }
  });

  it("disables only the move that would run off the end of the step", () => {
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;

    const top = new Map(pinRowMenuItems(first).map((item) => [item.action, item.isDisabled]));
    const bottom = new Map(pinRowMenuItems(last).map((item) => [item.action, item.isDisabled]));

    expect(top.get("moveUp")).toBe(true);
    expect(top.get("moveDown")).toBe(false);
    expect(bottom.get("moveUp")).toBe(false);
    expect(bottom.get("moveDown")).toBe(true);
    // Removing the last pin is legal: an empty step is a state the editor renders.
    expect(top.get("remove")).toBe(false);
    expect(bottom.get("remove")).toBe(false);
    // Insert is never off. It is what SC 2.5.8 leans on.
    expect(top.get("insertAbove")).toBe(false);
    expect(top.get("insertBelow")).toBe(false);
  });

  it("marks only remove as destructive", () => {
    expect(first).toBeDefined();
    if (first === undefined) return;

    const danger = pinRowMenuItems(first)
      .filter((item) => item.isDanger)
      .map((item) => item.action);
    expect(danger).toEqual(["remove"]);
  });
});

describe("pinStateLabel", () => {
  it("says nothing for the ordinary case, and one word for each case worth flagging", () => {
    expect(pinStateLabel("published")).toBeUndefined();
    expect(pinStateLabel("deprecated")).toBe("Deprecated version");
    expect(pinStateLabel("draft")).toBe("Unpublished version");
    expect(pinStateLabel(undefined)).toBe("Version not found");
  });
});
