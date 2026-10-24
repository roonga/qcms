#!/usr/bin/env node
// @ts-check
/**
 * Fails when the diff against the default branch touches a publishable package and no
 * changeset added in that same diff names it. The publishable set is derived from each
 * package.json's `private` field and the changesets `ignore` list, never hardcoded, so
 * adding a package cannot make this gate stale.
 *
 * Markdown, test directories and colocated test files are exempt: they alter nothing a
 * consumer can call. It compares committed state, so uncommitted work is invisible to it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH ?? "main";

const EXEMPT_PATTERNS = [
  /\.md$/i,
  // `testing/` is intentionally absent: it is an exported subpath consumers import.
  /(^|\/)(__tests__|test|tests|e2e)\//,
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

function resolveBaseRef() {
  for (const ref of [`origin/${DEFAULT_BRANCH}`, DEFAULT_BRANCH]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined) {
      return ref;
    }
  }
  return undefined;
}

/** A narrow reader rather than a YAML dependency: it is a four-line file we own. */
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
      break;
    }
  }
  return globs;
}

/**
 * Exported because `scripts/image-dev-deps.mjs` derives the same workspace manifest set,
 * and a second expander is how the two would come to disagree; its message carries no
 * script prefix because two callers raise it.
 *
 * An unsupported glob shape throws rather than being skipped: a silently unexpanded glob
 * would stop the gate guarding those packages.
 */
export function expandGlobs(root, globs) {
  const dirs = [];
  for (const glob of globs) {
    if (!glob.includes("*")) {
      dirs.push(glob);
      continue;
    }
    if (!glob.endsWith("/*") || glob.slice(0, -2).includes("*")) {
      throw new Error(
        `unsupported workspace glob "${glob}" - extend expandGlobs() rather than leaving those packages unguarded.`,
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

function readIgnoredPackages(root) {
  const configPath = join(root, ".changeset", "config.json");
  if (!existsSync(configPath)) return [];
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return Array.isArray(config.ignore) ? config.ignore : [];
}

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

export function isExemptPath(filePath) {
  return EXEMPT_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Narrow by design: `@changesets/parse` is only a transitive dependency, so under pnpm's
 * strict layout it is not resolvable from a root script, and a direct devDependency for
 * three lines of frontmatter fails the minimal-dependency rule.
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

/** A rename line lists both the old and the new path, and both matter. */
function parseNameStatus(raw) {
  const changes = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    changes.push({ status: parts[0] ?? "", paths: parts.slice(1) });
  }
  return changes;
}

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
 * A release diff consumes changesets, so requiring one would fail the single pull request
 * whose whole job is to spend them. No ordinary change deletes a changeset file.
 */
function isReleaseDiff(changes) {
  return changes.some(
    (change) =>
      change.status.startsWith("D") && /^\.changeset\/.+\.md$/.test(change.paths[0] ?? ""),
  );
}

/**
 * Added or modified in this diff only: a changeset already sitting on the default branch
 * must not satisfy the requirement for a new change.
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
    // A checkout with no default branch to diff against has nothing to compare.
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
