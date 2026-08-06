import { describe, expect, it } from "vitest";

import {
  CONSTRAINT_FIELDS,
  addOption,
  authoredMessageKeys,
  blankDefinition,
  defaultMessageFor,
  forWire,
  localized,
  localizedDraft,
  messageLabelFor,
  mintOptionId,
  moveOption,
  questionIdFromSlug,
  relabelOption,
  removeOption,
  textOf,
  withMessage,
} from "./definition.ts";
import { VALIDATION_MESSAGE_KEYS, type ChoiceOptionView } from "./types.ts";

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

/**
 * Author-supplied validation messages and the boolean label overrides (task 048, ADR-32
 * and ADR-36), exit criteria 4 and 5.
 *
 * Two properties carry this feature and both are silent when broken, which is why they are
 * pinned here rather than left to the browser walk:
 *
 * 1. **A blank field inherits.** ADR-32 puts the fallback at the edit level, so "no
 *    override" has to reach the wire as an ABSENT key. A `{ en: "" }` or a `messages: {}`
 *    would each be a stored artefact of an author having looked at the box, and the first
 *    is a kernel validation error on a field nobody filled in.
 * 2. **An orphan never leaves the editor.** The editor renders a message field only for a
 *    constraint the question carries, and `forWire` prunes on the same rule, so clearing
 *    "Shortest answer" or switching a draft's type takes the message with it. If the two
 *    ever disagreed, publish would fail with `ORPHAN_MESSAGE_KEY` pointing at a field the
 *    screen no longer shows.
 */

const SHORT_TEXT = {
  questionId: "q_policy",
  type: "shortText",
  label: { en: "Policy number" },
} as const;

describe("VALIDATION_MESSAGE_KEYS", () => {
  it("restates the kernel's canonical key order exactly", () => {
    // The admin cannot import `ValidationMessageKey` (R2), so this list is a copy, and the
    // order is load-bearing twice over: the editor renders the fields in it and `forWire`
    // serializes in it. A silent reorder here would change the bytes a save sends.
    expect([...VALIDATION_MESSAGE_KEYS]).toEqual([
      "required",
      "minLength",
      "maxLength",
      "pattern",
      "min",
      "max",
      "integer",
      "minSelected",
      "maxSelected",
    ]);
  });
});

describe("authoredMessageKeys", () => {
  it("offers a message only for a constraint the question actually carries", () => {
    // The type COULD have `minLength` and `pattern`; this question does not, so neither
    // can ever produce an error and neither gets a field.
    expect(authoredMessageKeys({ ...SHORT_TEXT, constraints: { maxLength: 20 } })).toEqual([
      "maxLength",
    ]);
  });

  it("adds required only when an answer is actually required", () => {
    expect(authoredMessageKeys({ ...SHORT_TEXT, required: true })).toEqual(["required"]);
    expect(authoredMessageKeys({ ...SHORT_TEXT, required: false })).toEqual([]);
    expect(authoredMessageKeys(SHORT_TEXT)).toEqual([]);
  });

  it("returns the keys in canonical order, not in the order they were set", () => {
    const keys = authoredMessageKeys({
      ...SHORT_TEXT,
      required: true,
      constraints: { pattern: "^A", maxLength: 20, minLength: 4 },
    });
    expect(keys).toEqual(["required", "minLength", "maxLength", "pattern"]);
  });

  it("drops a constraint the author cleared", () => {
    // Both cleared states the editor can produce: a `NumberField` emptied to `undefined`
    // and a `TextField` emptied to `""`. Either has to remove the message field, or the
    // author is left writing a sentence for a rule that no longer exists.
    expect(
      authoredMessageKeys({
        ...SHORT_TEXT,
        constraints: { minLength: undefined, pattern: "", maxLength: 20 },
      }),
    ).toEqual(["maxLength"]);
  });

  it("treats an unticked whole-numbers box as no constraint", () => {
    const base = { questionId: "q_age", type: "number", label: { en: "Age" } } as const;
    expect(authoredMessageKeys({ ...base, constraints: { integer: false } })).toEqual([]);
    expect(authoredMessageKeys({ ...base, constraints: { integer: true } })).toEqual(["integer"]);
  });

  it("ignores a constraint the type does not own", () => {
    // A leftover from a draft that used to be another type: `pattern` on a number question
    // is exactly the shape that would become an ORPHAN_MESSAGE_KEY at publish.
    const keys = authoredMessageKeys({
      questionId: "q_age",
      type: "number",
      label: { en: "Age" },
      constraints: { min: 18, pattern: "^a$", maxSelected: 2 },
    });
    expect(keys).toEqual(["min"]);
  });

  it("gives the two constraint-free types nothing but required", () => {
    for (const type of ["boolean", "singleChoice"] as const) {
      expect(authoredMessageKeys(blankDefinition(type, "q_x"))).toEqual([]);
      expect(authoredMessageKeys({ ...blankDefinition(type, "q_x"), required: true })).toEqual([
        "required",
      ]);
    }
  });
});

describe("defaultMessageFor (the editor's placeholder)", () => {
  /*
   * These assertions are the drift alarm for a duplication the R2 boundary forces: the
   * strings live in `lib/i18n/en.ts` as a mirror of `packages/core/src/validate-answer.ts`
   * and `apps/portal/lib/i18n/en.ts`, because the admin may not import either. If the
   * shipped wording changes and the mirror does not, the editor promises a default that no
   * respondent will ever see, which is worse than no placeholder at all - so the exact
   * sentences are pinned here rather than the shape of them.
   */
  it("interpolates the question's own bound into a length default", () => {
    expect(defaultMessageFor("minLength", { ...SHORT_TEXT, constraints: { minLength: 4 } })).toBe(
      "Answer must be at least 4 characters",
    );
    expect(defaultMessageFor("maxLength", { ...SHORT_TEXT, constraints: { maxLength: 20 } })).toBe(
      "Answer must be at most 20 characters",
    );
  });

  it("interpolates a numeric bound", () => {
    const number = { questionId: "q_age", type: "number", label: { en: "Age" } } as const;
    expect(defaultMessageFor("min", { ...number, constraints: { min: 18 } })).toBe(
      "Answer must be at least 18",
    );
    expect(defaultMessageFor("max", { ...number, constraints: { max: 99 } })).toBe(
      "Answer must be at most 99",
    );
  });

  it("interpolates a date bound as the canonical date the kernel prints", () => {
    // The kernel formats both bounds with `String(bound)`, so a date's default carries the
    // stored `YYYY-MM-DD` rather than a locale rendering of it.
    const date = { questionId: "q_incident", type: "date", label: { en: "Incident" } } as const;
    expect(defaultMessageFor("min", { ...date, constraints: { min: "2030-01-01" } })).toBe(
      "Answer must be at least 2030-01-01",
    );
  });

  it("interpolates the selection counts", () => {
    const multi = { questionId: "q_extras", type: "multiChoice", label: { en: "Extras" } } as const;
    expect(defaultMessageFor("minSelected", { ...multi, constraints: { minSelected: 1 } })).toBe(
      "Select at least 1 option(s)",
    );
    expect(defaultMessageFor("maxSelected", { ...multi, constraints: { maxSelected: 3 } })).toBe(
      "Select at most 3 option(s)",
    );
  });

  it("has nothing to interpolate for the three bound-free keys", () => {
    expect(defaultMessageFor("required", { ...SHORT_TEXT, required: true })).toBe(
      "This question needs an answer.",
    );
    expect(defaultMessageFor("pattern", { ...SHORT_TEXT, constraints: { pattern: "^A" } })).toBe(
      "Answer does not match the required format",
    );
    expect(
      defaultMessageFor("integer", {
        questionId: "q_age",
        type: "number",
        label: { en: "Age" },
        constraints: { integer: true },
      }),
    ).toBe("Answer must be a whole number");
  });

  it("leaves the token visible rather than printing undefined when a bound is missing", () => {
    // Unreachable from the editor (no constraint, no field), and this is what it would do:
    // show the template rather than "at least undefined characters".
    expect(defaultMessageFor("minLength", SHORT_TEXT)).toBe(
      "Answer must be at least {n} characters",
    );
  });
});

describe("messageLabelFor", () => {
  it("words a date's bounds as dates rather than as sizes", () => {
    const date = { questionId: "q_incident", type: "date", label: { en: "Incident" } } as const;
    expect(messageLabelFor("min", date)).toBe("Message when the date is too early");
    expect(messageLabelFor("max", date)).toBe("Message when the date is too late");
  });

  it("keeps the numeric wording for the same two keys on a number question", () => {
    const number = { questionId: "q_age", type: "number", label: { en: "Age" } } as const;
    expect(messageLabelFor("min", number)).toBe("Message when the value is too small");
    expect(messageLabelFor("max", number)).toBe("Message when the value is too large");
  });
});

describe("withMessage", () => {
  it("stores what the author is typing without trimming it", () => {
    // Same reason as `localizedDraft`: a trim here makes a trailing space unwritable in a
    // controlled field. The trim happens once, at `forWire`.
    expect(withMessage({}, "minLength", "Too short ")).toEqual({
      minLength: { en: "Too short " },
    });
  });

  it("removes the key when the field is emptied, so the default is inherited again", () => {
    expect(withMessage({ minLength: { en: "Too short" } }, "minLength", "")).toEqual({});
  });

  it("leaves every other message alone", () => {
    const next = withMessage(
      { required: { en: "We need this" }, maxLength: { en: "Too long" } },
      "minLength",
      "Too short",
    );
    expect(next).toEqual({
      required: { en: "We need this" },
      minLength: { en: "Too short" },
      maxLength: { en: "Too long" },
    });
  });

  it("keeps the map in canonical order however the boxes were filled", () => {
    let messages = withMessage({}, "pattern", "Wrong shape");
    messages = withMessage(messages, "required", "We need this");
    messages = withMessage(messages, "maxLength", "Too long");
    expect(Object.keys(messages)).toEqual(["required", "maxLength", "pattern"]);
  });
});

describe("forWire: messages", () => {
  it("sends nothing at all when no message was authored", () => {
    const wire = forWire({
      ...SHORT_TEXT,
      required: true,
      constraints: { minLength: 4 },
    }) as unknown as Record<string, unknown>;
    expect(Object.hasOwn(wire, "messages")).toBe(false);
  });

  it("omits a blank field so the absent key means inherit", () => {
    const wire = forWire({
      ...SHORT_TEXT,
      constraints: { minLength: 4, maxLength: 20 },
      // Both blank shapes the editor can hold: a whitespace-only draft and an empty map.
      messages: { minLength: { en: "   " }, maxLength: {} },
    }) as unknown as Record<string, unknown>;
    expect(Object.hasOwn(wire, "messages")).toBe(false);
  });

  it("sends an authored override, trimmed, in canonical key order", () => {
    const wire = forWire({
      ...SHORT_TEXT,
      required: true,
      constraints: { minLength: 4, pattern: "^A" },
      messages: {
        pattern: { en: "Policy numbers start with A." },
        required: { en: "  We need your policy number.  " },
        minLength: { en: "That is too short to be a policy number." },
      },
    }) as unknown as { messages: Record<string, unknown> };
    expect(Object.keys(wire.messages)).toEqual(["required", "minLength", "pattern"]);
    expect(wire.messages["required"]).toEqual({ en: "We need your policy number." });
  });

  it("drops the message for a constraint the author cleared", () => {
    const wire = forWire({
      ...SHORT_TEXT,
      constraints: { minLength: undefined, maxLength: 20 },
      messages: { minLength: { en: "Too short" }, maxLength: { en: "Too long" } },
    }) as unknown as { messages: Record<string, unknown> };
    expect(wire.messages).toEqual({ maxLength: { en: "Too long" } });
  });

  it("drops the message for required once required is unticked", () => {
    const wire = forWire({
      ...SHORT_TEXT,
      required: false,
      messages: { required: { en: "We need this" } },
    }) as unknown as Record<string, unknown>;
    expect(Object.hasOwn(wire, "messages")).toBe(false);
  });

  it("drops a message orphaned by a change of type", () => {
    // A draft authored as short text and then switched to number: `pattern` is not a
    // constraint a number question carries, so its message would be an ORPHAN_MESSAGE_KEY.
    const wire = forWire({
      questionId: "q_age",
      type: "number",
      label: { en: "Age" },
      constraints: { min: 18 },
      messages: { pattern: { en: "Wrong shape" }, min: { en: "Drivers must be 18 or over." } },
    }) as unknown as { messages: Record<string, unknown> };
    expect(wire.messages).toEqual({ min: { en: "Drivers must be 18 or over." } });
  });

  it("carries a message on a type with no constraints at all", () => {
    // `boolean` has no constraint panel, but every type can be required, so `required` is
    // the one message key it can hold.
    const wire = forWire({
      questionId: "q_at_fault",
      type: "boolean",
      label: { en: "At fault?" },
      required: true,
      messages: { required: { en: "Tell us whether you were at fault." } },
    }) as unknown as { messages: Record<string, unknown> };
    expect(wire.messages).toEqual({ required: { en: "Tell us whether you were at fault." } });
  });
});

describe("forWire: boolean labels (ADR-36)", () => {
  const BOOLEAN = {
    questionId: "q_at_fault",
    type: "boolean",
    label: { en: "At fault?" },
  } as const;

  it("sends each label only when it was overridden, independently of the other", () => {
    const wire = forWire({ ...BOOLEAN, yesLabel: { en: "I was at fault" } }) as unknown as Record<
      string,
      unknown
    >;
    expect(wire["yesLabel"]).toEqual({ en: "I was at fault" });
    // The other label stays absent, which is what makes it fall back to the compiler's
    // lexicon on its own rather than being dragged along by its partner.
    expect(Object.hasOwn(wire, "noLabel")).toBe(false);
  });

  it("omits a blank label and trims a real one", () => {
    const wire = forWire({
      ...BOOLEAN,
      yesLabel: { en: "  Yes, I was  " },
      noLabel: { en: "   " },
    }) as unknown as Record<string, unknown>;
    expect(wire["yesLabel"]).toEqual({ en: "Yes, I was" });
    expect(Object.hasOwn(wire, "noLabel")).toBe(false);
  });

  it("drops both labels for every other type, like options and constraints", () => {
    for (const type of ["shortText", "singleChoice", "number"] as const) {
      const wire = forWire({
        questionId: "q_x",
        type,
        label: { en: "X" },
        yesLabel: { en: "Affirmative" },
        noLabel: { en: "Negative" },
      }) as unknown as Record<string, unknown>;
      expect(Object.hasOwn(wire, "yesLabel"), `${type} should not carry yesLabel`).toBe(false);
      expect(Object.hasOwn(wire, "noLabel"), `${type} should not carry noLabel`).toBe(false);
    }
  });
});
