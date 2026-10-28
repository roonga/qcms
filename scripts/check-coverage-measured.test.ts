import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * Vitest has no option that fails an empty coverage report: a `coverage.include` that
 * matches no file prints `0/0` and exits 0 against a 95 percent threshold, so the
 * failure has to be asserted here.
 */

const SCRIPT = fileURLToPath(new URL("check-coverage-measured.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const directories: string[] = [];

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function kernelSources(): string[] {
  return trackedFilesUnder(join(REPO_ROOT, "packages", "core", "src"), {
    match: /^(?!.*\.test\.ts$).*\.ts$/,
  }).map((relative) => join(REPO_ROOT, "packages", "core", "src", relative));
}

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
