#!/usr/bin/env node
// @ts-check
/**
 * Every `lint` script goes through here so one file gets one verdict: `context.cwd` comes from the
 * process and plugins such as `eslint-plugin-sonarjs` bound their search there, so rules go inert in a
 * package directory. Positional targets are rewritten to the root; a path-valued flag must already be root-relative.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");

/** Basename of this module, so other gates can recognise a lint script that uses it. */
export const WORKSPACE_RUNNER = "eslint-workspace.mjs";

/**
 * Shared with `scripts/check-lint-coverage.mjs` so the two agree on what a positional
 * target is. Only the separated form needs listing; `--flag=value` is self-contained.
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
 * @param {string} target
 * @param {string} fromDir
 * @returns {string}
 */
function toWorkspaceRelative(target, fromDir) {
  if (path.isAbsolute(target)) return target;
  const relative = path.relative(WORKSPACE_ROOT, path.resolve(fromDir, target));
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

/**
 * @param {string[]} args
 * @param {string} fromDir
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
 * Resolved from this file, not the caller, so every package lints with one ESLint.
 *
 * @returns {string}
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
 * @param {string[]} args
 * @param {string} [fromDir]
 * @returns {number}
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

// Guarded so an importing module or test does not spawn ESLint.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.slice(2)));
}
