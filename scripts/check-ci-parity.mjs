#!/usr/bin/env node
// @ts-check
/**
 * Proves that the local gate list and the CI gate list are the same list
 * (issue #463).
 *
 * `package.json`'s `check:all` and the `verify` job in `.github/workflows/ci.yml`
 * are two hand-maintained enumerations of the same set. CONTRIBUTING states the
 * property that binds them - `pnpm verify` is a SUPERSET of CI - and the workflow
 * spells every check out as its own step for failure granularity, so adding a gate
 * means editing both files. Three changes in one day shipped a gate that ran
 * locally and never in CI (PR #451, the fix for issue #413, and task 040), which is
 * the silent direction: the gate reports green in `verify`, nobody looks again, and
 * CI never had it. The other direction is equally wrong and louder only by luck - a
 * step in CI that `check:all` omits makes `verify` stop being a superset, so a
 * contributor's green is not the merge verdict.
 *
 * The lists were in sync when this was written (10 entries each). This gate is what
 * keeps them that way without anyone remembering to look.
 *
 * Usage: node scripts/check-ci-parity.mjs
 */

import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = new URL("../", import.meta.url);
const PACKAGE_JSON = "package.json";
const WORKFLOW = ".github/workflows/ci.yml";

/**
 * Checks that legitimately appear in the workflow without being part of
 * `check:all`.
 *
 * `check:plan` is the plan-only fast lane's REPLACEMENT for `check:all`, not one of
 * its members: a pull request whose every path is under `plan/` runs it instead of
 * the build-and-test steps (see CONTRIBUTING, "The plan/** fast lane"). It is the
 * only such case, and it is named here rather than pattern-matched so a second one
 * cannot appear by accident.
 */
const NOT_IN_CHECK_ALL = new Set(["check:plan"]);

/**
 * Every `check:*` script named by a shell command, in source order and de-duplicated.
 *
 * `pnpm check:x` and `pnpm run check:x` are both matched; anything else that merely
 * mentions a check name (prose, a path, a comment) is not, because the match is
 * anchored on the `pnpm` invocation that would actually run it.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function checkScriptsIn(text) {
  const found = [];
  const pattern = /\bpnpm\s+(?:run\s+)?(check:[a-z0-9][a-z0-9:-]*)/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined && !found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * The checks `check:all` runs, read from the script body itself rather than from a
 * second list, so this gate cannot drift from the thing it is checking.
 *
 * @param {string} packageJsonText
 * @returns {string[]}
 */
export function checkAllEntries(packageJsonText) {
  /** @type {{ scripts?: Record<string, string> }} */
  const manifest = JSON.parse(packageJsonText);
  const script = manifest.scripts?.["check:all"];
  if (script === undefined) {
    throw new Error(`${PACKAGE_JSON} has no "check:all" script`);
  }
  return checkScriptsIn(script).filter((name) => name !== "check:all");
}

/**
 * The checks the workflow runs as steps.
 *
 * Comment lines are dropped first, and that is the whole reason this is not a naive
 * scan: `ci.yml` documents this very trap in a comment that names `check:all` and
 * `check:security-hygiene` in prose, and a gate that counted those would report
 * parity the workflow does not have. YAML comments only start at the beginning of a
 * (possibly indented) line here, so no YAML parser is needed; a run command with a
 * trailing `#` comment would be read whole, which can only ever add a name, never
 * hide one.
 *
 * @param {string} workflowText
 * @returns {string[]}
 */
export function workflowEntries(workflowText) {
  const commandLines = workflowText
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  return checkScriptsIn(commandLines).filter(
    (name) => name !== "check:all" && !NOT_IN_CHECK_ALL.has(name),
  );
}

/**
 * @param {string[]} inCheckAll
 * @param {string[]} inWorkflow
 * @returns {{ missingFromWorkflow: string[]; missingFromCheckAll: string[] }}
 */
export function compareLists(inCheckAll, inWorkflow) {
  return {
    missingFromWorkflow: inCheckAll.filter((name) => !inWorkflow.includes(name)),
    missingFromCheckAll: inWorkflow.filter((name) => !inCheckAll.includes(name)),
  };
}

/** @returns {number} process exit code */
function main() {
  const packageJsonText = readFileSync(fileURLToPath(new URL(PACKAGE_JSON, REPO_ROOT)), "utf8");
  const workflowText = readFileSync(fileURLToPath(new URL(WORKFLOW, REPO_ROOT)), "utf8");

  const inCheckAll = checkAllEntries(packageJsonText);
  const inWorkflow = workflowEntries(workflowText);
  const { missingFromWorkflow, missingFromCheckAll } = compareLists(inCheckAll, inWorkflow);

  if (missingFromWorkflow.length === 0 && missingFromCheckAll.length === 0) {
    console.log(
      `check-ci-parity: OK - ${String(inCheckAll.length)} checks in ${PACKAGE_JSON} "check:all" ` +
        `and the same ${String(inWorkflow.length)} as steps in ${WORKFLOW}.`,
    );
    return 0;
  }

  if (missingFromWorkflow.length > 0) {
    console.error(`check-ci-parity: in "check:all" but NOT a step in ${WORKFLOW}:\n`);
    for (const name of missingFromWorkflow) console.error(`  ${name}`);
    console.error(
      [
        "",
        `These run in \`pnpm verify\` and never in CI. Add a step to the \`verify\` job:`,
        "",
        ...missingFromWorkflow.map(
          (name) => `      - run: pnpm ${name}\n        if: env.PLAN_ONLY != 'true'`,
        ),
        "",
      ].join("\n"),
    );
  }

  if (missingFromCheckAll.length > 0) {
    console.error(`check-ci-parity: a step in ${WORKFLOW} but NOT in "check:all":\n`);
    for (const name of missingFromCheckAll) console.error(`  ${name}`);
    console.error(
      [
        "",
        `CI runs these and \`pnpm verify\` does not, so a local green is weaker than the`,
        `merge verdict. Add each one to the "check:all" script in ${PACKAGE_JSON}, or, if`,
        `it is deliberately outside it, add it to NOT_IN_CHECK_ALL in this file with the`,
        "reason.",
        "",
      ].join("\n"),
    );
  }

  return 1;
}

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
