#!/usr/bin/env node
// @ts-check
/**
 * `tsc` deletes nothing, so output from an earlier configuration survives every later
 * build and keeps resolving. `--force` makes it worse: turbo tars whatever matches the
 * `outputs` glob when the task ends, so a forced rebuild re-caches the stale artifact
 * and restores it elsewhere. Only removing the directory first makes `dist` a function
 * of the current source.
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
