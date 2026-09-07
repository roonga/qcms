import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "./docker.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * A cached task hashes every file it reads, for the one task that reads the whole
 * workspace (issue #825).
 *
 * ## What goes wrong without this
 *
 * `packages/observability/src/otlp-log-allowlist.coverage.test.ts` resolves the
 * repository root from its own module URL and walks every workspace member's `src` and
 * `lib`, so that a new log message literal anywhere is either admitted to the OTLP
 * export vocabulary or written down as deliberately opaque (ADR-34, issue #490).
 *
 * turbo hashed none of that. A task's default inputs are its own package, and its
 * dependency hashes reach only what it imports, which here is the wrong direction:
 * `@roonga/qcms-observability` is imported BY the apps it scans. So a lane adding a log
 * call in `apps/api/src` changed nothing the task hashed, turbo replayed a previous
 * green, and `pnpm verify` passed on a warm cache while CI failed cold on the same
 * commit. Both halves were observed on PR #824.
 *
 * This is issue #560 one level up. There a program-shaped task read `dist` directories
 * its graph did not order, and `scripts/turbo-build-order.test.ts` derives that claim.
 * Here a scanning task reads source files its cache key does not cover, and the
 * consequence is worse in kind: a missing build edge fails loudly and at random, while
 * a missing input passes wrongly and in silence, for exactly the change the gate exists
 * to catch.
 *
 * ## How the claim is derived
 *
 * Both sides come from the tree rather than from a list here, because a list stops
 * covering the tree the moment either side grows.
 *
 * - **What the scan reads** is read out of the scan: {@link scannerReach} parses the
 *   `SOURCE_ROOTS` and `SOURCE_DIRS` constants the walk itself is driven by. Widening
 *   the walk to another directory therefore widens what this file demands, on the same
 *   commit, without anyone remembering to come here.
 * - **What turbo hashes** is asked of turbo, through `--dry=json`, which reports the
 *   resolved input files and their hashes rather than the globs that produced them.
 *   Re-deriving the globs from `turbo.json` would compare one spelling against another
 *   and prove nothing about what turbo actually keyed on.
 *
 * The demanded set is an over-approximation: it holds every tracked TypeScript file
 * under a scanned directory, while the walk skips `e2e`, `__tests__`, `test-support`
 * and test files. That direction is deliberate and is the same one
 * `scripts/turbo-build-order.test.ts` argues for. An over-approximation can only demand
 * that turbo hash a file the scan would have ignored, which fails loudly and names the
 * file. The under-approximation is the dangerous one, because it lets an unhashed file
 * the scan does read through in silence.
 */

/** The scanning test whose reach must be inside its own task's cache key. */
const SCANNER = "packages/observability/src/otlp-log-allowlist.coverage.test.ts";

/** The package that hosts the scan, which is what turbo reports inputs relative to. */
const SCANNER_PACKAGE = "packages/observability";

/** The turbo task that runs it. */
const SCANNER_TASK = "@roonga/qcms-observability#test";

/** What the walk collects, from the same extension test the walk applies. */
const SOURCE_EXTENSION = /\.(ts|tsx|mts)$/;

/** Every double-quoted entry of a bracketed literal, in source order. */
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
 * The directories the coverage scan walks, read from the scan's own constants.
 *
 * Textual rather than imported, because importing a `.test.ts` from another project's
 * test file would register its suites into this one and run the scan twice. The parse
 * is pinned by its own assertion below, and throws rather than returning an empty set
 * when it stops matching.
 */
function scannerReach(): { roots: readonly string[]; dirs: readonly string[] } {
  const source = readFileSync(join(REPOSITORY_ROOT, SCANNER), "utf8");
  return {
    roots: quotedEntries(source, /const SOURCE_ROOTS = \[([^\]]*)\]/, "SOURCE_ROOTS"),
    dirs: quotedEntries(source, /const SOURCE_DIRS = new Set\(\[([^\]]*)\]/, "SOURCE_DIRS"),
  };
}

/** Every tracked source file that lies under a directory the scan walks. */
function filesWithinReach(): string[] {
  const { roots, dirs } = scannerReach();
  return trackedFilesUnder(REPOSITORY_ROOT, { match: SOURCE_EXTENSION }).filter((path) => {
    const parts = path.split("/");
    // `<root>/<member>/<dir>/...`: the walk descends only into a workspace member's
    // named source directories, never into the member's other subtrees.
    return parts.length > 3 && roots.includes(parts[0] ?? "") && dirs.includes(parts[2] ?? "");
  });
}

/** The files turbo hashes for `taskId`, as repository-relative paths. */
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
  // turbo reports inputs relative to the package, so a root-relative glob arrives as
  // `../../apps/api/src/main.ts`. Normalised here rather than matched as written.
  return new Set(
    Object.keys(task.inputs).map((path) =>
      join(packageDirectory, path)
        .replaceAll("\\", "/")
        .replace(/^(\.\.\/)+/, ""),
    ),
  );
}

describe("the derivation reads both sides from the tree", () => {
  // Every assertion in the suite below is vacuous if either side comes back empty, and
  // an empty side is exactly what a rename or a refactor produces. So each is pinned
  // here, where the failure names the cause rather than reporting a clean scan.

  it("reads the walk's reach out of the walk", () => {
    const { roots, dirs } = scannerReach();
    expect(roots).toContain("apps");
    expect(roots).toContain("packages");
    expect(dirs).toContain("src");
  });

  it("collects a corpus that reaches outside the scanning package", () => {
    const within = filesWithinReach();
    expect(within.length).toBeGreaterThan(200);
    // apps/api is the package a new log literal lands in most often, and nothing in
    // turbo's dependency graph would ever hash it for this task: the arrow runs the
    // other way. If this stops being true the demand has quietly shrunk to the
    // package's own files, which is the state issue #825 reports.
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
