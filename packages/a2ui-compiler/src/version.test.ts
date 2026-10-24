import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { A2UI_SPEC_VERSION, COMPILER_VERSION } from "./version.js";

/**
 * Drift guards for the version stamps (ADR-18): they are constants, because the
 * runtime reads neither manifest, so bumping either package without updating
 * its stamp has to fail here.
 */
function readJson(relativeToPackageRoot: string): { version: string } {
  const url = new URL(`../${relativeToPackageRoot}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as { version: string };
}

describe("version stamps", () => {
  it("COMPILER_VERSION mirrors this package's package.json version", () => {
    expect(COMPILER_VERSION).toBe(readJson("package.json").version);
  });

  it("A2UI_SPEC_VERSION mirrors the installed @a2ra/core package version", () => {
    // Resolved through this package's own link, so it reflects what the schema
    // validation in `compile.test.ts` actually ran against.
    expect(A2UI_SPEC_VERSION).toBe(readJson("node_modules/@a2ra/core/package.json").version);
  });
});
