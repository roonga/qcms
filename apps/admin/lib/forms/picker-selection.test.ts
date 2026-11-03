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
    expect(chosenDetail(LIBRARY, [{ questionId: "q_vanished", version: 1 }])).toEqual([]);
  });
});

describe("the table-column type filter (task 077, Q12)", () => {
  it("offers only the allowed types and leaves the rest out entirely", () => {
    const allowed = ["shortText", "number", "date"];
    const rows = pinnableRows(LIBRARY, DRAFT, "", allowed);

    expect(rows.map((row) => rowId(row.questionId, row.version))).toEqual([
      "q_systolic@1",
      "q_systolic@2",
      "q_systolic@3",
      "q_height@1",
    ]);
  });

  it("composes with the search rather than replacing it", () => {
    expect(pinnableRows(LIBRARY, DRAFT, "height", ["number"]).map((row) => row.questionId)).toEqual(
      ["q_height"],
    );
    expect(pinnableRows(LIBRARY, DRAFT, "smoker", ["number"])).toEqual([]);
  });

  it("lists everything when no filter is given, which is every existing caller", () => {
    expect(pinnableRows(LIBRARY, DRAFT, "").map((row) => row.questionId)).toEqual(
      ROWS.map((row) => row.questionId),
    );
  });
});
