import { describe, expect, it } from "vitest";

import { addOption } from "./definition.ts";
import {
  abandonPendingRow,
  commitPendingRow,
  committedIndexOf,
  gridRows,
  insertOptionAt,
  moveOptionTo,
  openPendingRow,
  optionRowMenuItems,
  setPendingLabel,
  type OptionGridState,
  type OptionRowAction,
} from "./option-grid.ts";

import type { ChoiceOptionView } from "./types.ts";

function seeded(): readonly ChoiceOptionView[] {
  return addOption([], "Red");
}

function idsOf(state: OptionGridState): readonly string[] {
  return state.options.map((option) => option.optionId);
}

function labelsOf(state: OptionGridState): readonly string[] {
  return state.options.map((option) => option.label["en"] ?? "");
}

describe("deferred minting (the ruling of 2026-08-06)", () => {
  it("consumes no option id for a ghost add-row that is opened and abandoned", () => {
    const before: OptionGridState = { options: seeded(), pending: undefined };

    const ghost = openPendingRow(before, before.options.length);
    expect(ghost.options).toEqual(before.options);
    expect(ghost.pending).toEqual({ index: 1, label: "" });

    expect(abandonPendingRow(ghost).options).toEqual(before.options);

    const named = commitPendingRow(setPendingLabel(ghost, "Blue"));
    expect(idsOf(named)).toEqual(["opt_red", "opt_blue"]);
    expect(named.pending).toBeUndefined();
  });

  it("consumes no option id for an INSERT-BETWEEN row that is opened and abandoned", () => {
    const start: OptionGridState = { options: addOption(seeded(), "Blue"), pending: undefined };

    const inserted = openPendingRow(start, 1);
    expect(inserted.options).toEqual(start.options);
    expect(inserted.pending).toEqual({ index: 1, label: "" });
    expect(abandonPendingRow(inserted).options).toEqual(start.options);

    const named = commitPendingRow(setPendingLabel(inserted, "Green"));
    expect(idsOf(named)).toEqual(["opt_red", "opt_green", "opt_blue"]);
    expect(labelsOf(named)).toEqual(["Red", "Green", "Blue"]);
  });

  it("mints from the label the row was named with, never from the empty row it started as", () => {
    const state: OptionGridState = { options: [], pending: undefined };
    const named = commitPendingRow(setPendingLabel(openPendingRow(state, 0), "Option"));
    expect(idsOf(named)).toEqual(["opt_option"]);
  });

  it("abandons a row whose label is only whitespace instead of minting from it", () => {
    const start: OptionGridState = { options: seeded(), pending: undefined };
    const committed = commitPendingRow(setPendingLabel(openPendingRow(start, 1), "   "));
    expect(committed.options).toEqual(start.options);
    expect(committed.pending).toBeUndefined();
    expect(committedIndexOf(setPendingLabel(openPendingRow(start, 1), "   "))).toBeUndefined();
  });

  it("has no shape that could carry an id on a pending row", () => {
    const ghost = openPendingRow({ options: seeded(), pending: undefined }, 1);
    expect(Object.keys(ghost.pending ?? {}).sort()).toEqual(["index", "label"]);
  });
});

describe("openPendingRow", () => {
  it("commits an in-flight named row before opening the next one", () => {
    const start: OptionGridState = { options: seeded(), pending: undefined };
    const first = setPendingLabel(openPendingRow(start, 1), "Blue");
    const second = openPendingRow(first, 2);
    expect(idsOf(second)).toEqual(["opt_red", "opt_blue"]);
    expect(second.pending).toEqual({ index: 2, label: "" });
  });

  it("shifts the new row past a commit that landed ahead of it", () => {
    const start: OptionGridState = { options: seeded(), pending: undefined };
    const first = setPendingLabel(openPendingRow(start, 0), "Blue");
    const second = openPendingRow(first, 1);
    expect(labelsOf(second)).toEqual(["Blue", "Red"]);
    expect(second.pending?.index).toBe(2);
  });

  it("does not shift when the in-flight row was abandoned", () => {
    const start: OptionGridState = { options: seeded(), pending: undefined };
    const abandoned = openPendingRow(start, 0);
    expect(openPendingRow(abandoned, 1).pending?.index).toBe(1);
  });

  it("clamps an out-of-range position onto the list", () => {
    const start: OptionGridState = { options: seeded(), pending: undefined };
    expect(openPendingRow(start, 99).pending?.index).toBe(1);
    expect(openPendingRow(start, -4).pending?.index).toBe(0);
  });
});

describe("setPendingLabel", () => {
  it("is a no-op when no row is pending", () => {
    const start: OptionGridState = { options: seeded(), pending: undefined };
    expect(setPendingLabel(start, "Blue")).toBe(start);
  });

  it("keeps whitespace exactly as typed", () => {
    const ghost = openPendingRow({ options: [], pending: undefined }, 0);
    expect(setPendingLabel(ghost, "Blue ").pending?.label).toBe("Blue ");
  });
});

describe("insertOptionAt", () => {
  it("lands a new option at the top, the middle and the bottom", () => {
    const base = addOption(addOption([], "Red"), "Blue");
    expect(insertOptionAt(base, "Green", 0).map((o) => o.optionId)).toEqual([
      "opt_green",
      "opt_red",
      "opt_blue",
    ]);
    expect(insertOptionAt(base, "Green", 1).map((o) => o.optionId)).toEqual([
      "opt_red",
      "opt_green",
      "opt_blue",
    ]);
    expect(insertOptionAt(base, "Green", 2).map((o) => o.optionId)).toEqual([
      "opt_red",
      "opt_blue",
      "opt_green",
    ]);
  });

  it("carries every existing id and label through untouched", () => {
    const base = addOption(addOption([], "Red"), "Blue");
    const next = insertOptionAt(base, "Green", 1);
    expect(next[0]).toEqual(base[0]);
    expect(next[2]).toEqual(base[1]);
  });

  it("suffixes rather than reusing when the label collides", () => {
    const base = addOption([], "Red");
    expect(insertOptionAt(base, "Red", 0).map((o) => o.optionId)).toEqual(["opt_red_2", "opt_red"]);
  });

  it("clamps a position outside the list", () => {
    const base = addOption([], "Red");
    expect(insertOptionAt(base, "Blue", 9).map((o) => o.optionId)).toEqual(["opt_red", "opt_blue"]);
    expect(insertOptionAt(base, "Blue", -3).map((o) => o.optionId)).toEqual([
      "opt_blue",
      "opt_red",
    ]);
  });
});

describe("moveOptionTo", () => {
  const base = addOption(addOption(addOption([], "Red"), "Blue"), "Green");

  it("moves a row down and up across several positions", () => {
    expect(moveOptionTo(base, 0, 2).map((o) => o.optionId)).toEqual([
      "opt_blue",
      "opt_green",
      "opt_red",
    ]);
    expect(moveOptionTo(base, 2, 0).map((o) => o.optionId)).toEqual([
      "opt_green",
      "opt_red",
      "opt_blue",
    ]);
  });

  it("keeps each id with its own label", () => {
    const moved = moveOptionTo(base, 0, 2);
    expect(moved[2]).toEqual(base[0]);
  });

  it("returns the list untouched for a no-op or an impossible source", () => {
    expect(moveOptionTo(base, 1, 1)).toEqual(base);
    expect(moveOptionTo(base, 7, 0)).toBe(base);
    expect(moveOptionTo(base, -1, 0)).toBe(base);
  });

  it("clamps a target past either end", () => {
    expect(moveOptionTo(base, 0, 9).map((o) => o.optionId)).toEqual([
      "opt_blue",
      "opt_green",
      "opt_red",
    ]);
    expect(moveOptionTo(base, 2, -9).map((o) => o.optionId)).toEqual([
      "opt_green",
      "opt_red",
      "opt_blue",
    ]);
  });
});

describe("gridRows", () => {
  it("draws the committed options when nothing is pending", () => {
    const state: OptionGridState = { options: addOption(seeded(), "Blue"), pending: undefined };
    expect(gridRows(state).map((row) => row.optionId)).toEqual(["opt_red", "opt_blue"]);
    expect(gridRows(state).every((row) => !row.isPending)).toBe(true);
  });

  it("splices the pending row in at its position, with no id", () => {
    const state: OptionGridState = {
      options: addOption(seeded(), "Blue"),
      pending: { index: 1, label: "Gre" },
    };
    const rows = gridRows(state);
    expect(rows.map((row) => row.optionId)).toEqual(["opt_red", undefined, "opt_blue"]);
    expect(rows[1]).toEqual({
      optionId: undefined,
      label: "Gre",
      index: 1,
      isPending: true,
      key: "qcms-pending-option-row",
    });
  });

  it("keys committed rows by their option id, so a reorder relocates DOM instead of rebuilding it", () => {
    const state: OptionGridState = { options: addOption(seeded(), "Blue"), pending: undefined };
    expect(gridRows(state).map((row) => row.key)).toEqual(["opt_red", "opt_blue"]);
  });
});

describe("committedIndexOf", () => {
  it("names the index a named row will land at", () => {
    const state: OptionGridState = {
      options: addOption(seeded(), "Blue"),
      pending: { index: 1, label: "Green" },
    };
    expect(committedIndexOf(state)).toBe(1);
  });

  it("is undefined when nothing will land", () => {
    expect(committedIndexOf({ options: seeded(), pending: undefined })).toBeUndefined();
  });
});

describe("optionRowMenuItems", () => {
  const ORDER: readonly OptionRowAction[] = [
    "insertAbove",
    "insertBelow",
    "moveUp",
    "moveDown",
    "remove",
  ];

  function disabledIn(index: number, total: number): Map<OptionRowAction, boolean> {
    const items = optionRowMenuItems({ name: "Crimson", index, total });
    return new Map(items.map((item) => [item.action, item.isDisabled]));
  }

  it("offers insert above, insert below, move up, move down and remove, in the order the POCs draw", () => {
    const items = optionRowMenuItems({ name: "Crimson", index: 1, total: 3 });
    expect(items.map((item) => item.action)).toEqual(ORDER);
  });

  it("names the row in every label, so two rows' menus stay distinguishable", () => {
    for (const item of optionRowMenuItems({ name: "Crimson", index: 1, total: 3 })) {
      expect(item.label).toContain("Crimson");
    }
  });

  it("leaves both moves live on a middle row", () => {
    const middle = disabledIn(1, 3);
    expect(middle.get("moveUp")).toBe(false);
    expect(middle.get("moveDown")).toBe(false);
    expect(middle.get("remove")).toBe(false);
  });

  it("disables only the move that would run off the end of the list", () => {
    const top = disabledIn(0, 3);
    expect(top.get("moveUp")).toBe(true);
    expect(top.get("moveDown")).toBe(false);
    expect(top.get("remove")).toBe(false);

    const bottom = disabledIn(2, 3);
    expect(bottom.get("moveUp")).toBe(false);
    expect(bottom.get("moveDown")).toBe(true);
  });

  it("disables both moves and remove on a single-option grid", () => {
    const only = disabledIn(0, 1);
    expect(only.get("moveUp")).toBe(true);
    expect(only.get("moveDown")).toBe(true);

    expect(only.get("remove")).toBe(true);

    expect(only.get("insertAbove")).toBe(false);
    expect(only.get("insertBelow")).toBe(false);
  });

  it("marks only remove as destructive", () => {
    const items = optionRowMenuItems({ name: "Crimson", index: 1, total: 3 });
    expect(items.filter((item) => item.isDanger).map((item) => item.action)).toEqual(["remove"]);
  });
});
