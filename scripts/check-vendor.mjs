#!/usr/bin/env node
// @ts-check
/**
 * Run the version gate and the citation gate together, so a failing digit check cannot hide a
 * citation failure, and exit with the worse code.
 */

import { spawnSync } from "node:child_process";
import { argv, execPath, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const STEPS = [
  ["check-vendor-pin.mjs"],
  ["vendor-cite.mjs", "--quiet", "--expect"],
];

/**
 * @param {readonly number[]} codes
 * @returns {number}
 */
export function worstExit(codes) {
  return codes.reduce((worst, code) => (code > worst ? code : worst), 0);
}

/** @returns {number} */
export function main() {
  const codes = STEPS.map(([script, ...args]) => {
    const result = spawnSync(
      execPath,
      [fileURLToPath(new URL(/** @type {string} */ (script), import.meta.url)), ...args],
      { stdio: "inherit" },
    );
    return result.status ?? 1;
  });
  return worstExit(codes);
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main());
}
