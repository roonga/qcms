#!/usr/bin/env node
// @ts-check
/**
 * A coverage threshold is satisfied by a report with no lines in it, so a misdirected
 * `coverage.include` measures nothing and still exits 0. Vitest offers no option for
 * that, hence this guard: both assertions are fail-closed, and the expected file set
 * comes from git so a half-matching pattern cannot print a confident percentage.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Must agree with `coverage.reportsDirectory` in `vitest.config.ts`. */
const DEFAULT_SUMMARY = path.join(REPO_ROOT, "coverage", "coverage-summary.json");

const KERNEL_SRC = path.join(REPO_ROOT, "packages", "core", "src");

/** Vitest excludes test files, so demanding them would fail on a correct run. */
const SOURCE_FILE = /^(?!.*\.test\.ts$).*\.ts$/;

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
