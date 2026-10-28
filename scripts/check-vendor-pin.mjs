#!/usr/bin/env node
// @ts-check
/**
 * Only a version written immediately after a better-auth package name is checked:
 * adjacency is what keeps the false-positive rate at zero, so a version named forty
 * characters from the package is out of reach. It checks the digits only, never whether
 * a cited `file:line` still points at the branch the prose describes.
 *
 * `*.sql` is deliberately out of {@link GLOBS}: a released migration records the version
 * whose behaviour it describes, and forcing that number forward would make it false.
 * Record areas are {@link EXEMPT} paths instead.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

import { VENDORED_SOURCE_PATHSPEC } from "./vendored-source.mjs";

// Node on Windows won't resolve `git` -> `git.exe` via execFile without a shell.
const GIT = process.platform === "win32" ? "git.exe" : "git";

/**
 * Anchored rather than cwd-relative: a run from a subdirectory would open nothing, skip
 * every file through the read guard below, and print OK.
 */
const REPO_ROOT = execFileSync(GIT, ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

export const TRACKED_PREFIXES = ["better-auth", "@better-auth/"];

/**
 * An entry ending in `/` covers everything beneath it; every other entry is one exact
 * file. A plain `startsWith` over the whole list would let a neighbouring `.bak` or
 * `.orig` inherit an exemption written for a single file, and a leaked exemption is
 * invisible: the run prints OK.
 */
export const EXEMPT = [
  // Work orders record what was checked, and when.
  "docs/features/",
  // A changeset describes the release it shipped in, in the past tense.
  ".changeset/",
  // A retrospective is a dated account of what was believed at the time.
  "docs/RETRO.md",
  // Scratch and planning history, excluded by every other gate here.
  "plan/",
  // The lockfile is the source of truth this gate reads, not a claim about it.
  "pnpm-lock.yaml",
];

/**
 * A pathspec with a wildcard is matched with `FNM_PATHNAME` off, so `*` crosses a slash.
 * A pathspec without one is a literal path, which is why the bare `Dockerfile` entry
 * needs the wildcarded spelling beside it to reach past the repository root.
 */
export const GLOBS = [
  "*.md",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.yml",
  "*.yaml",
  "*.sh",
  "*.example",
  "*.Dockerfile",
  "Dockerfile",
  "*/Dockerfile",
  "Dockerfile.*",
  "*/Dockerfile.*",
  "*.tmpl",
];

export function isExempt(file) {
  return EXEMPT.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

/**
 * The leading boundary stops a scoped name matching twice and stops a longer identifier
 * ending in the package name matching at all; the trailing boundary stops a version
 * matching inside a longer one.
 */
const ASSERTION = /(?<![\w@-])(@better-auth\/[a-z0-9-]+|better-auth)[@ ](\d+\.\d+\.\d+)(?![\d.])/g;

export function assertionsIn(text) {
  const found = [];
  text.split("\n").forEach((text_, index) => {
    for (const match of text_.matchAll(ASSERTION)) {
      found.push({ pkg: match[1] ?? "", version: match[2] ?? "", line: index + 1 });
    }
  });
  return found;
}

/**
 * Three key shapes are covered: a quoted scoped name, an unquoted bare one, and a
 * `snapshots:` key carrying a peer suffix in parentheses.
 */
export function resolvedVersions(lock) {
  /** @type {Map<string, Set<string>>} */
  const resolved = new Map();
  const key = /^ {2}'?(@better-auth\/[a-z0-9-]+|better-auth)@(\d+\.\d+\.\d+)['(:]/gm;
  for (const match of lock.matchAll(key)) {
    const pkg = match[1] ?? "";
    const versions = resolved.get(pkg) ?? new Set();
    versions.add(match[2] ?? "");
    resolved.set(pkg, versions);
  }
  return resolved;
}

/** Vendored upstream components are excluded: their contents are not ours to edit. */
function tracked() {
  const out = execFileSync(GIT, ["ls-files", "-z", ...GLOBS, VENDORED_SOURCE_PATHSPEC], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out.split("\0").filter((p) => p !== "");
}

function main() {
  const resolved = resolvedVersions(readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf8"));
  if (resolved.size === 0) {
    console.error(
      "check-vendor-pin: pnpm-lock.yaml resolves no better-auth package. Either the\n" +
        "dependency is gone (delete this gate and the prose it guards) or the lockfile\n" +
        "format moved and `resolvedVersions` needs updating.",
    );
    return 1;
  }

  const violations = [];
  for (const file of tracked()) {
    if (isExempt(file)) continue;
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      // A tracked path that will not open: anchoring to REPO_ROOT keeps this from ever
      // being the whole tree, which is the case that would make the skip dangerous.
      continue;
    }
    if (!TRACKED_PREFIXES.some((p) => text.includes(p))) continue;
    for (const { pkg, version, line } of assertionsIn(text)) {
      const versions = resolved.get(pkg);
      if (versions !== undefined && versions.has(version)) continue;
      const lockfile =
        versions === undefined ? "not in the lockfile at all" : [...versions].sort().join(", ");
      violations.push(`  ${file}:${line}  asserts ${pkg} ${version}  (lockfile: ${lockfile})`);
    }
  }

  if (violations.length === 0) {
    console.log("check-vendor-pin: OK - every asserted better-auth version matches the lockfile.");
    return 0;
  }

  console.error("check-vendor-pin: asserted better-auth version(s) do not match the lockfile:\n");
  for (const violation of violations.slice(0, 50)) console.error(violation);
  if (violations.length > 50) console.error(`  ... and ${violations.length - 50} more`);
  console.error(
    [
      "",
      "These files assert a version of better-auth that the lockfile no longer resolves.",
      "QCMS cites better-auth's compiled source at a file:line to justify security",
      "properties, so a stale number leaves a reader unable to tell which of the two is",
      "wrong. Update the version - and, because this gate checks the digit and not the",
      "citation, RE-READ the cited lines in the new version rather than rewriting the",
      "number alone. A line that moved is exactly what the digit cannot tell you.",
      "",
      "If a mention is a dated record of what was true at the time, it belongs in one of",
      "the record areas in EXEMPT (docs/features/, .changeset/, docs/RETRO.md, plan/),",
      "not in a live file with the number changed. docs/PROJECT_GOAL.md and docs/adr/ are",
      "live text and are scanned. See scripts/check-vendor-pin.mjs.",
    ].join("\n"),
  );
  return 1;
}

// Only when run as a command, so the test can import the pure helpers without the scan
// firing and without `process.exit` killing the run.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
