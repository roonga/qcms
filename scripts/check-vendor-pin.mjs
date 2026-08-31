#!/usr/bin/env node
// @ts-check
/**
 * Vendor-pin gate: a better-auth version asserted in prose matches the lockfile
 * (issue #483, upstream half issue #606).
 *
 * QCMS justifies security properties by citing better-auth's compiled source at a
 * `file:line` - the secure-cookie prefix rule, the `rateLimit.enabled` resolution,
 * the `$ba$<version>$` key envelope. Every one of those claims names the version it
 * was read against, because a claim about a library's internals is only meaningful
 * against a stated version. When the lockfile moves and the prose does not, a reader
 * checking such a claim cannot tell which of the two numbers is the stale one.
 *
 * That is not hypothetical. Issue #447 existed because the lockfile pinned 1.6.26
 * while eight files asserted 1.6.25, and it was defended with a `git log -S` search
 * that structurally could not detect a version bump. Issue #483 proposed this gate;
 * the drift went live when a grouped Dependabot PR carried better-auth from 1.6.26 to
 * 1.7.1 as line 17 of an 18-package table, leaving sixteen files behind.
 *
 * ## What it does
 *
 *   1. Reads the resolved version of `better-auth` and each `@better-auth/*` package
 *      from `pnpm-lock.yaml` (the `packages:` and `snapshots:` keys).
 *   2. Scans tracked prose and source for a version asserted **immediately** after a
 *      better-auth package name: `better-auth 1.7.2`, `better-auth@1.7.2`,
 *      `@better-auth/core 1.7.2`, `@better-auth/core@1.7.2`.
 *   3. Fails on any assertion whose version is not one the lockfile resolves, naming
 *      the file, the line, and both versions.
 *
 * ## Records are exempt, by path
 *
 * A log is allowed to describe a world that no longer exists, and rewriting one
 * corrupts it. `docs/features/061-forced-password-change.md` records the version that
 * was installed when it was drafted, with the date beside it, and that sentence is
 * *true*; forcing it forward to the current pin would make it false. So the
 * dated-record areas are exempt: see {@link EXEMPT}.
 *
 * `docs/PROJECT_GOAL.md` **used to be exempt and is not any more** (Code Owner,
 * 2026-08-31, issue #725). It was named in #483 because that file then mixed
 * append-only ADR history with live decision text, and a superseded ADR-35 paragraph
 * in it named an old version. PR #720 moved the decision record to `docs/adr/`, so
 * what is left there is live decision text and nothing else - which is precisely what
 * this gate exists to check. The exemption was a hole with nothing behind it, and #483
 * caveat 2 always described it as an accepted gap rather than a fit. If a genuinely
 * dated claim ever needs to live in that file, it belongs in a record area instead.
 *
 * **`docs/adr/` is deliberately NOT exempt** either, for the same reason. An exemption
 * is a hole, so a new area gets one only when a real record in it fails the gate. Fail
 * closed by default: the cost of being wrong that way is a build that asks a question,
 * not a document that quietly rots.
 *
 * ## What it cannot see
 *
 * Written down because an unwritten limit is how a gate gets trusted past its reach.
 *
 *   - **A version not adjacent to the package name.** "Passed to better-auth as
 *     `secret`, which in the pinned 1.6.26 means ..." asserts the pin, and this gate
 *     does not match it: the digits are forty characters from the name. Adjacency is
 *     what keeps the false-positive rate at zero, and a gate people disable is worth
 *     less than a gate with a documented gap. Write "better-auth 1.7.2" rather than
 *     "the pinned 1.7.2" and the claim is covered.
 *   - **Whether the cited line is still the right line.** This gate checks the digit.
 *     It cannot check that `dist/cookies/index.mjs:23` still points at the branch the
 *     prose says it does, and that is the more common failure: of the twenty-one
 *     citations carried across the 1.7.1 bump, eight had moved while every behaviour
 *     they described was unchanged. In #447 it went the other way - the reviewer
 *     diffed the two published tarballs and found the cited regions line-identical, so
 *     those stale citations were imprecise from the day they were written rather than
 *     victims of vendor churn. Either way a human reading the vendor is the only thing
 *     that catches it. A bump means re-reading the source, not running `sed`.
 *   - **A package resolved at two versions.** An assertion passes if it matches *any*
 *     resolution, so a tree carrying both 1.7.2 and an older copy would accept prose
 *     naming either. `better-auth` itself resolves once today; the error message
 *     prints the whole set so an ambiguous tree is visible when the gate does fire.
 *
 * ## Why better-auth and nothing else
 *
 * Generalising to arbitrary `<package> <semver>` means deciding what counts as a
 * package mention in prose ("Next 16", "hono 4.13", "R1-R8"), and the false-positive
 * rate is what would get the gate disabled. The list is explicit
 * ({@link TRACKED_PREFIXES}) and short on purpose. `hono` and `pg` are the next
 * candidates on the same test - a version asserted in prose, or a security surface -
 * if the need ever appears.
 *
 * This file writes no stale version beside a package name, so it scans cleanly over
 * itself. `check-vendor-pin.test.ts` interpolates its fixtures for the same reason.
 *
 * Usage:  node scripts/check-vendor-pin.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

// Node on Windows won't resolve `git` -> `git.exe` via execFile without a shell.
const GIT = process.platform === "win32" ? "git.exe" : "git";

/**
 * Repo root, so every path this gate reads is anchored rather than cwd-relative.
 * Without it a run from a subdirectory would fail to open each file, hit the
 * read guard below, skip every one of them and print OK: a gate reporting clean
 * because it read nothing is the worst failure a gate has.
 */
const REPO_ROOT = execFileSync(GIT, ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

/**
 * The package families whose asserted versions this gate checks. A name matches
 * either exactly (`better-auth`) or as a scope prefix (`@better-auth/` covers
 * `@better-auth/core`, `.../utils`, and every adapter).
 */
export const TRACKED_PREFIXES = ["better-auth", "@better-auth/"];

/**
 * Paths whose version mentions are records, not assertions about the current pin.
 *
 * **An entry ending in `/` is a directory and covers everything beneath it; every
 * other entry is one exact file.** The distinction is load-bearing rather than
 * cosmetic: a plain `startsWith` over the whole list would let `docs/RETRO.md.bak`,
 * `docs/RETRO.md.orig` or a generated `pnpm-lock.yaml.old` inherit an exemption
 * written for a single file, and an exemption that leaks is invisible - the run
 * prints OK and nobody looks again. `isExempt` enforces it and the tests pin it.
 *
 * Each entry is a deliberate choice, not an oversight, and each one names a place
 * whose version mentions are dated records. `docs/PROJECT_GOAL.md` was on this list
 * and was removed (issue #725): it holds no ADR history since PR #720, so it is live
 * text and is scanned like any other.
 */
export const EXEMPT = [
  // Work orders record what was checked, and when, per the plan-against-official-docs
  // rule. 056 and 061 both cite 1.6.25 with a drafting date beside it.
  "docs/features/",
  // A changeset describes the release it shipped in, in the past tense.
  ".changeset/",
  // A retrospective is a dated account of what was believed at the time.
  "docs/RETRO.md",
  // Scratch and planning history, excluded by every other gate here for the same
  // reason (see check-no-em-dash.mjs, check-ports.mjs).
  "plan/",
  // The lockfile is the source of truth this gate reads, not a claim about it.
  "pnpm-lock.yaml",
];

const GLOBS = [
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
];

/**
 * Whether a repo-relative path is one whose version mentions are records.
 *
 * A directory entry (trailing `/`) matches by prefix; a file entry matches only
 * itself, so a neighbouring `.bak`, `.orig` or generated copy stays in scope.
 *
 * @param {string} file repo-relative path
 * @returns {boolean}
 */
export function isExempt(file) {
  return EXEMPT.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

/**
 * A better-auth package name written immediately before a version, in either of the
 * two shapes this repo uses: `name@1.2.3` (a specifier) and `name 1.2.3` (prose).
 *
 * The leading boundary stops `@better-auth/core` matching twice (once as the scoped
 * name, once as a bare `better-auth` inside it) and stops a longer identifier ending
 * in `better-auth` matching at all. The trailing boundary keeps `1.7.1` from matching
 * inside `1.7.11`.
 */
const ASSERTION = /(?<![\w@-])(@better-auth\/[a-z0-9-]+|better-auth)[@ ](\d+\.\d+\.\d+)(?![\d.])/g;

/**
 * Every version asserted beside a better-auth package name in one file's text.
 *
 * @param {string} text file contents
 * @returns {{ pkg: string, version: string, line: number }[]}
 */
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
 * The versions `pnpm-lock.yaml` resolves for each tracked package.
 *
 * Reads the two-space-indented keys that head an entry in `packages:` and in
 * `snapshots:`. A scoped name is quoted there (`'@better-auth/core@1.7.2':`), a bare
 * one is not (`better-auth@1.7.2:`), and a snapshot key carries a peer suffix in
 * parentheses; all three shapes are covered.
 *
 * @param {string} lock contents of pnpm-lock.yaml
 * @returns {Map<string, Set<string>>} package name -> resolved versions
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

/**
 * Tracked text files this gate reads. Vendored upstream components are excluded, as
 * they are from every other scan here: their contents are not ours to edit.
 *
 * @returns {string[]}
 */
function tracked() {
  const out = execFileSync(GIT, ["ls-files", "-z", ...GLOBS, ":!packages/ui/src/components/**"], {
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
      // A tracked path that will not open (a dangling symlink, a file deleted in the
      // working tree). Anchoring to REPO_ROOT above means this can no longer be the
      // whole tree, which is the case that would make a skip dangerous.
      continue;
    }
    // Cheap reject before the regex: most files never mention the vendor at all.
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

// Only when run as a command, so `check-vendor-pin.test.ts` can import the pure
// helpers above without the scan firing (and without `process.exit` killing the run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
