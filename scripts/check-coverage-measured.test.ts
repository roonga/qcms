import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * The guard that stops a kernel coverage run from reporting a green over nothing
 * (PR #970 review).
 *
 * The regression it was written for: the `vitest` 4 to 5 major changed
 * `coverage.include` to match each file's path relative to its project root, the root
 * config's repo-relative `packages/core/src/**` then matched no file at all, and
 * `pnpm --filter @roonga/qcms-core coverage` printed `Lines: Unknown% ( 0/0 )` and
 * exited 0 against `thresholds.lines: 95`. Vitest has no option that fails an empty
 * report, so the failure has to be asserted somewhere, and this is where.
 *
 * The cases below drive the guard with written-out summary reports rather than by
 * running Vitest, because what is being tested is the verdict, not the coverage
 * provider. The last case is the wiring: a guard the documented command no longer calls
 * is not a guard, and nothing else in the repository would notice its removal.
 */

const SCRIPT = fileURLToPath(new URL("check-coverage-measured.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const directories: string[] = [];

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** The kernel's source files as the guard derives them: from git, not from a list here. */
function kernelSources(): string[] {
  return trackedFilesUnder(join(REPO_ROOT, "packages", "core", "src"), {
    match: /^(?!.*\.test\.ts$).*\.ts$/,
  }).map((relative) => join(REPO_ROOT, "packages", "core", "src", relative));
}

/** A json-summary report naming `files`, with one measured line each. */
function summaryFor(files: string[]): string {
  const entry = { lines: { total: 1, covered: 1, skipped: 0, pct: 100 } };
  const report: Record<string, unknown> = {
    total: { lines: { total: files.length, covered: files.length, skipped: 0, pct: 100 } },
  };
  for (const file of files) report[file] = entry;
  return JSON.stringify(report);
}

function runGuard(summary: string | undefined) {
  const directory = mkdtempSync(join(tmpdir(), "qcms-coverage-measured-"));
  directories.push(directory);
  const path = join(directory, "coverage-summary.json");
  if (summary !== undefined) writeFileSync(path, summary, "utf8");
  const result = spawnSync(process.execPath, [SCRIPT, path], { encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("check-coverage-measured", () => {
  it("passes when every kernel source file was measured", () => {
    const sources = kernelSources();
    expect(sources.length).toBeGreaterThan(0);

    const { code, out } = runGuard(summaryFor(sources));

    expect(out).toContain(`all ${sources.length} kernel source files present`);
    expect(code).toBe(0);
  });

  it("fails the empty report the Vitest 5 glob change produced", () => {
    const { code, out } = runGuard(
      JSON.stringify({ total: { lines: { total: 0, covered: 0, skipped: 0, pct: 0 } } }),
    );

    expect(code).toBe(1);
    expect(out).toContain("lines measured:       0");
    expect(out).toContain("https://vitest.dev/guide/migration");
  });

  it("fails when the report reaches only part of the kernel, and names what it missed", () => {
    const sources = kernelSources();
    const dropped = sources[sources.length - 1];

    const { code, out } = runGuard(summaryFor(sources.slice(0, -1)));

    expect(code).toBe(1);
    expect(out).toContain("Not measured:");
    expect(out).toContain(dropped.slice(REPO_ROOT.length).split("\\").join("/"));
  });

  it("fails rather than passing when there is no report to read", () => {
    const { code, out } = runGuard(undefined);

    expect(code).toBe(1);
    expect(out).toContain("cannot read the coverage summary");
  });

  it("is still chained into the command task 009 names", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "core", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts.coverage).toContain("--coverage");
    expect(manifest.scripts.coverage).toContain("scripts/check-coverage-measured.mjs");
  });
});
