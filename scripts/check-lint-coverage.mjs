#!/usr/bin/env node
// @ts-check
/**
 * Lint-coverage gate (issue #413).
 *
 * ESLint only ever sees the paths a `lint` script hands it. Nothing in this repo
 * checked that those paths add up to the tree, so a file could sit outside every one
 * of them and the whole pipeline would stay green over a file it never opened. That
 * is not a red and not a warning: it is silence, and silence reads as a pass.
 *
 * The repo hit this family three times before anyone named it:
 *
 *   - #257 / #293   root `scripts/` is ESLint-unseen, because turbo's lint task is
 *                   package-scoped and there is no root package to hang a run on.
 *   - #387 item 21  `apps/admin` silently omitted its own `instrumentation.ts` while
 *                   the portal's list covered the equivalent file.
 *   - #413          the mechanism behind that: both apps named their files one by
 *                   one, so every new root-level file was unlinted by default.
 *
 * All three survived until somebody happened to read a command echo. Membership of a
 * lint glob is exactly the kind of property that cannot be verified by inspection,
 * which is why it needs a gate rather than a convention.
 *
 * ## What it asserts
 *
 * Every tracked source file is inside some package's `lint` scope, or is named in
 * KNOWN_UNLINTED below with a reason. Plus: every lint target actually exists, and
 * every KNOWN_UNLINTED entry still describes a real gap.
 *
 * ## How it decides
 *
 * The file list comes from `git ls-files`, never a directory walk. A walk includes
 * build output, so it is self-consistent on any machine that has built and quietly
 * wrong everywhere else: the gate would then be asserting a property of the working
 * directory rather than of the repository.
 *
 * Lint scope is read out of the `lint` script of every tracked `package.json` - the
 * eslint invocations in it, and the targets each one passes. A directory target
 * covers everything beneath it, a file target covers exactly itself. Scope is
 * therefore derived from the same string the linter is actually given, so the gate
 * cannot drift from the command it describes. A `lint` script with no eslint
 * invocation in it (the root's, which delegates to `turbo run lint`) contributes no
 * coverage, which is the truth about it.
 *
 * A `lint` script this parser cannot read produces no targets, so its package's files
 * report as uncovered and the gate goes red. That is deliberate: the failure mode of
 * a scope-reading gate must be a loud red, never a quiet assumption of coverage.
 *
 * ESLint's own `ignores` are honoured by asking ESLint (`isPathIgnored`) rather than
 * by restating the list here. Restating it would reintroduce the defect one level up:
 * two copies of a rule, one of them silently stale.
 *
 * ## What it cannot see
 *
 * Written down because an unwritten limit is how a gate gets trusted past its reach.
 *
 *   - It checks that a file is REACHED by a lint run, not that any rule fires on it.
 *     A file inside a glob whose every relevant rule is disabled for it passes here.
 *   - It reads targets statically, so a target assembled by the shell (a `$(...)`
 *     substitution, a wrapper script that computes its own file list) is not
 *     understood. Such a script contributes zero coverage rather than an assumed
 *     one, so the result is a red, not a false green.
 *   - Unknown value-taking flags. The recognised ones are in VALUE_FLAGS; a flag
 *     outside that set that consumes the next token would have that token read as a
 *     file target, widening apparent coverage by exactly one path.
 *   - `plan/**` is out of scope, as it is for `check-no-em-dash` and `check-ports`:
 *     a committed scratch and history area, not shipped source.
 *
 * Usage:  node scripts/check-lint-coverage.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";

/** Extensions ESLint is configured to parse in this workspace. */
const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];

/** Committed scratch and history area, skipped by the other gates for the same reason. */
const EXCLUDES = [":!plan/**"];

/**
 * Tracked source files that no lint run reaches, each with the reason it is out.
 *
 * This is an inventory of a known gap, not permission to grow one. Two rules keep it
 * from becoming the defect it documents:
 *
 *   1. Nothing lands here to make a red go away. An entry records a decision that
 *      already exists somewhere else in the repo, and cites where.
 *   2. **Every entry must match at least one uncovered tracked file.** A dead entry
 *      fails this gate, so the list shrinks as coverage grows and can never quietly
 *      outlive the gap it describes. (Same discipline as ALLOWED in
 *      `check-ports.mjs`, and for the same reason: a stale exemption reads as
 *      evidence of coverage.)
 *
 * An entry ending in `/` covers a directory; every other entry is an exact
 * repo-relative path, compared with `===`. Exactness is the default on purpose: a
 * one-off config file exempted by prefix would silently exempt its future
 * neighbours, which is the whole bug.
 *
 * @type {{ path: string; why: string }[]}
 */
export const KNOWN_UNLINTED = [
  {
    path: "scripts/",
    why: "Deliberate today, and recorded: vitest.config.ts states that the tooling project's files are run but neither typechecked nor linted, because linting them needs a root tsconfig and root @types/node. Turbo's lint task is package-scoped and there is no root package to hang a run on, which is issue #257. Directory-wide because the decision is directory-wide; narrow it to exact paths when #257 closes.",
  },
  {
    path: ".devcontainer/",
    why: "Same tooling project and the same recorded decision in vitest.config.ts (issue #257).",
  },
  {
    path: "eslint.config.js",
    why: "Repo-root configuration, outside every package, so no package's eslint run reaches it: the root half of issue #257, and the root files of issue #64 item 2 ('no root lint target exists').",
  },
  { path: "vitest.config.ts", why: "Repo-root configuration: same as eslint.config.js above." },
  { path: "playwright.config.ts", why: "Repo-root configuration: same as eslint.config.js above." },
  {
    path: "playwright.compose.config.ts",
    why: "Repo-root configuration: same as eslint.config.js above.",
  },
  {
    path: "packages/db/drizzle.config.ts",
    why: "Package-root tooling config, outside @qcms/db's `eslint src` scope. This one is named in issue #64 item 2, which records why it is not a one-line widening: the file is outside the TS project as well as the lint scope, so covering it needs a per-package tsconfig `include` or `allowDefaultProject` decision, and @qcms/db is publishable so the change wants its own changeset.",
  },
  {
    path: "packages/ui/vitest.config.ts",
    why: "Package-root tooling config, outside @qcms/ui's `eslint src tools` scope. Named in issue #64 item 2 alongside the entry above, and blocked on the same tsconfig decision plus a changeset (@qcms/ui is publishable).",
  },
  {
    path: "packages/ui/vitest.setup.ts",
    why: "Package-root tooling config, outside @qcms/ui's `eslint src tools` scope. Named in issue #64 item 2 alongside the entry above, and blocked on the same tsconfig decision plus a changeset (@qcms/ui is publishable).",
  },
];

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
  return splitZ(git(["ls-files", "-z", ...SOURCE_GLOBS, ...EXCLUDES])).sort((a, b) =>
    a < b ? -1 : 1,
  );
}

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
 * The KNOWN_UNLINTED entry covering `file`, when one does.
 *
 * A trailing `/` means directory prefix; anything else is an exact path, never a
 * substring or a suffix (see KNOWN_UNLINTED for why).
 *
 * @param {string} file repo-relative path, as `git ls-files` reports it.
 * @returns {{ path: string; why: string } | undefined}
 */
export function knownUnlinted(file) {
  return KNOWN_UNLINTED.find((entry) =>
    entry.path.endsWith("/") ? file.startsWith(entry.path) : entry.path === file,
  );
}

/**
 * Tracked source files no lint run reaches, split into the ones KNOWN_UNLINTED
 * accounts for and the ones it does not.
 *
 * @param {string[]} source tracked source files.
 * @param {{ dirs: string[]; files: Set<string> }} scope
 * @param {(file: string) => Promise<boolean>} isIgnored ESLint's own ignore test.
 * @returns {Promise<{ violations: string[]; baselined: string[] }>}
 */
export async function uncovered(source, scope, isIgnored) {
  const violations = [];
  const baselined = [];

  for (const file of source) {
    if (scope.files.has(file)) continue;
    if (scope.dirs.some((dir) => file.startsWith(dir))) continue;
    // Asked last: it is the only expensive test, and only unreached files need it.
    if (await isIgnored(file)) continue;
    if (knownUnlinted(file) === undefined) violations.push(file);
    else baselined.push(file);
  }

  return { violations, baselined };
}

/**
 * KNOWN_UNLINTED entries that no longer describe a real gap, so the list cannot
 * outlive the coverage hole it documents.
 *
 * @param {string[]} baselined files an entry accounted for.
 * @returns {{ path: string; why: string }[]}
 */
export function deadEntries(baselined) {
  const live = new Set(baselined.map((file) => knownUnlinted(file)?.path));
  return KNOWN_UNLINTED.filter((entry) => !live.has(entry.path));
}

/**
 * Run the gate over the tracked tree.
 *
 * @returns {Promise<number>} the process exit code.
 */
export async function main() {
  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  const source = trackedSourceFiles();
  const scope = lintScope(trackedManifests(), repoRoot);

  const eslint = new ESLint({ cwd: repoRoot });
  const { violations, baselined } = await uncovered(source, scope, (file) =>
    eslint.isPathIgnored(path.join(repoRoot, file)),
  );
  const dead = deadEntries(baselined);

  if (scope.missing.length === 0 && violations.length === 0 && dead.length === 0) {
    console.log(
      `check-lint-coverage: OK - ${String(source.length)} tracked source files, ` +
        `${String(baselined.length)} in the known-unlinted inventory, the rest inside a lint scope.`,
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

  if (violations.length > 0) {
    console.error("check-lint-coverage: tracked source file(s) outside every lint scope:\n");
    for (const file of violations.slice(0, 50)) console.error(`  ${file}`);
    if (violations.length > 50) console.error(`  ... and ${String(violations.length - 50)} more`);
    console.error(
      [
        "",
        "ESLint never opens these, so every check over them reports green without",
        "reading them (issue #413). Put each one inside a lint scope: prefer widening",
        "an existing `lint` script to a directory or `eslint .` over naming files one",
        "by one, because a hand-written list is the defect this gate exists to catch.",
        "",
        "If a file genuinely should not be linted, that is a decision to state, not a",
        "disable comment: add it to KNOWN_UNLINTED in scripts/check-lint-coverage.mjs",
        "with the reason and where the decision is recorded.",
      ].join("\n"),
    );
  }

  if (dead.length > 0) {
    console.error("\ncheck-lint-coverage: KNOWN_UNLINTED entr(ies) that match nothing:\n");
    for (const entry of dead) console.error(`  ${entry.path}`);
    console.error(
      "\nThe gap is gone or the path moved. Delete the entry: a stale exemption reads as\nevidence that the file is linted, which is the misreading this gate prevents.",
    );
  }

  return 1;
}

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(await main());
}
