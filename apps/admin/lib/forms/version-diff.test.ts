import { describe, expect, it } from "vitest";

import { definitionLines, diffDefinitions } from "./version-diff.ts";

/**
 * The version-to-version definition diff (task 034).
 *
 * The properties that matter are all about *not lying to an author*: a difference in key
 * order is not an edit and must not read as one; a reordering of steps is an edit and must;
 * and every row has to be readable with colour off.
 */

const v1 = {
  formId: "frm_demo",
  defaultLocale: "en",
  title: { en: "Vehicle insurance" },
  steps: [{ stepId: "stp_driver", title: { en: "Driver" }, items: [] }],
  rules: [],
};

describe("canonical printing", () => {
  it("sorts object keys, so a serialization difference is never an edit", () => {
    const reordered = {
      rules: [],
      steps: [{ items: [], title: { en: "Driver" }, stepId: "stp_driver" }],
      title: { en: "Vehicle insurance" },
      defaultLocale: "en",
      formId: "frm_demo",
    };
    expect(definitionLines(reordered)).toEqual(definitionLines(v1));
    expect(diffDefinitions(v1, reordered).identical).toBe(true);
  });

  it("keeps array order, because reordering steps is a real edit", () => {
    const swapped = {
      ...v1,
      steps: [
        { stepId: "stp_vehicle", title: { en: "Vehicle" }, items: [] },
        { stepId: "stp_driver", title: { en: "Driver" }, items: [] },
      ],
    };
    const original = {
      ...v1,
      steps: [
        { stepId: "stp_driver", title: { en: "Driver" }, items: [] },
        { stepId: "stp_vehicle", title: { en: "Vehicle" }, items: [] },
      ],
    };
    expect(diffDefinitions(original, swapped).identical).toBe(false);
  });
});

describe("the aligned rows", () => {
  it("marks an addition on the newer side only, with a textual marker", () => {
    const v2 = { ...v1, title: { en: "Vehicle insurance", fr: "Assurance" } };
    const diff = diffDefinitions(v1, v2);

    expect(diff.identical).toBe(false);
    expect(diff.added).toBeGreaterThan(0);

    const addition = diff.rows.find((row) => row.kind === "added");
    expect(addition?.marker).toBe("+");
    expect(addition?.left).toBeNull();
    expect(addition?.right).not.toBeNull();
  });

  it("marks a removal on the older side only", () => {
    const v2 = { ...v1, steps: [] };
    const diff = diffDefinitions(v1, v2);

    const removal = diff.rows.find((row) => row.kind === "removed");
    expect(removal?.marker).toBe("-");
    expect(removal?.right).toBeNull();
    expect(diff.removed).toBeGreaterThan(0);
  });

  it("gives every row a marker, so the diff never needs colour to be read", () => {
    const diff = diffDefinitions(v1, { ...v1, defaultLocale: "fr" });
    for (const row of diff.rows) {
      expect([" ", "+", "-"]).toContain(row.marker);
    }
  });

  it("keeps every unchanged line on both sides", () => {
    const diff = diffDefinitions(v1, { ...v1, defaultLocale: "fr" });
    for (const row of diff.rows.filter((candidate) => candidate.kind === "same")) {
      expect(row.left).toBe(row.right);
    }
  });

  it("reports rather than hangs when a definition is too large to align", () => {
    const huge = { formId: "frm_big", steps: Array.from({ length: 4000 }, (_, i) => ({ id: i })) };
    const diff = diffDefinitions(v1, huge);

    expect(diff.tooLarge).toBe(true);
    expect(diff.rows).toEqual([]);
  });

  it("survives a definition it cannot print", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["itself"] = cyclic;
    expect(definitionLines(cyclic)).toEqual([]);
  });
});
