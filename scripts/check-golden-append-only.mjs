#!/usr/bin/env node
// @ts-check
/**
 * Append-only guard for the golden corpora (task 012, ADR-18 and ADR-16).
 *
 * Two corpora are frozen records rather than fixtures, for two different reasons,
 * and both are guarded here:
 *
 *   - **A2UI compiled documents** (`packages/a2ui-compiler/golden/v*`). The stored
 *     compiled A2UI is immutable and served forever (R1, ADR-18), so a committed
 *     golden is never edited or deleted: a breaking A2UI change adds documents
 *     under a new spec version instead (`packages/a2ui-compiler/golden/README.md`).
 *   - **Evaluator semantics** (`packages/core/golden/evaluator/`). The forward-pass
 *     rule semantics are frozen under `SEMANTICS_VERSION` (ADR-16, invariant I7), so
 *     a scenario whose `expected` block changes is a semantics change: revert it, or
 *     carry it on a version bump. Until issue #727 that rule existed only as prose in
 *     that corpus's own `CORPUS.md`, which is exactly the state R8's ports rule was in
 *     when it drifted.
 *
 * This script fails the build if the diff against the default branch **modifies,
 * deletes, or renames** any file under a guarded prefix. Adding new golden files is
 * always allowed. It is a git-history guard, not a content test: `pnpm test` and
 * `pnpm test:golden-drift` already assert both corpora match live output.
 *
 * **It guards changes, never committed history.** The diff basis is the merge base
 * with the default branch, so anything already on that branch is history the guard
 * does not re-examine. That is what lets the corpus carry the one recorded Code Owner
 * exception (issue #128, `answered-falsy-values`, amended in place on 2026-08-31)
 * without this gate turning it into a permanent red.
 *
 * Usage:  node scripts/check-golden-append-only.mjs
 * Env:    DEFAULT_BRANCH (default "main") - the branch additions are diffed against.
 */

import { execFileSync } from "node:child_process";

/**
 * Path prefixes under which every committed file is append-only.
 *
 * `packages/a2ui-compiler/golden/v` deliberately names the versioned corpus
 * directories (`golden/v1/`, `golden/v2/`, …) - the immutable data - and so is
 * already shaped to leave `golden/README.md` editable, whose prose must record each
 * new spec version (workshop retro, Stage 6: the guard froze the README it tells you
 * to update).
 *
 * The evaluator corpus keeps its prose beside its data instead, so the same property
 * needs the explicit exemption below rather than a prefix that happens to miss it.
 */
const GUARDED_PREFIXES = ["packages/a2ui-compiler/golden/v", "packages/core/golden/evaluator/"];

/**
 * Files inside a guarded prefix that are prose about the corpus, not corpus data.
 *
 * Exact repo-relative paths, so an exemption cannot leak to a neighbour. `CORPUS.md`
 * states the append-only rule, the `SEMANTICS_VERSION` bump procedure, and the record
 * of exceptions granted - a guard that froze it would freeze the document a future
 * amendment has to be written into, which is the Stage 6 mistake one directory over.
 */
const PROSE_EXEMPTIONS = new Set(["packages/core/golden/evaluator/CORPUS.md"]);

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
  if (PROSE_EXEMPTIONS.has(filePath)) {
    return false;
  }
  return GUARDED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function main() {
  const baseRef = resolveBaseRef();
  if (baseRef === undefined) {
    // No default branch to compare against (e.g. a fresh clone with no remote).
    // Nothing to guard rather than a hard failure - CI always has origin/main.
    console.warn(
      `check-golden-append-only: no "${DEFAULT_BRANCH}" ref found; skipping (nothing to diff against).`,
    );
    return;
  }

  const mergeBase = tryGit(["merge-base", baseRef, "HEAD"]) ?? baseRef;

  // --name-status over the merge base: one line per change, e.g.
  //   A\tpath        (added - allowed)
  //   M\tpath        (modified - forbidden under golden/)
  //   D\tpath        (deleted - forbidden)
  //   R100\told\tnew (renamed - forbidden: the old golden path is gone)
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
    // For renames/copies (R/C) git lists <old>\t<new>; both paths matter - a
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
      "check-golden-append-only: the golden corpora are APPEND-ONLY (ADR-16, ADR-18) - a",
    );
    console.error(
      "committed golden is never modified or deleted. The following changes are forbidden:\n",
    );
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    console.error(
      [
        "",
        "Adding new golden files is always allowed; changing a committed one is not.",
        "",
        "  packages/a2ui-compiler/golden/v*   the served compiled A2UI (R1, ADR-18). If a",
        "    compiler change altered this output, revert it or bump the A2UI spec version:",
        "    add a v2/ directory and leave v1/ untouched. See that corpus's README.md.",
        "",
        "  packages/core/golden/evaluator/    the frozen rule semantics (ADR-16, I7). If an",
        "    evaluator change altered an expected FlowState, it changed the semantics:",
        "    revert it, or carry it on a SEMANTICS_VERSION bump with the ADR that justifies",
        "    it. See that corpus's CORPUS.md, which this guard leaves editable.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`check-golden-append-only: OK - no golden files modified or deleted vs ${baseRef}.`);
}

main();
