import { describe, expect, it } from "vitest";

import {
  choose,
  chosenDetail,
  pinnableRows,
  rowId,
  unchoose,
  withChoices,
} from "./picker-selection.ts";
import type { DraftForm, DraftPin, PinnableQuestion, PinnableVersion } from "./types.ts";

/**
 * The add-question dialog's selection rules (issue 660).
 *
 * The dialog itself is a react-aria `Dialog`, so `renderToStaticMarkup` returns the empty
 * string for it (issue 628) and this app has no jsdom layer to press a checkbox in. Every
 * rule that multi-select adds is therefore stated here against the pure functions, and the
 * browser walk that proves the component is wired to them is
 * `apps/admin/e2e/picker-multi-select.pw.ts`.
 */

/**
 * One listed version. The `definition` is required by the type and is irrelevant to every
 * rule under test here: nothing in `picker-selection.ts` reads past `version` and `status`.
 * Building it here rather than repeating it keeps that fact visible.
 */
function version(
  questionId: string,
  at: number,
  status: PinnableVersion["status"],
): PinnableVersion {
  return {
    version: at,
    status,
    definition: { questionId, type: "shortText", label: { en: questionId } },
  };
}

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_systolic",
    slug: "systolic",
    label: { en: "Systolic blood pressure" },
    type: "number",
    versions: [
      version("q_systolic", 1, "deprecated"),
      version("q_systolic", 2, "published"),
      version("q_systolic", 3, "published"),
    ],
  },
  {
    questionId: "q_height",
    slug: "height",
    label: { en: "Height in centimetres" },
    type: "number",
    versions: [version("q_height", 1, "published"), version("q_height", 2, "draft")],
  },
  {
    questionId: "q_smoker",
    slug: "smoker",
    label: { en: "Are you a smoker?" },
    type: "boolean",
    versions: [version("q_smoker", 1, "published")],
  },
];

/** A draft holding one step, with `q_smoker` already pinned into it. */
const DRAFT: DraftForm = {
  formId: "frm_test",
  defaultLocale: "en",
  title: { en: "Test form" },
  steps: [
    {
      stepId: "stp_one",
      title: { en: "Step one" },
      items: [{ questionId: "q_smoker", version: 1 }],
    },
  ],
  rules: [],
};

const ROWS = pinnableRows(LIBRARY, DRAFT, "");

function find(rows: ReturnType<typeof withChoices>, questionId: string, version: number) {
  const row = rows.find((entry) => entry.questionId === questionId && entry.version === version);
  expect(row, `a row for ${rowId(questionId, version)}`).toBeDefined();
  return row;
}

describe("what the picker lists", () => {
  it("lists one row per non-draft version, so the row IS the pin", () => {
    // q_systolic v1/v2/v3, q_height v1 (v2 is a draft), q_smoker v1. Five, not three.
    expect(ROWS.map((row) => rowId(row.questionId, row.version))).toEqual([
      "q_systolic@1",
      "q_systolic@2",
      "q_systolic@3",
      "q_height@1",
      "q_smoker@1",
    ]);
  });

  it("refuses a deprecated version and a question already in the form, with a reason", () => {
    const rows = withChoices(ROWS, []);
    expect(find(rows, "q_systolic", 1)?.choosable).toBe(false);
    expect(find(rows, "q_systolic", 1)?.state).toBe("Deprecated");
    expect(find(rows, "q_smoker", 1)?.choosable).toBe(false);
    expect(find(rows, "q_smoker", 1)?.state).toBe("Already in this form");
  });
});

describe("choosing several versions", () => {
  it("keeps the order they were chosen in, because that is the order they are pinned", () => {
    let chosen: readonly DraftPin[] = [];
    chosen = choose(chosen, { questionId: "q_height", version: 1 });
    chosen = choose(chosen, { questionId: "q_systolic", version: 3 });
    expect(chosen.map((pin) => pin.questionId)).toEqual(["q_height", "q_systolic"]);
  });

  it("withdraws the checkbox from the sibling versions of a chosen question", () => {
    // ONE PIN PER QUESTION. Ticking v3 must not leave v2 tickable, or the author would
    // learn at the commit that only one of the two landed.
    const rows = withChoices(ROWS, [{ questionId: "q_systolic", version: 3 }]);
    expect(find(rows, "q_systolic", 3)?.checked).toBe(true);
    expect(find(rows, "q_systolic", 3)?.state).toBe("Chosen to add");
    expect(find(rows, "q_systolic", 2)?.choosable).toBe(false);
    expect(find(rows, "q_systolic", 2)?.checked).toBe(false);
  });

  it("names the version holding the place, rather than removing the control in silence", () => {
    const rows = withChoices(ROWS, [{ questionId: "q_systolic", version: 3 }]);
    expect(find(rows, "q_systolic", 2)?.state).toBe("Version 3 of this question is chosen");
  });

  it("leaves other questions alone", () => {
    const rows = withChoices(ROWS, [{ questionId: "q_systolic", version: 3 }]);
    expect(find(rows, "q_height", 1)?.choosable).toBe(true);
    expect(find(rows, "q_height", 1)?.checked).toBe(false);
  });

  it("unchooses by question, so the row goes back to being an ordinary candidate", () => {
    const chosen = unchoose([{ questionId: "q_systolic", version: 3 }], "q_systolic");
    expect(chosen).toEqual([]);
    const rows = withChoices(ROWS, chosen);
    expect(find(rows, "q_systolic", 2)?.choosable).toBe(true);
    expect(find(rows, "q_systolic", 2)?.state).toBe("Pinnable");
  });
});

describe("the chosen pane", () => {
  it("keeps a chosen version listed when a search hides its row", () => {
    // This is the pane's whole reason for existing: the table is filtered, the choice is
    // not, and without the pane the author would commit something invisible.
    const chosen: readonly DraftPin[] = [{ questionId: "q_systolic", version: 3 }];
    const filtered = pinnableRows(LIBRARY, DRAFT, "height");
    expect(filtered.some((row) => row.questionId === "q_systolic")).toBe(false);
    expect(chosenDetail(LIBRARY, chosen)).toEqual([
      { questionId: "q_systolic", version: 3, label: "Systolic blood pressure" },
    ]);
  });

  it("names each entry with the label the pin will carry", () => {
    const rows = chosenDetail(LIBRARY, [
      { questionId: "q_height", version: 1 },
      { questionId: "q_systolic", version: 2 },
    ]);
    expect(rows.map((row) => `${rowId(row.questionId, row.version)} ${row.label}`)).toEqual([
      "q_height@1 Height in centimetres",
      "q_systolic@2 Systolic blood pressure",
    ]);
  });

  it("drops a pin whose question has left the library, rather than listing it nameless", () => {
    // The commit is driven off this list, so what falls out here cannot be added either.
    expect(chosenDetail(LIBRARY, [{ questionId: "q_vanished", version: 1 }])).toEqual([]);
  });
});
