import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "./docker.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";

const SCANNER = "packages/observability/src/otlp-log-allowlist.coverage.test.ts";

const SCANNER_PACKAGE = "packages/observability";

const SCANNER_TASK = "@roonga/qcms-observability#test";

const SOURCE_EXTENSION = /\.(ts|tsx|mts)$/;

function quotedEntries(source: string, pattern: RegExp, label: string): string[] {
  const match = pattern.exec(source);
  if (match?.[1] === undefined) {
    throw new Error(
      `could not read ${label} out of ${SCANNER}. This file derives what that scan ` +
        "reads from those constants, so a rename here is a silent loss of coverage: " +
        "update the pattern rather than deleting the assertion",
    );
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1] ?? "");
}

/**
 * Parsed textually rather than imported: importing another project's `.test.ts` would
 * register its suites into this one and run the scan twice.
 */
function scannerReach(): { roots: readonly string[]; dirs: readonly string[] } {
  const source = readFileSync(join(REPOSITORY_ROOT, SCANNER), "utf8");
  return {
    roots: quotedEntries(source, /const SOURCE_ROOTS = \[([^\]]*)\]/, "SOURCE_ROOTS"),
    dirs: quotedEntries(source, /const SOURCE_DIRS = new Set\(\[([^\]]*)\]/, "SOURCE_DIRS"),
  };
}

function filesWithinReach(): string[] {
  const { roots, dirs } = scannerReach();
  return trackedFilesUnder(REPOSITORY_ROOT, { match: SOURCE_EXTENSION }).filter((path) => {
    const parts = path.split("/");
    return parts.length > 3 && roots.includes(parts[0] ?? "") && dirs.includes(parts[2] ?? "");
  });
}

function hashedInputs(taskId: string, packageDirectory: string): Set<string> {
  const output = execFileSync(
    "pnpm",
    ["exec", "turbo", "run", "test", `--filter=${taskId.split("#")[0] ?? ""}`, "--dry=json"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(output) as {
    tasks: { taskId: string; inputs: Record<string, string> }[];
  };
  const task = parsed.tasks.find((entry) => entry.taskId === taskId);
  if (task === undefined) throw new Error(`turbo reported no ${taskId}`);
  // turbo reports inputs relative to the package, so a root-relative glob arrives with
  // leading `../` segments.
  return new Set(
    Object.keys(task.inputs).map((path) =>
      join(packageDirectory, path)
        .replaceAll("\\", "/")
        .replace(/^(\.\.\/)+/, ""),
    ),
  );
}

describe("the derivation reads both sides from the tree", () => {
  it("reads the walk's reach out of the walk", () => {
    const { roots, dirs } = scannerReach();
    expect(roots).toContain("apps");
    expect(roots).toContain("packages");
    expect(dirs).toContain("src");
  });

  it("collects a corpus that reaches outside the scanning package", () => {
    const within = filesWithinReach();
    expect(within.length).toBeGreaterThan(200);
    // Nothing in turbo's dependency graph would hash apps/api for this task: the import
    // arrow runs the other way, so only an explicit input covers it.
    expect(within.some((path) => path.startsWith("apps/api/src/"))).toBe(true);
    expect(within.some((path) => !path.startsWith(`${SCANNER_PACKAGE}/`))).toBe(true);
  });
});

describe("turbo hashes every file the whole-workspace scan reads", () => {
  it("covers the scanned tree in the scanning task's cache key", () => {
    const inputs = hashedInputs(SCANNER_TASK, SCANNER_PACKAGE);
    expect(inputs.size).toBeGreaterThan(0);

    const unhashed = filesWithinReach().filter((path) => !inputs.has(path));

    expect(
      unhashed.slice(0, 20),
      `${SCANNER} reads these files, and ${SCANNER_TASK} does not hash them, so a change` +
        " to one replays a stale green on a warm cache and fails cold in CI (issue #825)." +
        ` Widen the \`inputs\` of ${SCANNER_TASK} in turbo.json to match the walk` +
        ` (${unhashed.length} file(s) uncovered)`,
    ).toEqual([]);
  });
});
