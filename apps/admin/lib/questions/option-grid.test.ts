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
  setPendingLabel,
  type OptionGridState,
} from "./option-grid.ts";

import type { ChoiceOptionView } from "./types.ts";

/**
 * The deferred-minting invariant, asserted rather than merely implemented (task 057).
 *
 * The Code Owner ruled that an option id is minted when a row first acquires content, not
 * when the ghost add-row is rendered. That is a decision an optimiser would happily undo:
 * minting at open time is one line shorter, needs no pending-row concept, and every test
 * of "add an option and check its id" still passes afterwards. What it silently costs is
 * permanent, because an `optionId` can never be corrected (R6): every option authored
 * through the grid would mint from an empty label and become `opt_option`, `opt_option_2`,
 * `opt_option_3`, and the rule builder - which shows raw option ids as its picker labels,
 * with no label lookup anywhere - would offer an author a list of indistinguishable
 * entries.
 *
 * So the first `describe` below is a guard, not coverage. It was proven red before it was
 * accepted: with `openPendingRow` changed to append through `addOption` at open time, all
 * three of its cases fail. Anyone tempted to make that change again meets them.
 */

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

    // Opening the ghost add-row is an editing state, not a mutation. The document is
    // identical - no row, and therefore no id, has come into existence.
    const ghost = openPendingRow(before, before.options.length);
    expect(ghost.options).toEqual(before.options);
    expect(ghost.pending).toEqual({ index: 1, label: "" });

    // Tabbing past it and abandoning it leaves the document identical too, which is the
    // observable form of "the abandoned row consumed nothing".
    expect(abandonPendingRow(ghost).options).toEqual(before.options);

    // And the option the author does go on to name earns its own id, unsuffixed. Under
    // eager minting the abandoned row would already be sitting in the list as
    // `opt_option`, and this row would be the second entry rather than the second option.
    const named = commitPendingRow(setPendingLabel(ghost, "Blue"));
    expect(idsOf(named)).toEqual(["opt_red", "opt_blue"]);
    expect(named.pending).toBeUndefined();
  });

  it("consumes no option id for an INSERT-BETWEEN row that is opened and abandoned", () => {
    // Insert is the path this task adds, and the easy place to mint eagerly: the code that
    // knows the insert position already has a list it could call `addOption` on. Same
    // three assertions as the ghost row, one row further up the list.
    const start: OptionGridState = { options: addOption(seeded(), "Blue"), pending: undefined };

    const inserted = openPendingRow(start, 1);
    expect(inserted.options).toEqual(start.options);
    expect(inserted.pending).toEqual({ index: 1, label: "" });
    expect(abandonPendingRow(inserted).options).toEqual(start.options);

    // The `_2` suffix is what makes this sharp. If the abandoned row had taken `opt_green`
    // at open time and then been dropped, or were still present, this would not be a clean
    // `opt_green` landing in the middle of the list.
    const named = commitPendingRow(setPendingLabel(inserted, "Green"));
    expect(idsOf(named)).toEqual(["opt_red", "opt_green", "opt_blue"]);
    expect(labelsOf(named)).toEqual(["Red", "Green", "Blue"]);
  });

  it("mints from the label the row was named with, never from the empty row it started as", () => {
    // The other face of the same guard: an id minted at open time is minted from `""`, and
    // `mintOptionId` falls back to `opt_option` for that. Naming the option "Option" is the
    // case that proves the id came from the author's text and not from the fallback: under
    // eager minting the empty row would already hold `opt_option`, so this would land as
    // `opt_option_2`.
    const state: OptionGridState = { options: [], pending: undefined };
    const named = commitPendingRow(setPendingLabel(openPendingRow(state, 0), "Option"));
    expect(idsOf(named)).toEqual(["opt_option"]);
  });

  it("abandons a row whose label is only whitespace instead of minting from it", () => {
    // "Acquires content" is content, not keystrokes. A row holding two spaces would mint
    // `opt_option` (the identifier core of whitespace is empty), which is exactly the
    // meaningless permanent id the ruling exists to prevent.
    const start: OptionGridState = { options: seeded(), pending: undefined };
    const committed = commitPendingRow(setPendingLabel(openPendingRow(start, 1), "   "));
    expect(committed.options).toEqual(start.options);
    expect(committed.pending).toBeUndefined();
    expect(committedIndexOf(setPendingLabel(openPendingRow(start, 1), "   "))).toBeUndefined();
  });

  it("has no shape that could carry an id on a pending row", () => {
    // Structural, in the same spirit as "no input is bound to an optionId": a pending row
    // cannot hold an id because there is nowhere to put one. A `PendingRow` that grew an
    // `optionId` field would fail here as well as at the type level.
    const ghost = openPendingRow({ options: seeded(), pending: undefined }, 1);
    expect(Object.keys(ghost.pending ?? {}).sort()).toEqual(["index", "label"]);
  });
});

describe("openPendingRow", () => {
  it("commits an in-flight named row before opening the next one", () => {
    // Clicking a second insert point while a row is half-named must not throw the typed
    // label away: it acquired content, so it is an option.
    const start: OptionGridState = { options: seeded(), pending: undefined };
    const first = setPendingLabel(openPendingRow(start, 1), "Blue");
    const second = openPendingRow(first, 2);
    expect(idsOf(second)).toEqual(["opt_red", "opt_blue"]);
    expect(second.pending).toEqual({ index: 2, label: "" });
  });

  it("shifts the new row past a commit that landed ahead of it", () => {
    // The in-flight row was at index 0 and the new one was asked for at index 1. Once the
    // first commits it occupies index 0, so "after Red" is now index 2, not 1.
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
    // Same reason `localizedDraft` exists: a trim here makes a trailing space unwritable.
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
