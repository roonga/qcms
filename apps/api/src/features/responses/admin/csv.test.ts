/**
 * Pure CSV serialization tests (task 023, exit criterion 2). No DB, no app -
 * these pin the byte-level contract: RFC 4180 quoting, CRLF records, the UTF-8
 * BOM, multiChoice `a;b;c`, and column order (document order). The live golden
 * export (through `app.request`) is asserted in `responses.integration.test.ts`;
 * this file guards the encoding primitives it is built from.
 */

import { describe, expect, it } from "vitest";

import type { FormDefinition } from "@qcms/core";

import {
  CRLF,
  csvDataRow,
  csvField,
  csvHeaderRow,
  questionIdsInDocumentOrder,
  serializeAnswerForCsv,
  UTF8_BOM,
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
  const columns = ["q_full_name", "q_age", "q_subscribed", "q_interests"];

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
