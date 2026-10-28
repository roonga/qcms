#!/usr/bin/env node
// @ts-check
/**
 * A git-history guard, not a content test: the corpora are frozen records (ADR-18,
 * ADR-16 invariant I7) and only additions are allowed.
 *
 * The diff basis is the merge base with the default branch, so anything already on that
 * branch is history this guard does not re-examine. That is what keeps a recorded
 * exception from becoming a permanent red.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The `golden/v` prefix stops at the versioned data directories on purpose, so the
 * README a new spec version has to be recorded in stays editable.
 */
const GUARDED_PREFIXES = ["packages/a2ui-compiler/golden/v", "packages/core/golden/evaluator/"];

/**
 * Exact repo-relative paths, so an exemption cannot leak to a neighbour. Freezing
 * `CORPUS.md` would freeze the document a future amendment has to be written into.
 */
const PROSE_EXEMPTIONS = new Set(["packages/core/golden/evaluator/CORPUS.md"]);

/**
 * A pin permits exactly one content, so it is not a hole: a listed path passes only if
 * the new bytes hash to the pinned value, and a deletion or rename is still refused.
 * Adding an entry is a Code Owner decision, mirrored in that corpus's `CORPUS.md`.
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
      "and visibleStepViews - and the other 58 scenarios are untouched. The second",
      "recorded exception in CORPUS.md carries the same reasoning for a human reader.",
    ].join(" "),
  },
];

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function pinnedException(filePath, pins = PINNED_EXCEPTIONS) {
  return pins.find((pin) => pin.path === filePath);
}

/**
 * Only a modification can be excused by a pin: a deletion or a rename removes the path
 * a pin names, so no hash could describe the result.
 */
export function violationsIn(changes, contentsAt, pins = PINNED_EXCEPTIONS) {
  const violations = [];
  for (const change of changes) {
    const code = change.status[0] ?? "";
    if (code === "A") {
      continue;
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
 * Untrimmed, and so its own reader rather than {@link tryGit}: trimming file content
 * strips a trailing newline, and the result hashes to something the file never had.
 */
function fileAt(revision, filePath) {
  try {
    return execFileSync("git", ["show", `${revision}:${filePath}`], { encoding: "utf8" });
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

function isGuarded(filePath) {
  if (PROSE_EXEMPTIONS.has(filePath)) {
    return false;
  }
  return GUARDED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function main() {
  const baseRef = resolveBaseRef();
  if (baseRef === undefined) {
    // No default branch to compare against: nothing to guard rather than a hard failure,
    // since CI always has one.
    console.warn(
      `check-golden-append-only: no "${DEFAULT_BRANCH}" ref found; skipping (nothing to diff against).`,
    );
    return 0;
  }

  const mergeBase = tryGit(["merge-base", baseRef, "HEAD"]) ?? baseRef;

  // For a rename or copy git lists both paths, and both matter: a rename deletes the old
  // golden.
  const changes = parseNameStatus(git(["diff", "--name-status", "-M", mergeBase, "HEAD"]));
  // `git show` rather than a file read, so a working tree holding something uncommitted
  // cannot satisfy a pin.
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

// Only when run as a command, so the test can import the helpers without the scan firing
// and without `process.exit` killing the run.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
