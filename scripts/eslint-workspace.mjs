#!/usr/bin/env node
// @ts-check
/**
 * ESLint, always run with the workspace root as the working directory.
 *
 * Every `lint` script in this repository goes through here, so that one file linted
 * twice gets one verdict. That is not free by default: ESLint hands each rule a
 * `context.cwd`, and a plugin is entitled to resolve things against it, so the same
 * file under the same config can be judged differently from the root than from the
 * package that owns it. `pnpm check:lint-coverage` measures coverage from the root
 * while `turbo run lint` runs each package's script in the package directory, which
 * is exactly the pair that must not disagree.
 *
 * **Measured, not hypothetical** (issue #899). `eslint-plugin-sonarjs` activates 14 of
 * its 279 rules only when a dependency is declared in a `package.json` at or above the
 * linted file, and that upward walk stops at `context.cwd`
 * (`helpers/dependency-manifests/dependencies.js` bounds it with `topDir`). QCMS
 * declares `vitest` and `@playwright/test` once, in the root manifest, and only
 * `apps/e2e` and `tooling/e2e-support` re-declare either. So from `apps/portal` the
 * walk ended at `apps/portal/package.json`, found no test framework, and every one of
 * those rules returned an empty visitor: `no-forced-browser-interaction`,
 * `no-skipped-tests`, `explicit-test-skip`, `stable-tests`, `no-duplicate-test-title`,
 * `no-empty-test-title`, `async-test-assertions`, `synchronous-suite-callback`,
 * `no-mixed-completion-style`, `no-interpolation-in-inline-snapshots`,
 * `parameterized-tests`, `prefer-specific-assertions`, `no-default-utility-imports`
 * and `no-implicit-dependencies`. The root sweep saw two real errors in
 * `apps/portal/e2e/clear-paths.pw.ts` that the merge gate could not.
 *
 * What is deliberately NOT the fix: declaring `@playwright/test` in the two apps that
 * only borrow it from the root. That would settle one rule for one directory and leave
 * the next root-only dependency, and the reverse direction, to be found the same way.
 * Pinning the working directory settles the class.
 *
 * Config resolution and path-scoped `files` globs were checked and are NOT part of the
 * problem: ESLint resolves the flat config by walking up, and its `files` patterns are
 * relative to the config file's own directory, so `apps/api/src/**` fences apply
 * identically from either cwd (verified on a probe file that imports `node:fs`).
 * `context.cwd` is the one thing a config cannot pin: it comes from the process, not
 * the config (`eslint/lib/linter/linter.js` takes it from `process.cwd()`).
 *
 * Usage, from any directory: `node <repo>/scripts/eslint-workspace.mjs [args...]`.
 * Positional targets are rewritten from the invoking directory to the workspace root;
 * flags and their values are passed through untouched, so a path-valued flag such as
 * `--ignore-pattern` must be written relative to the workspace root.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** The workspace root: this file lives in `<root>/scripts/`. */
export const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");

/** Basename of this module, so other gates can recognise a lint script that uses it. */
export const WORKSPACE_RUNNER = "eslint-workspace.mjs";

/**
 * ESLint flags that consume the token after them. Only the separated form needs
 * listing: `--flag=value` is self-contained. Shared with
 * `scripts/check-lint-coverage.mjs` so the two agree on what a positional target is.
 */
export const VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "--ext",
  "--ignore-pattern",
  "--rulesdir",
  "--parser",
  "--plugin",
  "--rule",
  "--resolve-plugins-relative-to",
  "--output-file",
  "-o",
  "-f",
  "--format",
  "--max-warnings",
]);

/**
 * One positional target, moved from the invoking directory to the workspace root.
 *
 * @param {string} target a path or glob as written on the command line.
 * @param {string} fromDir absolute path of the invoking directory.
 * @returns {string} the same target, relative to the workspace root.
 */
function toWorkspaceRelative(target, fromDir) {
  if (path.isAbsolute(target)) return target;
  const relative = path.relative(WORKSPACE_ROOT, path.resolve(fromDir, target));
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

/**
 * Rewrite an ESLint argument list for execution at the workspace root.
 *
 * @param {string[]} args the arguments as given to this script.
 * @param {string} fromDir absolute path of the invoking directory.
 * @returns {string[]}
 */
export function rewriteArgs(args, fromDir) {
  /** @type {string[]} */
  const rewritten = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) {
      rewritten.push(arg);
      const value = args[index + 1];
      if (VALUE_FLAGS.has(arg) && value !== undefined) {
        rewritten.push(value);
        index += 1;
      }
      continue;
    }
    rewritten.push(toWorkspaceRelative(arg, fromDir));
  }
  return rewritten;
}

/**
 * The ESLint CLI entry point, resolved from THIS file rather than from the caller, so
 * every package lints with the workspace's one ESLint.
 *
 * @returns {string} absolute path to `eslint`'s bin script.
 */
export function eslintBin() {
  const manifestPath = createRequire(import.meta.url).resolve("eslint/package.json");
  const manifest = /** @type {{ bin: string | Record<string, string> }} */ (
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin["eslint"];
  if (entry === undefined) throw new Error("eslint's package.json declares no bin entry");
  return path.resolve(path.dirname(manifestPath), entry);
}

/**
 * Run ESLint at the workspace root.
 *
 * @param {string[]} args arguments as given to this script.
 * @param {string} [fromDir] the invoking directory; defaults to the process cwd.
 * @returns {number} ESLint's exit code (1 when it was killed by a signal).
 */
export function run(args, fromDir = process.cwd()) {
  const result = spawnSync(process.execPath, [eslintBin(), ...rewriteArgs(args, fromDir)], {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`eslint-workspace: could not start ESLint - ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// Only when run as a command, so other modules and the test can import the helpers
// above without spawning ESLint.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.slice(2)));
}
