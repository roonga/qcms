#!/usr/bin/env node
// @ts-check
/**
 * Append-only guard for the A2UI golden corpus (task 012, ADR-18).
 *
 * The stored compiled A2UI is immutable and served forever (R1, ADR-18), so its
 * golden documents are a permanent record: once committed, a golden is never
 * edited or deleted — a breaking A2UI change adds documents under a new spec
 * version instead (see `packages/a2ui-compiler/golden/README.md`).
 *
 * This script fails the build if the diff against the default branch **modifies,
 * deletes, or renames** any file under a guarded `golden/` directory. Adding new
 * golden files is always allowed. It is a git-history guard, not a content test:
 * `pnpm test` already asserts the goldens match live compiler output.
 *
 * Usage:  node scripts/check-golden-append-only.mjs
 * Env:    DEFAULT_BRANCH (default "main") — the branch additions are diffed against.
 */

import { execFileSync } from "node:child_process";

/**
 * Path prefixes under which every committed file is append-only. This guards the
 * versioned corpus directories (`golden/v1/`, `golden/v2/`, …) — the immutable
 * data — but deliberately NOT `golden/README.md`, whose own prose must stay
 * editable to record each new spec version (workshop retro, Stage 6: the guard
 * froze the README it tells you to update).
 */
const GUARDED_PREFIXES = ["packages/a2ui-compiler/golden/v"];

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH ?? "main";

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

function isGuarded(filePath) {
  return GUARDED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function main() {
  const baseRef = resolveBaseRef();
  if (baseRef === undefined) {
    // No default branch to compare against (e.g. a fresh clone with no remote).
    // Nothing to guard rather than a hard failure — CI always has origin/main.
    console.warn(
      `check-golden-append-only: no "${DEFAULT_BRANCH}" ref found; skipping (nothing to diff against).`,
    );
    return;
  }

  const mergeBase = tryGit(["merge-base", baseRef, "HEAD"]) ?? baseRef;

  // --name-status over the merge base: one line per change, e.g.
  //   A\tpath        (added — allowed)
  //   M\tpath        (modified — forbidden under golden/)
  //   D\tpath        (deleted — forbidden)
  //   R100\told\tnew (renamed — forbidden: the old golden path is gone)
  const raw = git(["diff", "--name-status", "-M", mergeBase, "HEAD"]);
  const violations = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    const code = status[0] ?? "";
    if (code === "A") {
      continue; // additions are always allowed
    }
    // For renames/copies (R/C) git lists <old>\t<new>; both paths matter — a
    // rename deletes the old golden. For M/D there is a single path.
    const paths = parts.slice(1);
    for (const filePath of paths) {
      if (isGuarded(filePath)) {
        violations.push(`${status}\t${filePath}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      "check-golden-append-only: the golden corpus is APPEND-ONLY (ADR-18) — a committed",
    );
    console.error("golden is never modified or deleted. The following changes are forbidden:\n");
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    console.error(
      "\nIf a compiler change altered this output, revert it or bump the A2UI spec version",
    );
    console.error(
      "(add a v2/ directory, leave v1/ untouched) — see packages/a2ui-compiler/golden/README.md.",
    );
    process.exit(1);
  }

  console.log(`check-golden-append-only: OK — no golden files modified or deleted vs ${baseRef}.`);
}

main();
