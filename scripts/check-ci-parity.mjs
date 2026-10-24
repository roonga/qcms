#!/usr/bin/env node
// @ts-check
/**
 * `check:all` and the workflow's `verify` job are two hand-maintained enumerations of
 * one set, and `pnpm verify` has to stay a superset of CI. A gate present in only one
 * of them is silent: it reports green locally and CI never ran it.
 */

import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = new URL("../", import.meta.url);
const PACKAGE_JSON = "package.json";
const WORKFLOW = ".github/workflows/ci.yml";

/**
 * `check:plan` is the fast lane's replacement for the build-and-test steps, so it is
 * not a member of `check:all`. Named rather than pattern-matched, so a second case
 * cannot appear by accident.
 */
const NOT_IN_CHECK_ALL = new Set(["check:plan"]);

/**
 * Anchored on the `pnpm` invocation, so a check name merely mentioned in prose, a path
 * or a comment is not counted.
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

/** Read from the script body, not a second list, so this gate cannot drift from it. */
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
 * Comment lines are dropped first: the workflow names check scripts in its own prose,
 * and counting those would report parity it does not have.
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

export function compareLists(inCheckAll, inWorkflow) {
  return {
    missingFromWorkflow: inCheckAll.filter((name) => !inWorkflow.includes(name)),
    missingFromCheckAll: inWorkflow.filter((name) => !inCheckAll.includes(name)),
  };
}

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

// Guarded so an importing test triggers neither the scan nor the `process.exit`.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
