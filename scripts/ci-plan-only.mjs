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
  const paths = files.filter((path) => path !== "");
  if (paths.length === 0) return false;
  return paths.every((path) => path.startsWith(PLAN_PREFIX));
}

/**
 * @param {readonly string[]} args
 * @returns {string}
 */
function git(args) {
  return execFileSync(GIT, [...args], { encoding: "utf8" });
}

/**
 * The paths this PR changes relative to the merge base with its base branch.
 *
 * Three-dot: on a `pull_request` event the checked-out HEAD is the merge commit, and
 * the base branch may have moved since. Two-dot would then report main's own newer
 * commits as changes (in reverse), which is wrong in both directions.
 *
 * @param {string} baseRef base branch name, e.g. "main".
 * @returns {string[] | null} paths, or null when the base could not be resolved.
 */
export function changedFiles(baseRef) {
  const base = `origin/${baseRef}`;
  try {
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  } catch {
    return null;
  }
  return git(["diff", "--name-only", "--no-renames", `${base}...HEAD`])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
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

  stdout.write(`Changed vs origin/${baseRef} (${files.length} path(s)):\n`);
  for (const path of files.slice(0, LOG_LIMIT)) stdout.write(`  ${path}\n`);
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
      : `${outside.length} path(s) outside ${PLAN_PREFIX}, first: ${outside[0]}`,
  );
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
