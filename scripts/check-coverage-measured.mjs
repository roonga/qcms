#!/usr/bin/env node
// @ts-check
/**
 * The kernel coverage run measured the kernel (PR #970 review).
 *
 * `pnpm --filter @roonga/qcms-core coverage` is task 009's exit criterion 4, and the
 * number it prints is only worth reading if the run actually looked at the kernel's
 * source. Vitest 5 made that stop being obvious. `coverage.include` is now matched
 * against each file's path relative to its PROJECT root ("coverage.include and
 * coverage.exclude now match precisely", https://vitest.dev/guide/migration), so the
 * repo-relative `packages/core/src/**` the root config carried under Vitest 4 matched
 * nothing at all. The run then reported
 *
 *     All files | 0 | 0 | 0 | 0
 *     Lines     : Unknown% ( 0/0 )
 *
 * and exited 0, because `thresholds.lines: 95` is satisfied by a report with no lines
 * in it. A gate that passes on an empty measurement is worse than no gate: it is a
 * green that says the opposite of what a reader takes from it.
 *
 * Vitest has no "fail when the report is empty" option, so this is the guard. It is
 * chained after the Vitest run in `packages/core`'s `coverage` script, which keeps the
 * documented command spelling intact while making the zero-file case a red.
 *
 * Two assertions, both fail-closed:
 *
 *   1. The report measured at least one line. This is the exact regression above.
 *   2. Every kernel source file git knows about appears in the report. This is the
 *      wider property, and it is what catches a pattern that half-matches: an
 *      `include` narrowed to one directory, or a new source directory that the
 *      pattern does not reach, would still print a confident percentage. The expected
 *      set is derived from git rather than listed here (CONTRIBUTING.md, issues #635
 *      and #641), so a file added to the kernel is covered by this guard the moment it
 *      is written.
 *
 * Usage:  node scripts/check-coverage-measured.mjs [path/to/coverage-summary.json]
 *
 * The default path is `coverage/coverage-summary.json` under the repo root, resolved
 * from this file rather than from the working directory - `vitest.config.ts` pins
 * `coverage.reportsDirectory` to the same place for the same reason, so this can never
 * read a report some other invocation left somewhere else. The argument exists for
 * `scripts/check-coverage-measured.test.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Must agree with `coverage.reportsDirectory` in `vitest.config.ts`. */
const DEFAULT_SUMMARY = path.join(REPO_ROOT, "coverage", "coverage-summary.json");

/** The kernel's source root: what task 009's threshold is a statement about. */
const KERNEL_SRC = path.join(REPO_ROOT, "packages", "core", "src");

/**
 * Kernel files that are source rather than tests.
 *
 * Vitest's default `coverage.exclude` drops test files, so demanding them in the
 * report would fail on a correct run.
 */
const SOURCE_FILE = /^(?!.*\.test\.ts$).*\.ts$/;

/** @param {string} absolute @returns {string} the path as `vitest.config.ts` would print it */
function repoRelative(absolute) {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

function main() {
  const summaryPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SUMMARY;

  /** @type {Record<string, { lines?: { total?: number } }>} */
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch (error) {
    console.error(
      `check-coverage-measured: cannot read the coverage summary at ${repoRelative(summaryPath)}:`,
    );
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error(
      "\nThis guard runs after Vitest and reads the json-summary reporter's output. Run it\n" +
        "through `pnpm --filter @roonga/qcms-core coverage`, which writes that report first.",
    );
    process.exit(1);
    return;
  }

  const measuredLines = summary.total?.lines?.total ?? 0;
  const measured = new Set(
    Object.keys(summary)
      .filter((key) => key !== "total")
      .map((key) => repoRelative(path.resolve(key))),
  );

  const expected = trackedFilesUnder(KERNEL_SRC, { match: SOURCE_FILE }).map(
    (relative) => `packages/core/src/${relative}`,
  );
  const missing = expected.filter((file) => !measured.has(file));

  if (measuredLines === 0 || missing.length > 0) {
    console.error(
      `check-coverage-measured: the coverage report at ${repoRelative(summaryPath)} does not`,
    );
    console.error("measure the kernel, so the threshold it passed means nothing.\n");
    console.error(`  lines measured:       ${measuredLines}`);
    console.error(`  files in the report:  ${measured.size}`);
    console.error(`  kernel source files:  ${expected.length}`);
    if (missing.length > 0) {
      console.error("\nNot measured:");
      for (const file of missing.slice(0, 10)) console.error(`  ${file}`);
      if (missing.length > 10) console.error(`  ... and ${missing.length - 10} more`);
    }
    console.error(
      [
        "",
        "Most likely `coverage.include` in vitest.config.ts no longer reaches these files.",
        "Vitest 5 matches those globs against each file's path relative to its PROJECT root,",
        "so the pattern for the kernel is `src/**`, not `packages/core/src/**`:",
        "https://vitest.dev/guide/migration",
        "",
      ].join("\n"),
    );
    process.exit(1);
    return;
  }

  console.log(
    `check-coverage-measured: OK - ${measuredLines} lines across ${measured.size} files, ` +
      `all ${expected.length} kernel source files present.`,
  );
}

// Run as a script; stay silent when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
