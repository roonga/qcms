import { TABLE_COLUMN_TYPES } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_COLUMN_TYPES,
  columnTypeNote,
  isAllowedColumnType,
  tableColumnRows,
} from "./table-columns.ts";
import type { DraftPin, PinnableQuestion } from "./types.ts";

function question(questionId: string, type: PinnableQuestion["type"]): PinnableQuestion {
  return {
    questionId,
    slug: questionId.replace("q_", ""),
    label: { en: `The ${questionId}` },
    type,

    versions: [
      {
        version: 1,
        status: "published",
        definition: { questionId, type: type ?? "shortText", label: { en: questionId } },
      },
    ],
  };
}

const LIBRARY: readonly PinnableQuestion[] = [
  question("q_plate", "shortText"),
  question("q_odometer", "number"),
  question("q_notes", "longText"),
  question("q_extras", "multiChoice"),
];

const pin = (questionId: string): DraftPin => ({ questionId, version: 1 });

describe("the allowed column types (Q12)", () => {
  it("agrees with the kernel's own list, which is what makes the restatement safe", () => {
    expect([...ALLOWED_COLUMN_TYPES]).toEqual([...TABLE_COLUMN_TYPES]);
    expect([...ALLOWED_COLUMN_TYPES]).toEqual([
      "shortText",
      "number",
      "date",
      "boolean",
      "singleChoice",
    ]);
  });

  it("admits the five and refuses the two, and refuses an unknown type", () => {
    for (const type of ALLOWED_COLUMN_TYPES) {
      expect(isAllowedColumnType(type as PinnableQuestion["type"]), type).toBe(true);
    }
    expect(isAllowedColumnType("longText")).toBe(false);
    expect(isAllowedColumnType("multiChoice")).toBe(false);

    expect(isAllowedColumnType(null)).toBe(false);
  });
});

describe("the column view's rows", () => {
  it("is the member list in document order, one column each", () => {
    const rows = tableColumnRows([pin("q_odometer"), pin("q_plate")], LIBRARY);
    expect(rows.map((row) => [row.ordinal, row.questionId])).toEqual([
      [1, "q_odometer"],
      [2, "q_plate"],
    ]);

    expect(rows.map((row) => row.label)).toEqual(["The q_odometer", "The q_plate"]);
  });

  it("SHOWS the type rather than offering one, localized", () => {
    const [row] = tableColumnRows([pin("q_odometer")], LIBRARY);
    expect(row?.type).toBe("Number");
  });

  it("lists a refused column rather than hiding it, and marks it", () => {
    const rows = tableColumnRows([pin("q_plate"), pin("q_notes"), pin("q_extras")], LIBRARY);
    expect(rows.map((row) => row.allowed)).toEqual([true, false, false]);
    expect(rows.map((row) => row.questionId)).toEqual(["q_plate", "q_notes", "q_extras"]);
  });

  it("lists a member the library does not carry rather than coming up short", () => {
    const rows = tableColumnRows([pin("q_gone")], LIBRARY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.allowed).toBe(false);
    expect(rows[0]?.label).toBe("Label not known");
    expect(rows[0]?.type).toBe("Unknown");
  });

  it("has no rows for a group with no members", () => {
    expect(tableColumnRows([], LIBRARY)).toEqual([]);
  });
});

describe("the sentence the refusal says", () => {
  it("names every allowed type and the stacked presentation as the way out", () => {
    const note = columnTypeNote();
    for (const label of ["Short text", "Number", "Date", "Yes or no", "Single choice"]) {
      expect(note).toContain(label);
    }

    expect(note).toContain("stacked");
    expect(note).not.toContain("{types}");
  });
});
