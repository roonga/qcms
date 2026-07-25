#!/usr/bin/env node
// @ts-check
/**
 * Changeset gate (issue #55, folded into issue #19).
 *
 * A publishable package that changes without a changeset ships to consumers with
 * no version bump and no changelog line (the gap found on PR #52). Every other
 * merge requirement is enforced by a script; this one used to live only in prose,
 * so it is the same defect class issue #19 tracks: a requirement outside the
 * enforced gate set.
 *
 * FAILS when the diff against the default branch touches a publishable package
 * and no changeset **added in that same diff** names the package.
 *
 * What it deliberately does NOT require a changeset for:
 *   - Private workspace packages (`apps/*`) - never published, so "app-only"
 *     diffs pass. The publishable set is DERIVED from each package.json's
 *     `private` field (plus `.changeset/config.json`'s `ignore` list), never
 *     hardcoded, so adding a package cannot make this gate go stale.
 *   - Markdown (`*.md`) anywhere - docs-only diffs pass, including a package's
 *     own README and its generated CHANGELOG.
 *   - Test files and test directories inside a publishable package: a test-only
 *     change alters nothing a consumer can call. The repo has merged both
 *     conventions (packages/db tests WITH a changeset in PR #59, @qcms/ui tests
 *     WITHOUT one in 30147c3); exempting is the only choice that contradicts
 *     neither, because a changeset that is not required is still allowed.
 *     Note `src/testing/` is NOT a test path: it is @qcms/db's exported
 *     `./testing` subpath, which consumers import.
 *
 * It compares COMMITTED state (merge-base..HEAD), like
 * `scripts/check-golden-append-only.mjs`, whose base-ref resolution this reuses:
 * uncommitted work in the tree is invisible to it. On the default branch itself
 * (empty diff), or when nothing under a publishable package changed, it passes
 * silently.
 *
 * Usage:  node scripts/check-changeset.mjs
 * Env:    DEFAULT_BRANCH (default "main") - the branch the diff is taken against.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH ?? "main";

/**
 * Paths that never require a changeset, even inside a publishable package,
 * because they are invisible to a consumer of the published package.
 */
const EXEMPT_PATTERNS = [
  // Docs, including package READMEs and the changeset-generated CHANGELOG.md.
  /\.md$/i,
  // Test directories. `testing/` is intentionally absent (see the header note).
  /(^|\/)(__tests__|test|tests|e2e)\//,
  // Colocated test files: foo.test.ts, foo.e2e.ts, foo.pw.ts, .tsx/.mjs variants.
  /\.(test|spec|e2e|pw)\.[cm]?[jt]sx?$/,
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

/** Resolve a ref that points at the default branch tip, or undefined. */
function resolveBaseRef() {
  for (const ref of [`origin/${DEFAULT_BRANCH}`, DEFAULT_BRANCH]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined) {
      return ref;
    }
  }
  return undefined;
}

/**
 * The `packages:` entries of pnpm-workspace.yaml. A narrow reader for the one
 * shape this file has (a top-level `packages:` key over a list of quoted globs)
 * rather than a YAML dependency: it is a four-line file we own.
 *
 * @param {string} yaml
 * @returns {string[]}
 */
export function parseWorkspaceGlobs(yaml) {
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const entry = /^\s+-\s*["']?([^"'\s#]+)["']?\s*$/.exec(line);
    if (entry?.[1] !== undefined) {
      globs.push(entry[1]);
    } else if (line.trim() !== "" && !/^\s/.test(line)) {
      break; // next top-level key
    }
  }
  return globs;
}

/**
 * Expand the workspace globs to directories. Only the two shapes this repo uses
 * are supported: a literal directory and a trailing `/*`. Anything else THROWS
 * rather than being skipped - a silently unexpanded glob would silently stop the
 * gate from guarding those packages.
 *
 * @param {string} root
 * @param {string[]} globs
 * @returns {string[]} repo-relative, posix-separated directories
 */
function expandGlobs(root, globs) {
  const dirs = [];
  for (const glob of globs) {
    if (!glob.includes("*")) {
      dirs.push(glob);
      continue;
    }
    if (!glob.endsWith("/*") || glob.slice(0, -2).includes("*")) {
      throw new Error(
        `check-changeset: unsupported workspace glob "${glob}" - extend expandGlobs() rather than leaving those packages unguarded.`,
      );
    }
    const parent = glob.slice(0, -2);
    const parentPath = join(root, parent);
    if (!existsSync(parentPath)) continue;
    for (const entry of readdirSync(parentPath).sort()) {
      if (statSync(join(parentPath, entry)).isDirectory()) dirs.push(`${parent}/${entry}`);
    }
  }
  return dirs;
}

/** Package names changesets is configured to ignore (`.changeset/config.json`). */
function readIgnoredPackages(root) {
  const configPath = join(root, ".changeset", "config.json");
  if (!existsSync(configPath)) return [];
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return Array.isArray(config.ignore) ? config.ignore : [];
}

/**
 * Every workspace package that is actually published, derived from `private`.
 *
 * @param {string} [root]
 * @returns {{ name: string, dir: string }[]}
 */
export function findPublishablePackages(root = process.cwd()) {
  const globs = parseWorkspaceGlobs(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));
  const ignored = new Set(readIgnoredPackages(root));
  const packages = [];
  for (const dir of expandGlobs(root, globs)) {
    const manifestPath = join(root, dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.private === true) continue;
    if (typeof manifest.name !== "string" || ignored.has(manifest.name)) continue;
    packages.push({ name: manifest.name, dir });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when a changed path needs no changeset regardless of where it lives. */
export function isExemptPath(filePath) {
  return EXEMPT_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * The package names a changeset file declares, read from its frontmatter.
 *
 * Narrow by design: `@changesets/parse` is in the dependency graph only as a
 * transitive dep of `@changesets/cli`, so under pnpm's strict layout it is not
 * resolvable from a root script, and adding a direct devDependency to parse a
 * machine-generated three-line frontmatter fails CONTRIBUTING's
 * minimal-dependency test. This reads exactly the `"name": bump` lines
 * `changeset add` writes and ignores everything else.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseChangesetPackages(text) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.trim() !== "---") return [];
  const names = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const release = /^\s*["']?(@?[^"':\s]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line);
    if (release?.[1] !== undefined) names.push(release[1]);
  }
  return names;
}

/**
 * One `git diff --name-status -M` line, split into its status code and paths
 * (a rename lists both the old and the new path).
 *
 * @param {string} raw
 * @returns {{ status: string, paths: string[] }[]}
 */
function parseNameStatus(raw) {
  const changes = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    changes.push({ status: parts[0] ?? "", paths: parts.slice(1) });
  }
  return changes;
}

/** Packages whose non-exempt files changed, mapped to an example changed file. */
function packagesNeedingAChangeset(changes, packages) {
  /** @type {Map<string, string[]>} */
  const needed = new Map();
  for (const change of changes) {
    for (const filePath of change.paths) {
      if (isExemptPath(filePath)) continue;
      const owner = packages.find((pkg) => filePath.startsWith(`${pkg.dir}/`));
      if (owner === undefined) continue;
      const files = needed.get(owner.name) ?? [];
      files.push(filePath);
      needed.set(owner.name, files);
    }
  }
  return needed;
}

/**
 * True for a `changeset version` release diff, which CONSUMES changesets: it
 * deletes `.changeset/*.md` and bumps each package's version and CHANGELOG.
 * Requiring a changeset there would fail the one PR whose whole job is to spend
 * them. No ordinary change deletes a changeset file.
 */
function isReleaseDiff(changes) {
  return changes.some(
    (change) =>
      change.status.startsWith("D") && /^\.changeset\/.+\.md$/.test(change.paths[0] ?? ""),
  );
}

/**
 * Package names declared by changesets ADDED OR MODIFIED IN THIS DIFF. A
 * changeset already sitting on the default branch (this repo carries a dozen
 * unreleased ones) must not satisfy the requirement for a new change.
 */
function packagesDeclaredInDiff(changes) {
  const declared = new Set();
  for (const change of changes) {
    if (change.status.startsWith("D")) continue;
    const filePath = change.paths.at(-1) ?? "";
    if (!/^\.changeset\/.+\.md$/.test(filePath) || filePath === ".changeset/README.md") continue;
    const content = tryGit(["show", `HEAD:${filePath}`]);
    if (content === undefined) continue;
    for (const name of parseChangesetPackages(content)) declared.add(name);
  }
  return declared;
}

function main() {
  const baseRef = resolveBaseRef();
  if (baseRef === undefined) {
    // Same posture as check-golden-append-only: a checkout with no default
    // branch to diff against (fresh clone, no remote) has nothing to compare.
    console.warn(
      `check-changeset: no "${DEFAULT_BRANCH}" ref found; skipping (nothing to diff against).`,
    );
    return;
  }

  const mergeBase = tryGit(["merge-base", baseRef, "HEAD"]) ?? baseRef;
  const changes = parseNameStatus(git(["diff", "--name-status", "-M", mergeBase, "HEAD"]));
  if (isReleaseDiff(changes)) {
    console.log("check-changeset: OK - release diff (changesets consumed), nothing to require.");
    return;
  }
  const packages = findPublishablePackages();
  const needed = packagesNeedingAChangeset(changes, packages);
  const declared = packagesDeclaredInDiff(changes);
  const missing = [...needed.keys()].filter((name) => !declared.has(name)).sort();

  if (missing.length > 0) {
    console.error(
      "check-changeset: publishable package(s) changed with no changeset naming them:\n",
    );
    for (const name of missing) {
      const files = needed.get(name) ?? [];
      console.error(`  ${name}`);
      for (const file of files.slice(0, 5)) console.error(`    ${file}`);
      if (files.length > 5) console.error(`    ... and ${files.length - 5} more`);
    }
    console.error(
      `\nRun \`pnpm changeset\` and commit the generated .changeset/*.md file (vs ${baseRef}).`,
    );
    console.error(
      "Docs-only (*.md), app-only, and test-only changes are exempt - see scripts/check-changeset.mjs.",
    );
    process.exit(1);
  }

  const summary =
    needed.size === 0
      ? "no publishable package changed"
      : `changeset present for ${[...needed.keys()].sort().join(", ")}`;
  console.log(`check-changeset: OK - ${summary} (vs ${baseRef}).`);
}

// Run as a script; stay silent when imported by the self-test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
