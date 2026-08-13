/**
 * The shared CSV field contract (issue #470).
 *
 * Two policies over the same two protections, so the tests are written as one
 * table run against both: whatever differs between the exports, the guard does
 * not. Fixture text is deliberately obvious (`FIXTURE_PAYLOAD`) rather than a
 * working spreadsheet payload, and no cell content is logged (SEC-8).
 */

import { describe, expect, it } from "vitest";

import { csvField, csvFieldAlwaysQuoted } from "./index.js";

/** Every character a spreadsheet may read as the start of a formula. */
const DANGEROUS_LEADS = ["=", "+", "-", "@", "\t", "\r"] as const;

/** The cell text as a spreadsheet sees it: the emitted field, unquoted if quoted. */
function cellText(emitted: string): string {
  if (!emitted.startsWith('"')) return emitted;
  return emitted.slice(1, -1).replaceAll('""', '"');
}

const POLICIES = [
  { name: "csvField (quote when required)", field: csvField },
  { name: "csvFieldAlwaysQuoted (quote always)", field: csvFieldAlwaysQuoted },
] as const;

for (const { name, field } of POLICIES) {
  describe(`${name}: the formula-injection guard`, () => {
    for (const lead of DANGEROUS_LEADS) {
      it(`neutralises a value starting ${JSON.stringify(lead)}`, () => {
        const cell = cellText(field(`${lead}FIXTURE_PAYLOAD`));
        expect(cell).toBe(`'${lead}FIXTURE_PAYLOAD`);
        expect(cell.startsWith(lead)).toBe(false);
      });
    }

    it("guards a value whose lead is dangerous and whose body needs quoting", () => {
      expect(cellText(field('=FIXTURE,"one"'))).toBe('\'=FIXTURE,"one"');
    });

    // The positive control: a guard that mangled everything would pass the
    // negatives above, so ordinary text must arrive unchanged.
    it("leaves an ordinary value's text exactly as given", () => {
      for (const ordinary of ["no thank you", "2 + 2 is 4", "opt_a;opt_b", "a-b", "x@y", ""]) {
        expect(cellText(field(ordinary))).toBe(ordinary);
      }
    });

    it("doubles an embedded quote rather than ending the field early", () => {
      expect(field('she said "hi"')).toBe('"she said ""hi"""');
    });
  });
}

describe("the two quoting policies stay different", () => {
  it("csvField emits a field that needs no quoting bare", () => {
    expect(csvField("Ada")).toBe("Ada");
    expect(csvField("opt_a;opt_b")).toBe("opt_a;opt_b");
    expect(csvField("")).toBe("");
  });

  it("csvField quotes only what RFC 4180 obliges", () => {
    expect(csvField("Lovelace, Ada")).toBe('"Lovelace, Ada"');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("a\r\nb")).toBe('"a\r\nb"');
  });

  it("csvFieldAlwaysQuoted quotes a field that needs nothing", () => {
    expect(csvFieldAlwaysQuoted("Ada")).toBe('"Ada"');
    expect(csvFieldAlwaysQuoted("")).toBe('""');
  });

  it("guarding never changes the quoting decision", () => {
    // The apostrophe the guard adds is not a character that obliges quoting, so
    // a guarded field is bare exactly when the same field would have been.
    expect(csvField("=FIXTURE_PAYLOAD")).toBe("'=FIXTURE_PAYLOAD");
    expect(csvField("=FIXTURE,PAYLOAD")).toBe("\"'=FIXTURE,PAYLOAD\"");
  });
});
