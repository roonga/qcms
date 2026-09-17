#!/usr/bin/env node
// @ts-check
/**
 * Proves that every tracked project JavaScript or TypeScript file is reached by
 * ESLint and every tracked Markdown file is reached by Prettier. Two byte-for-byte
 * copy trees are the only source exclusions, and both are named below with the reason
 * and with what covers them instead.
 *
 * Usage: node scripts/check-lint-coverage.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import { getFileInfo } from "prettier";

import { VALUE_FLAGS, WORKSPACE_RUNNER } from "./eslint-workspace.mjs";
import { isGeneratedCopy } from "./generated-copy.mjs";
import { isVendoredSource } from "./vendored-source.mjs";

/** Extensions ESLint is configured to parse in this workspace. */
const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];

/**
 * @param {string[]} args
 * @returns {string} raw stdout
 */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * @param {string} out NUL-separated `git ls-files -z` output.
 * @returns {string[]}
 */
function splitZ(out) {
  return out.split("\0").filter((entry) => entry !== "");
}

/** @returns {string[]} every tracked source file this gate covers, repo-relative. */
export function trackedSourceFiles() {
  return splitZ(git(["ls-files", "-z", ...SOURCE_GLOBS])).sort((a, b) => (a < b ? -1 : 1));
}

/** @returns {string[]} every tracked Markdown file, repo-relative. */
export function trackedMarkdownFiles() {
  return splitZ(git(["ls-files", "-z", "*.md"])).sort((a, b) => (a < b ? -1 : 1));
}

/**
 * Only the byte-for-byte upstream a2ra component copy may bypass ESLint.
 *
 * Re-exported rather than defined here since issue #775: this gate drew the line
 * correctly and four others drew it a directory too wide, so the prefix now lives in
 * `scripts/vendored-source.mjs` and every gate reads the same one.
 */
export { isVendoredSource };

/**
 * Re-exported, not defined here: the generated scaffolding template tree (task 037)
 * has one spelling, in `scripts/generated-copy.mjs`, for the reason that module gives.
 *
 * It is deliberately a SEPARATE concept from `isVendoredSource`. The vendored a2ra
 * components are upstream-owned but genuinely compiled; the template tree is a copy of
 * files this repository already lints at the source, sitting outside every tsconfig and
 * every lint scope. Folding one into the other would tell four other gates to stop
 * scanning 337 files, which is issue #775's defect one directory over.
 */
export { isGeneratedCopy };

/** @returns {string[]} every tracked package.json, repo-relative. */
export function trackedManifests() {
  return splitZ(git(["ls-files", "-z", "package.json", "*/package.json", "*/*/package.json"])).sort(
    (a, b) => (a < b ? -1 : 1),
  );
}

/**
 * Whether a token is the `scripts/eslint-workspace.mjs` runner, by any relative spelling.
 *
 * @param {string | undefined} token
 * @returns {boolean}
 */
function isWorkspaceRunner(token) {
  return token !== undefined && path.posix.basename(token) === WORKSPACE_RUNNER;
}

/**
 * Where one `lint` script's eslint segments start, and how they were spelled.
 *
 * A segment counts when it runs `eslint` directly or through
 * `scripts/eslint-workspace.mjs`, which is ESLint with the working directory pinned to
 * the workspace root (issue #899). Both forms take their targets the same way, written
 * relative to the package, so the caller reads them identically.
 *
 * `turbo run lint && prettier --check .` yields none, which is the honest answer: the
 * root package lints nothing itself in that segment.
 *
 * @param {string} script the raw `scripts.lint` string.
 * @returns {{ tokens: string[]; index: number; pinned: boolean }[]} one entry per
 *   eslint segment, with `index` at the last token before the first target and
 *   `pinned` true when the segment goes through the runner.
 */
function eslintSegments(script) {
  const segments = [];
  for (const segment of script.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/);
    let index = 0;
    // Strip a runner prefix so `pnpm exec eslint src` reads the same as `eslint src`.
    if (tokens[index] === "pnpm" && tokens[index + 1] === "exec") index += 2;
    else if (tokens[index] === "npx") index += 1;
    const pinned = tokens[index] === "node" && isWorkspaceRunner(tokens[index + 1]);
    if (pinned) index += 1;
    else if (tokens[index] !== "eslint") continue;
    segments.push({ tokens, index, pinned });
  }
  return segments;
}

/**
 * The paths the eslint invocations in one `lint` script are handed.
 *
 * @param {string} script the raw `scripts.lint` string.
 * @returns {string[]} targets, exactly as written in the script.
 */
export function lintTargets(script) {
  const targets = [];
  for (const { tokens, index: start } of eslintSegments(script)) {
    for (let index = start + 1; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      if (token === "") continue;
      if (token.startsWith("-")) {
        if (VALUE_FLAGS.has(token)) index += 1;
        continue;
      }
      targets.push(token);
    }
  }
  return targets;
}

/**
 * Whether every eslint segment in one `lint` script pins the working directory.
 *
 * A bare `eslint` in a package script is a verdict that depends on where it was run
 * from, which is the defect in issue #899: 14 `eslint-plugin-sonarjs` rules only switch
 * on when a test framework is declared at or above the linted file, and that search
 * stops at `context.cwd`. Run from `apps/portal` they were all silently off, so the
 * root sweep reported errors the per-package merge gate could not see. Every lint
 * script therefore goes through `scripts/eslint-workspace.mjs`.
 *
 * @param {string} script the raw `scripts.lint` string.
 * @returns {boolean} true when at least one segment runs ESLint unpinned.
 */
export function hasUnpinnedEslint(script) {
  return eslintSegments(script).some(({ pinned }) => !pinned);
}

/**
 * Where every package's lint run reaches, as repo-relative paths.
 *
 * @param {string[]} manifests tracked package.json paths.
 * @param {string} repoRoot absolute path to the repository root.
 * @returns {{ dirs: string[]; files: Set<string>; missing: { manifest: string; target: string }[]; unpinned: string[] }}
 *   `dirs` are prefixes ending in `/`; `missing` are targets that do not exist on
 *   disk, which is a stale lint script (the #387 item 21 shape) and a failure;
 *   `unpinned` are manifests whose lint script runs ESLint without pinning the
 *   working directory (issue #899) and is therefore a cwd-dependent verdict.
 */
export function lintScope(manifests, repoRoot) {
  const dirs = [];
  const files = new Set();
  const missing = [];
  const unpinned = [];

  for (const manifest of manifests) {
    const dirname = path.posix.dirname(manifest);
    const packageDir = dirname === "." ? "" : dirname;

    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path.join(repoRoot, manifest), "utf8"));
    } catch {
      continue;
    }
    const scripts = /** @type {{ scripts?: Record<string, unknown> }} */ (parsed).scripts;
    const script = scripts?.lint;
    if (typeof script !== "string") continue;
    if (hasUnpinnedEslint(script)) unpinned.push(manifest);

    for (const target of lintTargets(script)) {
      const joined = packageDir === "" ? target : `${packageDir}/${target}`;
      const normalized = path.posix.normalize(joined).replace(/\/+$/, "");
      const relative = normalized === "." ? "" : normalized;

      let stat;
      try {
        stat = statSync(path.join(repoRoot, relative === "" ? "." : relative));
      } catch {
        missing.push({ manifest, target });
        continue;
      }
      if (stat.isDirectory()) dirs.push(relative === "" ? "" : `${relative}/`);
      else files.add(relative);
    }
  }

  return { dirs, files, missing, unpinned };
}

/**
 * Tracked source files no lint run reaches.
 *
 * @param {string[]} source tracked source files.
 * @param {{ dirs: string[]; files: Set<string> }} scope
 * @returns {string[]}
 */
export function uncovered(source, scope) {
  const violations = [];

  for (const file of source) {
    if (scope.files.has(file)) continue;
    if (scope.dirs.some((dir) => file.startsWith(dir))) continue;
    violations.push(file);
  }

  return violations;
}

/**
 * Markdown files excluded from Prettier or unsupported by it.
 * @param {string[]} files tracked Markdown files.
 * @param {string} repoRoot absolute repository root.
 * @returns {Promise<string[]>}
 */
export async function uncoveredMarkdown(files, repoRoot) {
  const violations = [];
  for (const file of files) {
    const info = await getFileInfo(path.join(repoRoot, file), {
      ignorePath: path.join(repoRoot, ".prettierignore"),
    });
    if (info.ignored || info.inferredParser !== "markdown") violations.push(file);
  }
  return violations;
}

/**
 * Run the gate over the tracked tree.
 *
 * @returns {Promise<number>} the process exit code.
 */
export async function main() {
  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  const source = trackedSourceFiles();
  const markdown = trackedMarkdownFiles();
  const scope = lintScope(trackedManifests(), repoRoot);

  const eslint = new ESLint({ cwd: repoRoot });
  const ignoredChecks = await Promise.all(
    source.map(async (file) => ({
      file,
      ignored: await eslint.isPathIgnored(path.join(repoRoot, file)),
    })),
  );
  const excluded = ({ file }) => isVendoredSource(file) || isGeneratedCopy(file);
  const vendored = ignoredChecks.filter((entry) => entry.ignored && excluded(entry));
  const ignoredViolations = ignoredChecks.filter((entry) => entry.ignored && !excluded(entry));
  const lintableSource = ignoredChecks.filter(({ ignored }) => !ignored).map(({ file }) => file);
  const violations = uncovered(lintableSource, scope);
  const markdownViolations = await uncoveredMarkdown(markdown, repoRoot);

  if (
    scope.missing.length === 0 &&
    scope.unpinned.length === 0 &&
    ignoredViolations.length === 0 &&
    violations.length === 0 &&
    markdownViolations.length === 0
  ) {
    console.log(
      `check-lint-coverage: OK - ${String(lintableSource.length)} source files reached by ESLint; ` +
        `${String(vendored.length)} copied source files explicitly excluded; ` +
        `${String(markdown.length)} Markdown files reached by Prettier; ` +
        "0 unexplained exemptions.",
    );
    return 0;
  }

  if (scope.missing.length > 0) {
    console.error("check-lint-coverage: lint script(s) naming a path that does not exist:\n");
    for (const entry of scope.missing) {
      console.error(`  ${entry.manifest}  ->  ${entry.target}`);
    }
    console.error(
      "\nA lint target that does not exist is a lint script nobody has re-read. Remove it,\nor fix the path.\n",
    );
  }

  if (scope.unpinned.length > 0) {
    console.error("check-lint-coverage: lint script(s) running ESLint without a pinned cwd:\n");
    for (const manifest of scope.unpinned) console.error(`  ${manifest}`);
    console.error(
      [
        "",
        "ESLint hands every rule `context.cwd`, and 14 eslint-plugin-sonarjs rules only",
        "switch on when a test framework is declared at or above the linted file, a search",
        "that stops there. Run from a package that borrows `vitest` or `@playwright/test`",
        "from the root manifest, all 14 are silently off, so this sweep and the per-package",
        "merge gate reach different verdicts on the same file (issue #899).",
        "",
        "Run ESLint through `scripts/eslint-workspace.mjs` instead:",
        '  "lint": "node ../../scripts/eslint-workspace.mjs src"',
      ].join("\n"),
    );
  }

  if (ignoredViolations.length > 0) {
    console.error("\ncheck-lint-coverage: source file(s) unexpectedly ignored by ESLint:\n");
    for (const { file } of ignoredViolations.slice(0, 50)) console.error(`  ${file}`);
    if (ignoredViolations.length > 50) {
      console.error(`  ... and ${String(ignoredViolations.length - 50)} more`);
    }
  }

  if (violations.length > 0) {
    console.error("check-lint-coverage: tracked source file(s) outside every lint scope:\n");
    for (const file of violations.slice(0, 50)) console.error(`  ${file}`);
    if (violations.length > 50) console.error(`  ... and ${String(violations.length - 50)} more`);
    console.error(
      [
        "",
        "ESLint never opens these, so every check over them reports green without",
        "reading them. Put each one inside an ESLint scope.",
      ].join("\n"),
    );
  }

  if (markdownViolations.length > 0) {
    console.error("\ncheck-lint-coverage: Markdown file(s) excluded from Prettier:\n");
    for (const file of markdownViolations) console.error(`  ${file}`);
  }

  return 1;
}

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(await main());
}
