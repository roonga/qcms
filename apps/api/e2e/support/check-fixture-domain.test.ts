import { describe, expect, it } from "vitest";

// A sibling `scripts/check-fixture-domain.d.mts` types this plain ESM script's exports.
import { DENYLIST, scanFixtureDir, scanText } from "../../../../scripts/check-fixture-domain.mjs";

describe("fixture-domain guard (task 045)", () => {
  it("catches a denylisted term (guard is not a no-op)", () => {
    const hits = scanText("example.json", "The patient reported diabetes and asthma.");
    expect(hits.map((h) => h.term).sort()).toEqual(["asthma", "diabetes"]);
  });

  it("catches every denylist term, case-insensitively", () => {
    for (const term of DENYLIST) {
      expect(scanText("x", `PREFIX ${term.toUpperCase()} SUFFIX`).length).toBeGreaterThan(0);
    }
  });

  it("passes clean (vehicle-domain) content", () => {
    expect(scanText("clean.json", "Which optional cover? Breakdown, Windscreen, Legal.")).toEqual(
      [],
    );
  });

  it("the vehicle example-form fixtures contain no denylisted terms", () => {
    const hits = scanFixtureDir();
    expect(hits, JSON.stringify(hits)).toEqual([]);
  });
});
