#!/usr/bin/env node
// @ts-check
/**
 * Classify a pull request's diff as "plan-only" for the CI fast lane (issue #496
 * rides along; the lane itself is the fix for the ~20-minute burn a prose-only
 * `plan/**` PR used to cost).
 *
 * A PR whose every changed path is under `plan/` cannot break build, typecheck,
 * lint, the unit suites or any of the three end-to-end suites: `plan/` is not a
 * workspace, nothing under `apps/` or `packages/` imports it, and Prettier
 * ignores it (`.prettierignore`). Three gates DO read `plan/**`, so the fast lane
 * still runs them - see `check:plan` in the root package.json for the list and
 * the reasoning.
 *
 * ## The contract this script has to keep
 *
 * `protect-main` requires four check contexts and has no bypass actors. A context
 * that never reports leaves a PR "Expected - waiting for status" forever, which is
 * strictly worse than a slow PR. So this script only ever decides how much work a
 * job does; it never decides whether a job runs. Every required job runs on every
 * event and reports its context either way.
 *
 * Consequently every uncertain case resolves to `false` (run everything):
 *
 *   - any event that is not `pull_request` (a push to main, a `workflow_dispatch`
 *     rescue run): the fast lane is a pull-request optimisation and main's own
 *     history is worth the full suite;
 *   - an empty diff, or a base ref that cannot be resolved;
 *   - anything that throws.
 *
 * Renames are read with `--no-renames`, so a path moved out of `plan/` shows up as
 * a delete under `plan/` PLUS an add outside it, and the PR is correctly code.
 *
 * ## Two properties that are not obvious, and are the reason this file has tests
 *
 * **This script never classifies its own diff.** The workflow does not run the
 * checked-out copy; it runs the copy from the pull request's BASE ref against the
 * head checkout (`git show "origin/$GITHUB_BASE_REF:scripts/ci-plan-only.mjs"`).
 * Otherwise a pull request that refactors `isPlanOnly` and introduces a defect
 * answering `true` too readily would be classified by its own broken code: its diff
 * touches only this file, which is not under `plan/`, so a full run is intended -
 * but the broken copy would answer `plan_only=true`, `pnpm test` is one of the steps
 * the fast lane skips, and the very tests written to catch that defect would not
 * run. It would merge in 45 green seconds and every later PR would take the fast
 * lane. The base copy only ever shells out to `git`, so running it against a head
 * checkout is safe. Consequence to expect: any PR that touches this file gets a full
 * run, which is the point.
 *
 * **Paths are read NUL-separated and never trimmed.** `git diff --name-only` does
 * not quote a path whose only unusual character is a space, so a file committed at
 * `" plan/evil.ts"` (leading space) arrives as ` plan/evil.ts`. Trimming it would
 * make it `plan/evil.ts`, and a `.ts` file would land with build, typecheck, lint,
 * the unit suites, all three e2e suites and `check:lint-coverage` skipped - the last
 * of those being exactly the gate that exists to catch a tracked source file outside
 * every lint scope. `-z` plus a NUL split preserves the byte sequence git recorded,
 * which is what `check-no-em-dash.mjs`, `check-ports.mjs` and
 * `check-no-control-chars.mjs` all already do.
 *
 * Usage:
 *   node scripts/ci-plan-only.mjs                  # reads GITHUB_* from the env
 *   BASE_REF=main node scripts/ci-plan-only.mjs    # local dry run
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { argv, env, stdout } from "node:process";
import { pathToFileURL } from "node:url";

// On Windows, Node's execFile does not resolve `git` -> `git.exe` from PATH
// (unlike a shell), so a bare "git" ENOENTs even when git is installed.
const GIT = process.platform === "win32" ? "git.exe" : "git";

/** The one directory the fast lane covers. Trailing slash: `planning.md` is not it. */
export const PLAN_PREFIX = "plan/";

/** How many changed paths the log prints before it truncates. */
const LOG_LIMIT = 40;

/**
 * Is every changed path inside `plan/`?
 *
 * An empty list is NOT plan-only. An empty diff means the classification failed to
 * see anything, and "saw nothing" must never read as "saw only prose".
 *
 * @param {readonly string[]} files repo-relative paths, as `git diff --name-only` reports them.
 * @returns {boolean}
 */
export function isPlanOnly(files) {
  // SABOTAGED ON PURPOSE (throwaway probe). Stands in for a refactor that
  // introduces a defect answering `true` too readily. If this copy is the one CI
  // runs, the marker below appears in the log and plan_only is true for everything.
  stdout.write("SABOTAGED-CLASSIFIER-RAN: this is the head copy, not the base copy\n");
  return files.length >= 0;
}

/**
 * @param {readonly string[]} args
 * @param {string | undefined} [cwd] repository to run in; the process cwd by default.
 * @returns {string}
 */
function git(args, cwd) {
  return execFileSync(GIT, [...args], { encoding: "utf8", cwd });
}

/**
 * Split `git`'s NUL-separated output into paths.
 *
 * Deliberately no `.trim()` and no `.split("\n")`. A newline-separated read has to
 * trim to survive CRLF, and trimming silently rewrites ` plan/evil.ts` (a real,
 * committable path that git does not quote) into `plan/evil.ts`, which classifies as
 * prose. NUL separation has no such ambiguity: git emits the recorded bytes.
 *
 * Exported so the parse can be tested without a repository. The layer above it is
 * tested against a real one, because this defect lived here and not in
 * {@link isPlanOnly}.
 *
 * @param {string} raw NUL-separated `git ... -z` output.
 * @returns {string[]}
 */
export function parsePaths(raw) {
  return raw.split("\0").filter((path) => path !== "");
}

/**
 * The paths this PR changes relative to the merge base with its base branch.
 *
 * Three-dot: on a `pull_request` event the checked-out HEAD is the merge commit, and
 * the base branch may have moved since. Two-dot would then report main's own newer
 * commits as changes (in reverse), which is wrong in both directions.
 *
 * @param {string} baseRef base branch name, e.g. "main".
 * @param {{ cwd?: string }} [options] repository to read; the process cwd by default.
 * @returns {string[] | null} paths, or null when the base could not be resolved.
 */
export function changedFiles(baseRef, options = {}) {
  const cwd = options.cwd;
  const base = `origin/${baseRef}`;
  try {
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], cwd);
  } catch {
    return null;
  }
  return parsePaths(git(["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`], cwd));
}

/**
 * Write `plan_only=<value>` where the workflow can read it, and echo it to the log.
 *
 * @param {boolean} value
 * @param {string} why one line, printed so a run explains itself without a rerun.
 */
function report(value, why) {
  stdout.write(`plan_only=${value} (${why})\n`);
  const outputFile = env["GITHUB_OUTPUT"];
  if (outputFile !== undefined && outputFile !== "") {
    appendFileSync(outputFile, `plan_only=${value}\n`);
  }
}

function main() {
  const eventName = env["GITHUB_EVENT_NAME"];
  const baseRef = env["BASE_REF"] ?? env["GITHUB_BASE_REF"] ?? "";

  if (eventName !== undefined && eventName !== "pull_request") {
    report(false, `event is ${eventName}, not pull_request`);
    return;
  }
  if (baseRef === "") {
    report(false, "no base ref available");
    return;
  }

  let files;
  try {
    files = changedFiles(baseRef);
  } catch (error) {
    stdout.write(`::warning::ci-plan-only: diff failed (${String(error)})\n`);
    report(false, "diff failed");
    return;
  }
  if (files === null) {
    stdout.write(`::warning::ci-plan-only: cannot resolve origin/${baseRef}\n`);
    report(false, `origin/${baseRef} not resolvable`);
    return;
  }

  // Quoted, not bare. An indented bare path renders ` plan/evil.ts` and `plan/evil.ts`
  // identically in a run log, and a leading space is the difference between prose and
  // a TypeScript file the fast lane must not skip. JSON.stringify makes the boundary
  // of every path visible, including tabs and non-ASCII.
  stdout.write(`Changed vs origin/${baseRef} (${files.length} path(s)):\n`);
  for (const path of files.slice(0, LOG_LIMIT)) stdout.write(`  ${JSON.stringify(path)}\n`);
  if (files.length > LOG_LIMIT) stdout.write(`  ... and ${files.length - LOG_LIMIT} more\n`);

  if (files.length === 0) {
    report(false, "empty diff, so nothing was classified");
    return;
  }
  const outside = files.filter((path) => !path.startsWith(PLAN_PREFIX));
  report(
    isPlanOnly(files),
    outside.length === 0
      ? `${files.length} path(s), all under ${PLAN_PREFIX}`
      : `${outside.length} path(s) outside ${PLAN_PREFIX}, first: ${JSON.stringify(outside[0])}`,
  );
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
