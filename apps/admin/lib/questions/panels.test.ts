import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUESTION_PANEL,
  firstPanelWithIssue,
  panelAnchorId,
  panelFromParams,
  panelIssueCounts,
  questionPanels,
  renderedQuestionFields,
} from "./panels.ts";
import type { DefinitionIssue, QuestionDefinitionView, QuestionType } from "./types.ts";

/**
 * Which panels the question editor has, as a decision rather than as pixels (Code Owner,
 * 2026-09-27).
 *
 * The rail's rows and the editor's sections are two renders of what this module returns, in two
 * React trees, so what is worth pinning here is everything that would otherwise be pinned twice
 * in a browser: which panels a type has, what each one says about itself, which panel an issue
 * belongs to, and which panel a refusal opens.
 *
 * ## The property this file exists for
 *
 * **A panel's existence is derived, never listed.** `hasOptions`, `CONSTRAINT_FIELDS` and
 * `authoredMessageKeys` are the three functions the editor rendered from before the panels
 * existed, and the first `describe` below walks all seven types against them rather than
 * asserting a table this module could have got wrong in the same way. A type that gains a
 * constraint gains a Constraints panel with no edit here, and a type that loses its last
 * constraint loses the panel - which is the whole reason the rail cannot offer a row the
 * editor has nothing to open.
 */

/** A definition of one type, with whatever else a case needs on it. */
function definition(
  type: QuestionType,
  extra: Partial<QuestionDefinitionView> = {},
): QuestionDefinitionView {
  return {
    questionId: "q_example",
    type,
    label: { en: "Example" },
    ...extra,
  };
}

function issue(path: readonly string[], code = "INVALID"): DefinitionIssue {
  return { code, message: `${code} at ${path.join(".")}`, path };
}

/** The ids a definition's panels come out as, in order. */
function ids(view: QuestionDefinitionView): readonly string[] {
  return questionPanels(view).map((panel) => panel.id);
}

describe("which panels a question has", () => {
  it("gives every type a Content panel and nothing else it has no fields for", () => {
    expect(ids(definition("boolean"))).toStrictEqual(["content", "booleanLabels"]);
    expect(ids(definition("shortText"))).toStrictEqual(["content", "constraints"]);
    expect(ids(definition("longText"))).toStrictEqual(["content", "constraints"]);
  });

  it("adds Options for exactly the two types that carry an option list", () => {
    const withOptions = (type: QuestionType) =>
      ids(definition(type, { options: [{ optionId: "opt_a", label: { en: "A" } }] })).includes(
        "options",
      );
    expect(withOptions("singleChoice")).toBe(true);
    expect(withOptions("multiChoice")).toBe(true);
    expect(withOptions("shortText")).toBe(false);
    expect(withOptions("number")).toBe(false);
  });

  it("adds Constraints for exactly the types that own a constraint field", () => {
    // `boolean` and `singleChoice` own none in the kernel schema, so a row that opened an
    // empty panel is a row that should not be in the rail.
    expect(ids(definition("boolean"))).not.toContain("constraints");
    expect(ids(definition("singleChoice", { options: [] }))).not.toContain("constraints");
    expect(ids(definition("number"))).toContain("constraints");
    expect(ids(definition("date"))).toContain("constraints");
    expect(ids(definition("multiChoice", { options: [] }))).toContain("constraints");
  });

  it("adds Validation messages only once the question carries a key to write one for", () => {
    expect(ids(definition("shortText"))).not.toContain("messages");
    // `required` is the one key every type can carry, and it is not a constraint.
    expect(ids(definition("shortText", { required: true }))).toContain("messages");
    // And a constraint that carries a value brings its own.
    expect(ids(definition("number", { constraints: { min: 0 } }))).toContain("messages");
  });

  it("keeps them in one order whatever the type, so the rail's rows never reshuffle", () => {
    expect(
      ids(
        definition("multiChoice", {
          required: true,
          options: [{ optionId: "opt_a", label: { en: "A" } }],
          constraints: { minSelected: 1 },
        }),
      ),
    ).toStrictEqual(["content", "options", "constraints", "messages"]);
  });
});

describe("what a panel row says about itself", () => {
  it("names each panel with the legend its own section carries", () => {
    const panels = questionPanels(
      definition("singleChoice", { options: [{ optionId: "opt_a", label: { en: "A" } }] }),
    );
    // Not a second set of names: a rail must not give a place a second name
    // (`apps/admin/app/(shell)/AGENTS.md`).
    expect(panels.map((panel) => panel.label)).toStrictEqual(["Content", "Options"]);
  });

  it("digests Content as whether an answer is required", () => {
    expect(questionPanels(definition("shortText"))[0]?.digest).toBe("Optional");
    expect(questionPanels(definition("shortText", { required: true }))[0]?.digest).toBe("Required");
  });

  it("digests Options as a count, in the singular where it applies", () => {
    const count = (n: number) =>
      questionPanels(
        definition("singleChoice", {
          options: Array.from({ length: n }, (_unused, index) => ({
            optionId: `opt_${String(index)}`,
            label: { en: `Option ${String(index)}` },
          })),
        }),
      ).find((panel) => panel.id === "options")?.digest;
    expect(count(9)).toBe("9 options");
    expect(count(1)).toBe("1 option");
    expect(count(0)).toBe("0 options");
  });

  it("digests the constraints that carry a value, and says so when none does", () => {
    const digest = (type: QuestionType, constraints: Record<string, unknown>) =>
      questionPanels(definition(type, { constraints })).find((panel) => panel.id === "constraints")
        ?.digest;
    expect(digest("number", { min: 0, max: 200 })).toBe("min 0, max 200");
    expect(digest("number", {})).toBe("None set");
    // An unticked boolean constraint is not a constraint, which is how the kernel reads it too.
    expect(digest("number", { integer: false })).toBe("None set");
    expect(digest("number", { integer: true })).toBe("whole numbers");
    // The pattern's own text is not in the digest: it is a regular expression, and a rail row
    // is not where anyone reads one.
    expect(digest("shortText", { pattern: "^[a-z]+$" })).toBe("pattern");
    expect(digest("shortText", { minLength: 2, maxLength: 40 })).toBe("min 2, max 40");
  });

  it("digests a date bound as a range, with the day rendered rather than the wire string", () => {
    expect(
      questionPanels(definition("date", { constraints: { min: "2030-01-01" } })).find(
        (panel) => panel.id === "constraints",
      )?.digest,
      // ADR-27 through `lib/i18n/format`, pinned to UTC for the reason issue #582 records.
    ).toBe("from Jan 1, 2030");
  });

  it("digests Validation messages as a count of the keys the question can hold", () => {
    expect(
      questionPanels(definition("number", { required: true, constraints: { min: 0 } })).find(
        (panel) => panel.id === "messages",
      )?.digest,
    ).toBe("2 messages");
  });

  it("digests the boolean labels as the pair a respondent would actually read", () => {
    const digest = (extra: Partial<QuestionDefinitionView>) =>
      questionPanels(definition("boolean", extra)).find((panel) => panel.id === "booleanLabels")
        ?.digest;
    // The shipped lexicon where nothing overrides it, and each label independently (ADR-36).
    expect(digest({})).toBe("Yes / No");
    expect(digest({ yesLabel: { en: "Agree" } })).toBe("Agree / No");
  });
});

describe("the preview panel", () => {
  it("is absent unless the caller says there is a saved version to show", () => {
    // `/questions/new` has no rail to reach a panel from and nothing stored for the API to
    // compile, so a Preview row there would open a panel with nothing in it.
    expect(ids(definition("shortText"))).not.toContain("preview");
    expect(
      questionPanels(definition("shortText"), { withPreview: true }).map((panel) => panel.id),
    ).toContain("preview");
  });

  it("is last, after everything the author can edit", () => {
    const panels = questionPanels(
      definition("boolean", { required: true, yesLabel: { en: "Agree" } }),
      { withPreview: true },
    );
    expect(panels.map((one) => one.id)).toStrictEqual([
      "content",
      "messages",
      "booleanLabels",
      "preview",
    ]);
  });

  it("carries no fields, so a refusal can never open it", () => {
    const panels = questionPanels(definition("shortText", { required: true }), {
      withPreview: true,
    });
    const preview = panels.find((one) => one.id === "preview");
    expect(preview?.fields).toStrictEqual([]);
    expect(renderedQuestionFields(panels).has("preview")).toBe(false);
    // Even an issue at a path nothing renders leaves it alone: it has nothing to count.
    const counts = panelIssueCounts(panels, [issue(["label"]), issue(["nowhere"])]);
    expect(counts.has("preview")).toBe(false);
    expect(firstPanelWithIssue(panels, counts)).toBe("content");
  });
});

describe("the fields each panel is able to show", () => {
  it("puts every rendered field in exactly one panel", () => {
    const panels = questionPanels(
      definition("multiChoice", {
        required: true,
        options: [
          { optionId: "opt_a", label: { en: "A" } },
          { optionId: "opt_b", label: { en: "B" } },
        ],
        constraints: { minSelected: 1, maxSelected: 2 },
      }),
    );
    const all = panels.flatMap((panel) => panel.fields);
    expect(new Set(all).size, "no field is claimed by two panels").toBe(all.length);
    expect(renderedQuestionFields(panels)).toStrictEqual(new Set(all));
  });

  it("is the set the error summary tests an issue against, option rows included", () => {
    const fields = renderedQuestionFields(
      questionPanels(
        definition("singleChoice", {
          options: [
            { optionId: "opt_a", label: { en: "A" } },
            { optionId: "opt_b", label: { en: "B" } },
          ],
        }),
      ),
    );
    expect(fields.has("label")).toBe(true);
    expect(fields.has("options.1.label")).toBe(true);
    expect(fields.has("options.2.label"), "a row that is not rendered is not claimed").toBe(false);
  });
});

describe("where a refused save sends the author", () => {
  const view = definition("number", { required: true, constraints: { min: 0, max: 10 } });
  const panels = questionPanels(view);

  it("counts an issue against the panel that renders its field", () => {
    const counts = panelIssueCounts(panels, [
      issue(["label"]),
      issue(["constraints", "min"]),
      issue(["constraints", "max"]),
    ]);
    expect(counts.get("content")).toBe(1);
    expect(counts.get("constraints")).toBe(2);
  });

  it("leaves a panel with nothing out of the map rather than at zero", () => {
    // The badge is drawn only above zero, so a rail with no refusal behind it has no all-clear
    // to fabricate - the same rule the builder's per-step counts follow.
    const counts = panelIssueCounts(panels, [issue(["label"])]);
    expect(counts.has("constraints")).toBe(false);
    expect([...counts.keys()]).toStrictEqual(["content"]);
  });

  it("ignores an issue no panel can show, which the summary reports instead", () => {
    expect(panelIssueCounts(panels, [issue([]), issue(["somethingNew"])]).size).toBe(0);
  });

  it("opens the first panel with an issue in panel order, not in issue order", () => {
    const counts = panelIssueCounts(panels, [issue(["constraints", "min"]), issue(["label"])]);
    expect(firstPanelWithIssue(panels, counts)).toBe("content");
  });

  it("opens nothing when no panel can show any of it", () => {
    expect(firstPanelWithIssue(panels, panelIssueCounts(panels, [issue([])]))).toBeUndefined();
  });
});

describe("which panel the address opens", () => {
  const panels = questionPanels(definition("number", { constraints: { min: 0 } }));

  it("opens the panel the query names", () => {
    expect(panelFromParams({ panel: "constraints" }, panels)).toBe("constraints");
  });

  it("opens Content when the query names none", () => {
    expect(panelFromParams({}, panels)).toBe(DEFAULT_QUESTION_PANEL);
    expect(DEFAULT_QUESTION_PANEL).toBe("content");
  });

  it("falls back rather than refusing a panel this question does not have", () => {
    // A pasted link stays a working link to the question after a draft's type changed under
    // it, which is the same call `selectVersion` makes one layer up for the same reason.
    expect(panelFromParams({ panel: "options" }, panels)).toBe("content");
    expect(panelFromParams({ panel: "nonsense" }, panels)).toBe("content");
  });

  it("reads the first value of a repeated parameter, as the version selector does", () => {
    expect(panelFromParams({ panel: ["constraints", "content"] }, panels)).toBe("constraints");
  });
});

describe("the id a panel section carries", () => {
  it("mints one prefixed id per panel, which is what a rail row controls", () => {
    expect(panelAnchorId("constraints")).toBe("panel-constraints");
    for (const panel of questionPanels(definition("boolean"))) {
      expect(panel.anchorId).toBe(panelAnchorId(panel.id));
    }
  });
});
