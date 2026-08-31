#!/usr/bin/env node
// @ts-check
/**
 * Remove the calling package's `dist` directory before it is rebuilt (issue #494).
 *
 * `tsc` overwrites what it emits and deletes nothing, so a file that a previous
 * configuration produced survives every later build. The shapes that produce one are
 * ordinary: a source file renamed or deleted, an `exclude` added to
 * `tsconfig.build.json`, a subpath export withdrawn. The stale `.js` and `.d.ts` stay
 * on disk, keep resolving, and keep type-checking, so nothing downstream reports a
 * problem.
 *
 * `--force` does not help, and that is the part worth stating: turbo's `outputs` glob
 * tars whatever matches `dist/**` when the task ENDS, so a forced rebuild re-caches
 * the stale artifact alongside the fresh one and then restores it into every other
 * worktree. Only removing the directory first makes `dist` a function of the current
 * source, which is what makes a cache entry mean anything.
 *
 * Wired into the `build` script of every package that emits, ahead of `tsc`, rather
 * than into a turbo task: turbo has no "clean before" hook, and a package's build
 * command is where its own build steps belong.
 *
 * Usage: node ../../scripts/clean-dist.mjs [directory]   (cwd = the package root)
 */

import { existsSync, rmSync } from "node:fs";
import { argv, cwd, exit } from "node:process";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Only ever a build-output directory, never an arbitrary path. */
const DEFAULT_TARGET = "dist";

/**
 * Resolve the directory to remove, refusing anything that is not a plain relative
 * name inside a package root.
 *
 * The guards are deliberately blunt for a script whose whole job is a recursive
 * delete: it runs from a package directory with a name it was handed, so an absolute
 * path, a parent traversal, or a directory with no `package.json` beside it means the
 * caller is not what this script is for, and the right answer is to stop rather than
 * to guess.
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

/** @returns {number} process exit code */
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
