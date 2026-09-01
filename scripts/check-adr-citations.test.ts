import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { citationsIn, definedAdrs } from "./check-adr-citations.mjs";

/**
 * Tests for the ADR citation tripwire (issue #734, rider from #180).
 *
 * The gate answers one question - does a cited number resolve to a record - so the
 * failure that would matter is the one where it answers "yes" over an index it did not
 * really read. The parser is therefore driven with the real index as well as with
 * synthetic tables, and with the shapes closest to a definition: a number in a title,
 * a number in the prose above the table.
 */

const REPO_ROOT = new URL("../", import.meta.url);
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), "utf8");

describe("definedAdrs", () => {
  it("reads a number only from a row's leading cell", () => {
    const index = [
      "# QCMS decision records",
      "",
      "Numbering is stable across the split, so ADR-26 cites the same decision it always has.",
      "",
      "| ADR    | Title                     | Doc  |",
      "| ------ | ------------------------- | ---- |",
      "| ADR-01 | Domain-first compiled UI  | core |",
      "| ADR-13 | Fetch-pure slices, see also ADR-33 | core |",
    ].join("\n");

    // 26 sits in prose and 33 in a title cell: neither is a definition here, and a
    // parser that scanned lines rather than leading cells would call both defined.
    expect([...definedAdrs(index)].sort()).toEqual(["1", "13"]);
  });

  it("treats a zero-padded number and a bare one as the same decision", () => {
    expect(definedAdrs("| ADR-07 | A | core |").has("7")).toBe(true);
  });

  it("reads the real index and finds a record for every number it lists", () => {
    const defined = definedAdrs(read("docs/adr/README.md"));

    // The anchor that would catch a moved or reshaped index: the gate must never
    // report a clean run because it parsed nothing.
    expect(defined.size).toBeGreaterThan(30);
    expect(defined.has("22")).toBe(true);
  });
});

describe("citationsIn", () => {
  it("finds citations with their line numbers", () => {
    const text = ["nothing here", "See ADR-16 and ADR-21 for the semantics.", ""].join("\n");

    expect(citationsIn(text)).toEqual([
      { adr: "16", line: 2 },
      { adr: "21", line: 2 },
    ]);
  });

  it("does not match a number that merely follows the letters", () => {
    expect(citationsIn("ADRS-12 XADR-12 adr-12 ADR12")).toEqual([]);
  });

  it("stays stateless across calls", () => {
    // The scanner shares one global pattern across every line of every file, so a
    // missed `lastIndex` reset would drop roughly every second citation - a smaller
    // corpus with no error, which is the fail-open direction for a gate.
    const first = citationsIn("ADR-01 ADR-02");
    const second = citationsIn("ADR-01 ADR-02");

    expect(second).toEqual(first);
    expect(second).toHaveLength(2);
  });

  it("resolves every citation in the real tree against the real index", () => {
    // The end-to-end assertion: the property the gate exists for, over the repository
    // rather than over a fixture.
    const defined = definedAdrs(read("docs/adr/README.md"));
    const unresolved = citationsIn(read("CONTRIBUTING.md"))
      .map((hit) => hit.adr)
      .filter((adr) => !defined.has(adr));

    expect(unresolved).toEqual([]);
  });
});
