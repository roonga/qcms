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
import { createHash } from "node:crypto";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

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

/**
 * The recorded exceptions: one corpus path whose content the Code Owner has allowed to
 * change, **pinned to the exact SHA-256 the change must produce**.
 *
 * This is the machine half of the exception record in
 * `packages/core/golden/evaluator/CORPUS.md`, and the two name the same file and the same
 * hash on purpose: a reader of the prose and a reader of the gate cannot be told different
 * things. Adding an entry is a Code Owner decision, as both entries in that document were.
 *
 * **A pin permits exactly one content, so it is not a hole.** A modification of a listed
 * path passes only if the new bytes hash to the pinned value; a different edit to the same
 * path, a deletion, a rename, or any change to an unlisted file is refused exactly as
 * before. That is the difference between this and an allowlist: the file is not unguarded
 * afterwards, because the only content it may hold is the one recorded here.
 *
 * The hash is over the bytes **at HEAD**, which is what the diff below is about, rather
 * than over the working tree, which can hold something that was never committed.
 */
export const PINNED_EXCEPTIONS = [
  {
    path: "packages/core/golden/evaluator/scenarios/repeat-every-instance-empty-group.json",
    sha256: "197c0d255e136d17f3e28808e98747cbb634fb301d13ec424bf6f85c607fd425",
    reason: [
      "Q30 (Code Owner, 2026-10-03): a step holding a repeating group counts as a visible",
      "step even when its roster is empty, because the group's own chrome is content a",
      "respondent can act on. Before it, such a step was unreachable - nothing visible",
      "while the roster was empty, the roster empty because the mint is due on the first",
      "serve of the group's own step, that step never served because it was not visible.",
      "Taken under the issue #128 defect-correction precedent rather than a",
      "SEMANTICS_VERSION bump, for the reason that precedent records: the evaluator",
      "implements one version at a time, so a bump would fail every published snapshot",
      "instead of preserving its behaviour. Three fields move - currentStep, visibleSteps",
      "and visibleStepViews - and the other 76 scenarios are untouched. The second",
      "recorded exception in CORPUS.md carries the same reasoning for a human reader.",
    ].join(" "),
  },
];

/** SHA-256 of a byte string, lower-case hex. */
export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * The pinned exception for a path, or `undefined`.
 *
 * Exact path match, like {@link PROSE_EXEMPTIONS}, so a pin cannot leak to a neighbour.
 */
export function pinnedException(filePath, pins = PINNED_EXCEPTIONS) {
  return pins.find((pin) => pin.path === filePath);
}

/**
 * The forbidden changes in a diff, as `status\tpath` lines.
 *
 * Pure, so the test can drive it without a repository: `changes` is the parsed
 * `--name-status` output and `contentsAt` returns the bytes a path holds at HEAD, or
 * `undefined` when they cannot be read.
 *
 * Only a MODIFICATION can be excused by a pin. A deletion or a rename removes the path a
 * pin names, so no hash could describe the result and neither is ever permitted.
 */
export function violationsIn(changes, contentsAt, pins = PINNED_EXCEPTIONS) {
  const violations = [];
  for (const change of changes) {
    const code = change.status[0] ?? "";
    if (code === "A") {
      continue; // additions are always allowed
    }
    for (const filePath of change.paths) {
      if (!isGuarded(filePath)) {
        continue;
      }
      if (code === "M") {
        const pin = pinnedException(filePath, pins);
        const contents = pin === undefined ? undefined : contentsAt(filePath);
        if (pin !== undefined && contents !== undefined && sha256(contents) === pin.sha256) {
          continue;
        }
      }
      violations.push(`${change.status}\t${filePath}`);
    }
  }
  return violations;
}

/** One `--name-status -M` line, split into its status code and paths. */
export function parseNameStatus(raw) {
  const changes = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parts = line.split("\t");
    changes.push({ status: parts[0] ?? "", paths: parts.slice(1) });
  }
  return changes;
}

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

/**
 * A file's exact bytes at a revision, **untrimmed**, or `undefined` when it has none
 * there.
 *
 * Its own reader rather than {@link tryGit}, and the reason is a hash: `git` above trims
 * its output, which is right for a ref name or a diff and wrong for file content, because
 * a stripped trailing newline hashes to something the file never had. The first version
 * of the pin check used `tryGit` and refused the very commit it was written for.
 */
function fileAt(revision, filePath) {
  try {
    return execFileSync("git", ["show", `${revision}:${filePath}`], { encoding: "utf8" });
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
    return 0;
  }

  const mergeBase = tryGit(["merge-base", baseRef, "HEAD"]) ?? baseRef;

  // --name-status over the merge base: one line per change, e.g.
  //   A\tpath        (added - allowed)
  //   M\tpath        (modified - forbidden under golden/, unless a pin names it)
  //   D\tpath        (deleted - forbidden)
  //   R100\told\tnew (renamed - forbidden: the old golden path is gone)
  //
  // For renames/copies (R/C) git lists <old>\t<new>; both paths matter, because a
  // rename deletes the old golden. For M/D there is a single path.
  const changes = parseNameStatus(git(["diff", "--name-status", "-M", mergeBase, "HEAD"]));
  // The bytes at HEAD, which is what the diff is about. `git show` rather than a file
  // read, so a working tree holding something uncommitted cannot satisfy a pin.
  const violations = violationsIn(changes, (filePath) => fileAt("HEAD", filePath));

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
        "  A committed scenario the Code Owner has allowed to change is HASH-PINNED in",
        "    PINNED_EXCEPTIONS above and recorded in CORPUS.md. A pin permits exactly one",
        "    content, so a different edit to a pinned path lands here too - which is what",
        "    you are reading if you changed one and the hash no longer matches.",
        "",
      ].join("\n"),
    );
    return 1;
  }

  const pinned = PINNED_EXCEPTIONS.map((pin) => pin.path);
  const note =
    pinned.length === 0
      ? ""
      : ` (${String(pinned.length)} recorded exception(s), hash-pinned: ${pinned.join(", ")})`;
  console.log(
    `check-golden-append-only: OK - no golden files modified or deleted vs ${baseRef}${note}.`,
  );
  return 0;
}

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
