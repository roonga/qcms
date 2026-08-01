import { describe, expect, it } from "vitest";

import {
  CONSTRAINT_FIELDS,
  addOption,
  blankDefinition,
  forWire,
  localized,
  localizedDraft,
  mintOptionId,
  moveOption,
  questionIdFromSlug,
  relabelOption,
  removeOption,
  textOf,
} from "./definition.ts";
import type { ChoiceOptionView } from "./types.ts";

/**
 * Exit criterion 2 lives here, and in the Playwright walk.
 *
 * "Option ids are stable across reorder and relabel" is the one property in this task
 * whose violation is silent and unrecoverable: nothing fails, no error is raised, and
 * every rule and every stored answer that referenced the moved id now means something
 * else (R6). So it is asserted twice, at two levels - here over the pure functions that
 * make it true, and in the browser over the editor that uses them. This layer is the one
 * that can enumerate the awkward cases cheaply: a relabel to an empty string, a move that
 * would fall off either end, a remove from the middle.
 */

const RED = "opt_red";
const BLUE = "opt_blue";

function options(): readonly ChoiceOptionView[] {
  return [
    { optionId: RED, label: { en: "Red" } },
    { optionId: BLUE, label: { en: "Blue" } },
    { optionId: "opt_green", label: { en: "Green" } },
  ];
}

const idsOf = (list: readonly ChoiceOptionView[]): string[] =>
  list.map((option) => option.optionId);

describe("questionIdFromSlug", () => {
  it("prefixes and normalises a slug", () => {
    expect(questionIdFromSlug("at-fault-accident")).toBe("q_at_fault_accident");
    expect(questionIdFromSlug("Claims In 2024")).toBe("q_claims_in_2024");
  });

  it("trims the separators a naive replace would leave at the edges", () => {
    expect(questionIdFromSlug("--driver--")).toBe("q_driver");
  });

  it("reports no id at all rather than an invalid one", () => {
    // `q_` alone fails the kernel's `^q_[a-z0-9_]+$`, so proposing it would be an error
    // the author could not act on. An empty proposal is what the screen renders as
    // "enter a slug to see the ID".
    expect(questionIdFromSlug("!!!")).toBe("");
    expect(questionIdFromSlug("")).toBe("");
  });
});

describe("mintOptionId", () => {
  it("derives a readable id from the label", () => {
    expect(mintOptionId("At fault", [])).toBe("opt_at_fault");
  });

  it("falls back to a generic core when the label has no usable characters", () => {
    expect(mintOptionId("", [])).toBe("opt_option");
  });

  it("counts from 2 when the derived id is taken", () => {
    expect(mintOptionId("Other", ["opt_other"])).toBe("opt_other_2");
    expect(mintOptionId("Other", ["opt_other", "opt_other_2"])).toBe("opt_other_3");
  });
});

describe("option ids never move (R6, exit criterion 2)", () => {
  it("keeps every id through a relabel", () => {
    const relabelled = relabelOption(options(), 1, "Navy");
    expect(idsOf(relabelled)).toEqual([RED, BLUE, "opt_green"]);
    expect(textOf(relabelled[1]?.label)).toBe("Navy");
  });

  it("keeps every id through a relabel to nothing", () => {
    const relabelled = relabelOption(options(), 0, "   ");
    expect(idsOf(relabelled)).toEqual([RED, BLUE, "opt_green"]);
  });

  it("carries the id with the option when it moves", () => {
    const moved = moveOption(options(), 0, 1);
    expect(idsOf(moved)).toEqual([BLUE, RED, "opt_green"]);
    // The label that travelled with the id is the assertion that matters: a swap that
    // moved labels rather than records would leave `opt_red` labelled "Blue".
    expect(textOf(moved[1]?.label)).toBe("Red");
    expect(moved[0]?.optionId).toBe(BLUE);
    expect(textOf(moved[0]?.label)).toBe("Blue");
  });

  it("survives a round trip to the top and back", () => {
    const there = moveOption(moveOption(options(), 2, -1), 1, -1);
    const back = moveOption(moveOption(there, 0, 1), 1, 1);
    expect(idsOf(back)).toEqual(idsOf(options()));
  });

  it("refuses to move past either end instead of wrapping", () => {
    expect(idsOf(moveOption(options(), 0, -1))).toEqual(idsOf(options()));
    expect(idsOf(moveOption(options(), 2, 1))).toEqual(idsOf(options()));
  });

  it("renumbers nothing when an option is removed", () => {
    expect(idsOf(removeOption(options(), 1))).toEqual([RED, "opt_green"]);
  });

  it("mints an id only when an option is added", () => {
    const added = addOption(options(), "Amber");
    expect(idsOf(added)).toEqual([RED, BLUE, "opt_green", "opt_amber"]);
  });
});

describe("localized", () => {
  it("omits a blank value, because the kernel rejects an empty locale entry", () => {
    expect(localized("  ")).toBeUndefined();
    expect(localized(" Hello ")).toEqual({ en: "Hello" });
  });
});

describe("blankDefinition", () => {
  it("starts a choice question with no options at all", () => {
    // Deliberate, and the alternative was tried: a pre-seeded row would have its id
    // minted from a blank label and then frozen forever (R6), leaving an author who typed
    // "Red" with a permanent `opt_option`. Options are added, and named as they are added.
    expect(blankDefinition("singleChoice", "q_colour").options).toEqual([]);
  });

  it("gives a boolean question no options", () => {
    expect(blankDefinition("boolean", "q_at_fault").options).toBeUndefined();
  });
});

describe("forWire", () => {
  it("drops a constraints object entirely for the types that have none", () => {
    for (const type of ["boolean", "singleChoice"] as const) {
      const wire = forWire(blankDefinition(type, "q_x")) as unknown as Record<string, unknown>;
      expect(Object.hasOwn(wire, "constraints")).toBe(false);
    }
  });

  it("keeps only the constraints the type owns", () => {
    const wire = forWire({
      questionId: "q_age",
      type: "number",
      label: { en: "Age" },
      constraints: { min: 18, pattern: "^a$", maxSelected: 2 },
    }) as unknown as { constraints: Record<string, unknown> };
    expect(wire.constraints).toEqual({ min: 18 });
  });

  it("omits a cleared constraint rather than sending an empty value", () => {
    const wire = forWire({
      questionId: "q_name",
      type: "shortText",
      label: { en: "Name" },
      constraints: { minLength: undefined, pattern: "" },
    }) as unknown as { constraints: Record<string, unknown> };
    expect(wire.constraints).toEqual({});
  });

  it("omits blank help text", () => {
    const wire = forWire({
      questionId: "q_name",
      type: "shortText",
      label: { en: "Name" },
      help: {},
    }) as unknown as Record<string, unknown>;
    expect(Object.hasOwn(wire, "help")).toBe(false);
  });

  it("always sends an option array for the choice types", () => {
    const wire = forWire({
      questionId: "q_colour",
      type: "multiChoice",
      label: { en: "Colour" },
    }) as unknown as { options: unknown[] };
    expect(wire.options).toEqual([]);
  });
});

describe("CONSTRAINT_FIELDS", () => {
  it("covers every type, so a new type cannot be added without deciding this", () => {
    expect(Object.keys(CONSTRAINT_FIELDS).sort()).toEqual(
      ["boolean", "date", "longText", "multiChoice", "number", "shortText", "singleChoice"].sort(),
    );
  });
});

describe("text a author is still typing", () => {
  it("keeps a trailing space so a sentence can be typed normally", () => {
    // The bug this pins: `localized` trims, and in a fully controlled field the trimmed
    // value flows straight back into the input, so the space is gone before the next
    // keystroke. An author could add a space mid-sentence but never at the end.
    expect(localizedDraft("Your policy number ")).toEqual({ en: "Your policy number " });
    expect(localizedDraft(" leading")).toEqual({ en: " leading" });
    expect(localizedDraft("  ")).toEqual({ en: "  " });
  });

  it("still treats a genuinely empty field as absent", () => {
    // The kernel rejects an empty LocalizedText value, so an untouched optional field
    // has to be absent rather than { en: "" }.
    expect(localizedDraft("")).toBeUndefined();
  });

  it("normalizes at the wire boundary instead", () => {
    const wire = forWire({
      questionId: "q_policy",
      type: "shortText",
      label: { en: "  Policy number  " },
      help: { en: "As printed  " },
    } as never) as unknown as { label: unknown; help: unknown };
    expect(wire.label).toEqual({ en: "Policy number" });
    expect(wire.help).toEqual({ en: "As printed" });
  });

  it("drops a whitespace-only optional field at the wire boundary", () => {
    const wire = forWire({
      questionId: "q_policy",
      type: "shortText",
      label: { en: "Policy" },
      help: { en: "   " },
    } as never) as unknown as Record<string, unknown>;
    expect("help" in wire).toBe(false);
  });

  it("trims option labels at the wire boundary without touching their ids", () => {
    const wire = forWire({
      questionId: "q_colour",
      type: "singleChoice",
      label: { en: "Colour" },
      options: [{ optionId: "opt_red", label: { en: "Red  " } }],
    } as never) as unknown as { options: { optionId: string; label: unknown }[] };
    expect(wire.options[0]).toEqual({ optionId: "opt_red", label: { en: "Red" } });
  });
});
