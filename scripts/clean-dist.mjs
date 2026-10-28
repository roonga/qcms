#!/usr/bin/env node
// @ts-check
/**
 * `tsc` deletes nothing, so stale output survives later builds, and a forced turbo rebuild re-caches
 * it. Removing the directory first makes `dist` a function of the current source.
 */

import { existsSync, rmSync } from "node:fs";
import { argv, cwd, exit } from "node:process";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Only ever a build-output directory, never an arbitrary path. */
const DEFAULT_TARGET = "dist";

/**
 * Deliberately blunt guards for a script whose job is a recursive delete: an absolute
 * path, a parent traversal, or a missing sibling `package.json` means stop, not guess.
 *
 * @param {string} packageRoot
 * @param {string} target
 * @returns {{ ok: true; path: string } | { ok: false; reason: string }}
 */
export function resolveTarget(packageRoot, target) {
  if (target === "" || isAbsolute(target) || target.split(/[/\\]/).includes("..")) {
    return { ok: false, reason: `refusing to remove ${JSON.stringify(target)}: not a plain name` };
  }
  if (!existsSync(join(packageRoot, "package.json"))) {
    return {
      ok: false,
      reason: `refusing to run in ${packageRoot}: no package.json, so this is not a package root`,
    };
  }
  return { ok: true, path: resolve(packageRoot, target) };
}

/** @returns {number} */
function main() {
  const target = argv[2] ?? DEFAULT_TARGET;
  const resolved = resolveTarget(cwd(), target);
  if (!resolved.ok) {
    console.error(`clean-dist: ${resolved.reason}`);
    return 1;
  }
  // `force` so a first build, where nothing exists yet, is not an error.
  rmSync(resolved.path, { recursive: true, force: true });
  return 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main());
}
