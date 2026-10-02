/**
 * Pure CSV serialization tests (task 023, exit criterion 2). No DB, no app -
 * these pin the byte-level contract: RFC 4180 quoting, CRLF records, the UTF-8
 * BOM, multiChoice `a;b;c`, and column order (document order). The live golden
 * export (through `app.request`) is asserted in `responses.integration.test.ts`;
 * this file guards the encoding primitives it is built from.
 */

import { describe, expect, it } from "vitest";

import type { FormDefinition } from "@roonga/qcms-core";

import {
  CRLF,
  csvDataRow,
  csvField,
  csvHeaderRow,
  groupDataRows,
  groupFileColumns,
  groupFileName,
  groupHeaderRow,
  groupInstances,
  indexedColumnHeader,
  isExportShape,
  questionColumn,
  questionIdsInDocumentOrder,
  responseColumns,
  serializeAnswerForCsv,
  UTF8_BOM,
  wideSlotCount,
} from "./csv.js";

describe("csvField (RFC 4180 quoting)", () => {
  it("leaves a plain field unquoted", () => {
    expect(csvField("Ada")).toBe("Ada");
  });
  it("quotes and doubles embedded quotes", () => {
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""');
  });
  it("quotes a field containing a comma", () => {
    expect(csvField("Lovelace, Ada")).toBe('"Lovelace, Ada"');
  });
  it("quotes a field containing CR or LF", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("a\r\nb")).toBe('"a\r\nb"');
  });
  it("does not quote a field containing only a semicolon", () => {
    expect(csvField("opt_a;opt_b")).toBe("opt_a;opt_b");
  });
});

describe("csvField (spreadsheet formula-injection guard, issue #470)", () => {
  // Every cell of this export is respondent-controlled free text and the file is
  // opened in a spreadsheet by the form author. Several spreadsheet programs
  // evaluate a cell whose first character is one of these, so the cell is made
  // inert with a leading apostrophe before any quoting decision. Fixture text is
  // deliberately obvious rather than a working payload (SEC-8).
  const DANGEROUS_LEADS = ["=", "+", "-", "@", "\t", "\r"] as const;

  for (const lead of DANGEROUS_LEADS) {
    it(`neutralises a cell starting ${JSON.stringify(lead)}`, () => {
      const emitted = csvField(`${lead}FIXTURE_PAYLOAD`);
      // The emitted cell no longer begins with the dangerous character: the
      // apostrophe does, inside the quotes when the cell is quoted at all.
      const cell = emitted.startsWith('"') ? emitted.slice(1) : emitted;
      expect(cell.startsWith("'")).toBe(true);
      expect(cell.startsWith(lead)).toBe(false);
    });
  }

  it("guards without losing the RFC 4180 quoting a cell also needs", () => {
    expect(csvField('=FIXTURE,"one"')).toBe('"\'=FIXTURE,""one"""');
  });

  // The positive control: the guard must not pass by mangling everything.
  it("leaves an ordinary answer byte-identical", () => {
    expect(csvField("no thank you")).toBe("no thank you");
    expect(csvField("2 + 2 is 4")).toBe("2 + 2 is 4");
    expect(csvField("opt_a;opt_b")).toBe("opt_a;opt_b");
    expect(csvField("")).toBe("");
  });

  it("adds quoting and nothing else to a cell that needs only quoting", () => {
    expect(csvField("Lovelace, Ada")).toBe('"Lovelace, Ada"');
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("exempts a plain number, so a negative answer is not exported as text", () => {
    // Issue #476: the guard would otherwise turn every negative numeric answer
    // into `'-5`, which reaches the author as text rather than a number.
    expect(csvField("-5")).toBe("-5");
    expect(csvField("-5.25")).toBe("-5.25");
    // The boundary: a value that only opens numeric-looking is still a formula.
    expect(csvField("-1+1")).toBe("'-1+1");
  });

  it("carries a negative number through a data row unprefixed (issue #476)", () => {
    const row = csvDataRow(
      {
        sessionId: "ses_number",
        formVersion: 1,
        submittedAt: new Date("2026-03-15T09:00:00.000Z"),
        accessMode: "anonymous",
        answers: { q_balance: -5, q_note: "-1+1" },
      },
      ["q_balance", "q_note"].map(questionColumn),
    );
    expect(row.endsWith(",-5,'-1+1" + CRLF)).toBe(true);
  });

  it("guards an answer on the way into a data row, not only in isolation", () => {
    const row = csvDataRow(
      {
        sessionId: "ses_guard",
        formVersion: 1,
        submittedAt: new Date("2026-03-15T09:00:00.000Z"),
        accessMode: "anonymous",
        answers: { q_note: "=FIXTURE_PAYLOAD" },
      },
      [questionColumn("q_note")],
    );
    expect(row.endsWith(",'=FIXTURE_PAYLOAD" + CRLF)).toBe(true);
  });
});

describe("serializeAnswerForCsv (canonical encodings)", () => {
  it("passes text through", () => {
    expect(serializeAnswerForCsv("hello")).toBe("hello");
  });
  it("stringifies numbers and booleans", () => {
    expect(serializeAnswerForCsv(42)).toBe("42");
    expect(serializeAnswerForCsv(true)).toBe("true");
    expect(serializeAnswerForCsv(false)).toBe("false");
  });
  it("joins multiChoice with ';'", () => {
    expect(serializeAnswerForCsv(["opt_a", "opt_b", "opt_c"])).toBe("opt_a;opt_b;opt_c");
  });
  it("renders a missing answer as an empty cell", () => {
    expect(serializeAnswerForCsv(undefined)).toBe("");
    expect(serializeAnswerForCsv(null)).toBe("");
  });
});

describe("questionIdsInDocumentOrder", () => {
  it("walks steps then items in order", () => {
    const def = {
      steps: [
        { items: [{ questionId: "q_b" }, { questionId: "q_a" }] },
        { items: [{ questionId: "q_c" }] },
      ],
    } as unknown as FormDefinition;
    expect(questionIdsInDocumentOrder(def)).toEqual(["q_b", "q_a", "q_c"]);
  });
});

describe("byte-for-byte golden rows", () => {
  const columns = ["q_full_name", "q_age", "q_subscribed", "q_interests"].map(questionColumn);

  it("emits a header with metadata columns then question columns, CRLF-terminated", () => {
    expect(csvHeaderRow(columns)).toBe(
      "session_id,form_version,submitted_at,access_mode," +
        "q_full_name,q_age,q_subscribed,q_interests" +
        CRLF,
    );
  });

  it("emits a data row with canonical values, quoting only where required", () => {
    const row = {
      sessionId: "ses_abc",
      formVersion: 3,
      submittedAt: new Date("2026-01-02T03:04:05.000Z"),
      accessMode: "anonymous",
      answers: {
        q_full_name: "Lovelace, Ada",
        q_age: 41,
        q_subscribed: true,
        q_interests: ["opt_math", "opt_engines"],
      },
    };
    expect(csvDataRow(row, columns)).toBe(
      "ses_abc,3,2026-01-02T03:04:05.000Z,anonymous," +
        '"Lovelace, Ada",41,true,opt_math;opt_engines' +
        CRLF,
    );
  });

  it("leaves an unanswered question an empty cell", () => {
    const row = {
      sessionId: "ses_x",
      formVersion: 1,
      submittedAt: new Date("2026-01-01T00:00:00.000Z"),
      accessMode: "secure_link",
      answers: { q_full_name: "Grace" },
    };
    expect(csvDataRow(row, columns)).toBe(
      "ses_x,1,2026-01-01T00:00:00.000Z,secure_link,Grace,,," + CRLF,
    );
  });

  it("prefixes a full document with the UTF-8 BOM exactly once", () => {
    const doc = UTF8_BOM + csvHeaderRow(columns);
    // The BOM is U+FEFF; its UTF-8 encoding is EF BB BF.
    const bytes = new TextEncoder().encode(doc);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(doc.indexOf(UTF8_BOM)).toBe(0);
    expect(doc.lastIndexOf(UTF8_BOM)).toBe(0);
  });
});

// --- repeating groups: the two shapes (task 075, Q17) ------------------------

/**
 * A two-step definition with one repeating group in the middle, enough for the
 * column walk: `q_booking_ref`, then `grp_passengers(q_name, q_meal)`, then
 * `q_notes`. Cast rather than parsed, as the walk tests above are - these helpers
 * read `steps`, `items`, `groupId` and `count` and nothing else.
 */
function repeatDefinition(max: number | undefined): FormDefinition {
  return {
    steps: [
      { items: [{ questionId: "q_booking_ref" }] },
      {
        items: [
          {
            groupId: "grp_passengers",
            items: [{ questionId: "q_name" }, { questionId: "q_meal" }],
            count: max === undefined ? { source: "open", min: 0 } : { source: "open", min: 0, max },
          },
          { questionId: "q_notes" },
        ],
      },
    ],
  } as unknown as FormDefinition;
}

/** A reporting row for that definition, with two live instances. */
const repeatRow = {
  sessionId: "ses_zip",
  formVersion: 2,
  submittedAt: new Date("2026-05-01T00:00:00.000Z"),
  accessMode: "anonymous",
  answers: {
    q_booking_ref: "ABC123",
    q_notes: "none",
    grp_passengers: [
      { instance_id: "ins_p1", q_name: "Ada", q_meal: ["opt_vegan"] },
      { instance_id: "ins_p2", q_name: "Lovelace, Grace", q_meal: ["opt_halal", "opt_kosher"] },
    ],
  },
};

describe("isExportShape", () => {
  it("accepts the two ruled shapes and nothing else", () => {
    expect(isExportShape("long")).toBe(true);
    expect(isExportShape("wide")).toBe(true);
    expect(isExportShape("tall")).toBe(false);
    expect(isExportShape("")).toBe(false);
  });
});

describe("responseColumns (the flat file's columns)", () => {
  it("leaves a group's members out of the long shape", () => {
    expect(responseColumns(repeatDefinition(3), "long").map((c) => c.header)).toEqual([
      "q_booking_ref",
      "q_notes",
    ]);
  });

  it("folds a group's members in as indexed columns in the wide shape", () => {
    expect(responseColumns(repeatDefinition(3), "wide").map((c) => c.header)).toEqual([
      "q_booking_ref",
      "q_name__1",
      "q_name__2",
      "q_name__3",
      "q_meal__1",
      "q_meal__2",
      "q_meal__3",
      "q_notes",
    ]);
  });

  it("produces the same columns in either shape for a form with no group", () => {
    // The identity the byte-identical claim rests on: with no group to fold in or
    // leave out, the two shapes are the same projection the export always emitted.
    const def = {
      steps: [{ items: [{ questionId: "q_a" }, { questionId: "q_b" }] }],
    } as unknown as FormDefinition;
    expect(responseColumns(def, "wide")).toEqual(responseColumns(def, "long"));
    expect(responseColumns(def).map((c) => c.header)).toEqual(["q_a", "q_b"]);
  });

  it("widens the header when a later version raises max (the documented consequence)", () => {
    // Q17's cost, as a test rather than a warning: same form, same group, one
    // field changed, and a consumer's column set moves under it. This is why the
    // route requires a version and why a consumer automating a wide export pins
    // the version it bound to.
    const narrow = responseColumns(repeatDefinition(2), "wide").map((c) => c.header);
    const wider = responseColumns(repeatDefinition(4), "wide").map((c) => c.header);
    expect(narrow).toEqual([
      "q_booking_ref",
      "q_name__1",
      "q_name__2",
      "q_meal__1",
      "q_meal__2",
      "q_notes",
    ]);
    expect(wider).toHaveLength(narrow.length + 4);
    expect(wider).toContain("q_name__4");
    expect(narrow).not.toContain("q_name__3");
  });

  it("refuses a wide export of a group with no max rather than emitting a short header", () => {
    // Publish refuses REPEAT_MAX_MISSING, so this is unreachable for a published
    // version; the point is that the fallback is a refusal and not a silently
    // truncated header that would drop a respondent's trailing instances.
    expect(() => responseColumns(repeatDefinition(undefined), "wide")).toThrow(/declares no max/);
    // The long shape needs no max at all, because it has no indexed columns.
    expect(() => responseColumns(repeatDefinition(undefined), "long")).not.toThrow();
  });

  it("reads a fixed count as its own bound", () => {
    const group = {
      groupId: "grp_x",
      items: [{ questionId: "q_y" }],
      count: { source: "fixed", count: 2 },
    };
    expect(wideSlotCount(group as never)).toBe(2);
  });
});

describe("the wide shape's cells", () => {
  const columns = responseColumns(repeatDefinition(3), "wide");

  it("fills each instance's slot and leaves the slots beyond the live count empty", () => {
    expect(csvDataRow(repeatRow, columns)).toBe(
      "ses_zip,2,2026-05-01T00:00:00.000Z,anonymous," +
        "ABC123," +
        'Ada,"Lovelace, Grace",,' +
        "opt_vegan,opt_halal;opt_kosher,," +
        "none" +
        CRLF,
    );
  });

  it("applies the formula-injection guard inside an indexed cell (issue #470)", () => {
    const row = {
      ...repeatRow,
      answers: { grp_passengers: [{ instance_id: "ins_a", q_name: "=FIXTURE_PAYLOAD" }] },
    };
    expect(csvDataRow(row, columns)).toContain(",'=FIXTURE_PAYLOAD,");
  });

  it("leaves every slot empty when the group key is absent", () => {
    const row = { ...repeatRow, answers: { q_booking_ref: "X" } };
    expect(csvDataRow(row, columns)).toBe(
      "ses_zip,2,2026-05-01T00:00:00.000Z,anonymous,X,,,,,,," + CRLF,
    );
  });
});

describe("the long shape's group files", () => {
  it("names one file per group, with its member questions in document order", () => {
    expect(groupFileColumns(repeatDefinition(3))).toEqual([
      { groupId: "grp_passengers", questionIds: ["q_name", "q_meal"] },
    ]);
    expect(groupFileName("grp_passengers")).toBe("grp_passengers.csv");
  });

  it("has no group file for a form with no group, which is what keeps it one file", () => {
    const def = { steps: [{ items: [{ questionId: "q_a" }] }] } as unknown as FormDefinition;
    expect(groupFileColumns(def)).toEqual([]);
  });

  it("emits session_id, instance_ordinal, instance_id then the member questions", () => {
    const file = groupFileColumns(repeatDefinition(3))[0]!;
    expect(groupHeaderRow(file)).toBe(
      "session_id,instance_ordinal,instance_id,q_name,q_meal" + CRLF,
    );
    expect(groupDataRows(repeatRow, file)).toBe(
      "ses_zip,1,ins_p1,Ada,opt_vegan" +
        CRLF +
        'ses_zip,2,ins_p2,"Lovelace, Grace",opt_halal;opt_kosher' +
        CRLF,
    );
  });

  it("contributes no row for a response with no instance of the group", () => {
    const file = groupFileColumns(repeatDefinition(3))[0]!;
    expect(groupDataRows({ ...repeatRow, answers: { q_booking_ref: "X" } }, file)).toBe("");
  });

  it("applies the formula-injection guard in a group file too (issue #470)", () => {
    const file = groupFileColumns(repeatDefinition(3))[0]!;
    const row = {
      ...repeatRow,
      answers: { grp_passengers: [{ instance_id: "ins_a", q_name: "@FIXTURE_PAYLOAD" }] },
    };
    expect(groupDataRows(row, file)).toBe("ses_zip,1,ins_a,'@FIXTURE_PAYLOAD," + CRLF);
  });
});

describe("groupInstances", () => {
  it("reads the group's ordered array", () => {
    expect(groupInstances(repeatRow.answers, "grp_passengers")).toHaveLength(2);
  });

  it("is no instances for an absent key, a scalar, or a multiChoice array", () => {
    // Never throws mid-stream on a row it does not recognise: the value comes out
    // of JSONB and an export has already sent its headers.
    expect(groupInstances({}, "grp_x")).toEqual([]);
    expect(groupInstances({ grp_x: "nope" }, "grp_x")).toEqual([]);
    expect(groupInstances({ grp_x: ["opt_a", "opt_b"] }, "grp_x")).toEqual([]);
  });
});

describe("indexedColumnHeader", () => {
  it("is the questionId, two underscores, and the 1-based slot", () => {
    expect(indexedColumnHeader("q_passport", 1)).toBe("q_passport__1");
    expect(indexedColumnHeader("q_passport", 500)).toBe("q_passport__500");
  });
});
