#!/usr/bin/env node
// @ts-check
/**
 * Proves that every tracked project JavaScript or TypeScript file is reached by
 * ESLint and every tracked Markdown file is reached by Prettier. The byte-for-byte
 * upstream component copy is the only source exclusion.
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

import { isVendoredSource } from "./vendored-source.mjs";

/** Extensions ESLint is configured to parse in this workspace. */
const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];

/**
 * Flags that consume the token after them, which would otherwise be read as a file
 * to lint. Only the separated form needs listing: `--flag=value` is self-contained.
 */
const VALUE_FLAGS = new Set([
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

/** @returns {string[]} every tracked package.json, repo-relative. */
export function trackedManifests() {
  return splitZ(git(["ls-files", "-z", "package.json", "*/package.json", "*/*/package.json"])).sort(
    (a, b) => (a < b ? -1 : 1),
  );
}

/**
 * The paths the eslint invocations in one `lint` script are handed.
 *
 * Only eslint segments count. `turbo run lint && prettier --check .` yields none,
 * which is the honest answer: the root package lints nothing itself.
 *
 * @param {string} script the raw `scripts.lint` string.
 * @returns {string[]} targets, exactly as written in the script.
 */
export function lintTargets(script) {
  const targets = [];
  for (const segment of script.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/);
    let index = 0;
    // Strip a runner prefix so `pnpm exec eslint src` reads the same as `eslint src`.
    if (tokens[index] === "pnpm" && tokens[index + 1] === "exec") index += 2;
    else if (tokens[index] === "npx") index += 1;
    if (tokens[index] !== "eslint") continue;
    for (index += 1; index < tokens.length; index += 1) {
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
 * Where every package's lint run reaches, as repo-relative paths.
 *
 * @param {string[]} manifests tracked package.json paths.
 * @param {string} repoRoot absolute path to the repository root.
 * @returns {{ dirs: string[]; files: Set<string>; missing: { manifest: string; target: string }[] }}
 *   `dirs` are prefixes ending in `/`; `missing` are targets that do not exist on
 *   disk, which is a stale lint script (the #387 item 21 shape) and a failure.
 */
export function lintScope(manifests, repoRoot) {
  const dirs = [];
  const files = new Set();
  const missing = [];

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

  return { dirs, files, missing };
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
  const vendored = ignoredChecks.filter(({ file, ignored }) => ignored && isVendoredSource(file));
  const ignoredViolations = ignoredChecks.filter(
    ({ file, ignored }) => ignored && !isVendoredSource(file),
  );
  const lintableSource = ignoredChecks.filter(({ ignored }) => !ignored).map(({ file }) => file);
  const violations = uncovered(lintableSource, scope);
  const markdownViolations = await uncoveredMarkdown(markdown, repoRoot);

  if (
    scope.missing.length === 0 &&
    ignoredViolations.length === 0 &&
    violations.length === 0 &&
    markdownViolations.length === 0
  ) {
    console.log(
      `check-lint-coverage: OK - ${String(lintableSource.length)} source files reached by ESLint; ` +
        `${String(vendored.length)} vendored source files explicitly excluded; ` +
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
