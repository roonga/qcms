#!/usr/bin/env node
// @ts-check
/**
 * `changeset status` succeeds, so the first `changeset version` can run (issue #797).
 *
 * ## What this catches
 *
 * `changeset status` assembles the release plan the release run will execute, and it
 * refuses a changeset whose frontmatter names something it cannot release. The repo
 * carried one for weeks: `.changeset/dev-seed-command.md` named `"qcms"`, the ROOT
 * manifest's name, which is private and is not a workspace member at all, so
 * `assembleReleasePlan` threw `Found changeset dev-seed-command for package qcms which
 * is not in the workspace` and exited nonzero.
 *
 * Nothing ran `changeset status`, so that was invisible: `check:changeset` asks whether
 * a changeset NAMING a changed package exists, never whether the set of changesets is
 * releasable. The two questions look alike and only one of them was gated. The cost of
 * the gap is paid entirely at the release, which is the worst moment to discover that a
 * changeset written months earlier has to be rewritten or dropped.
 *
 * ## Why this is a wrapper rather than `changeset status` as the step
 *
 * `changeset status` does two things, in this order: it assembles the release plan (the
 * property above), and then it asks git which packages changed since `baseBranch` in
 * order to warn when a change carries no changeset at all. The second half needs
 * `main` to resolve as a ref, and in CI it does not: `actions/checkout` leaves a pull
 * request on a detached HEAD with the branches fetched only as `refs/remotes/origin/*`,
 * and `main` is not among the names `git rev-parse` tries. `git merge-base main HEAD`
 * then fails with `Not a valid object name main`, `@changesets/git` turns that into
 * `Failed to find where HEAD diverged from "main"`, and the command exits nonzero on
 * every pull request whatever the changesets say. A gate that is always red is not a
 * gate.
 *
 * So this refuses that ONE failure, and only when it has independently established the
 * cause: the base branch named by `.changeset/config.json` does not resolve in this
 * checkout. Every other nonzero exit is a failure, which keeps the gate fail-closed.
 * Nothing is lost by declining the second half - `check:changeset` already answers
 * "changed without a changeset", against `origin/main` rather than `main`, with this
 * repository's own exemptions.
 *
 * Usage: node scripts/check-changeset-status.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** What `@changesets/git` says when the configured base branch does not resolve. */
const UNRESOLVABLE_BASE = /Failed to find where HEAD diverged from/;

/**
 * The branch `changeset status` diffs against, from the changesets config.
 *
 * Defaulted rather than required, because changesets itself defaults it: a config with
 * no `baseBranch` is valid and means `master` upstream. Reading the file and falling
 * back to the same default keeps this gate's diagnosis identical to the command's own
 * behaviour instead of merely similar.
 *
 * @param {string} configText
 * @returns {string}
 */
export function baseBranchFrom(configText) {
  const config = JSON.parse(configText);
  return typeof config.baseBranch === "string" ? config.baseBranch : "master";
}

/**
 * What a `changeset status` run means, given whether its base branch resolves here.
 *
 * @param {{ code: number, output: string, baseBranchResolves: boolean }} run
 * @returns {"ok" | "no-base-ref" | "failed"}
 */
export function classify({ code, output, baseBranchResolves }) {
  if (code === 0) return "ok";
  if (!baseBranchResolves && UNRESOLVABLE_BASE.test(output)) return "no-base-ref";
  return "failed";
}

/**
 * @param {string} ref
 * @returns {boolean}
 */
function refResolves(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/** @returns {number} process exit code */
function main() {
  const baseBranch = baseBranchFrom(readFileSync(".changeset/config.json", "utf8"));
  const baseBranchResolves = refResolves(baseBranch);

  const run = spawnSync("pnpm", ["exec", "changeset", "status"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const verdict = classify({ code: run.status ?? 1, output, baseBranchResolves });

  if (verdict === "ok") {
    console.log("check-changeset-status: OK - the release plan assembles.");
    return 0;
  }

  if (verdict === "no-base-ref") {
    console.log(
      `check-changeset-status: OK - the release plan assembles. ` +
        `("${baseBranch}" does not resolve in this checkout, so changeset status could not ` +
        `also run its changed-since-base warning; check:changeset covers that question.)`,
    );
    return 0;
  }

  console.error("check-changeset-status: `changeset status` failed:\n");
  console.error(output.trimEnd());
  console.error(
    [
      "",
      "The release plan does not assemble, so `changeset version` cannot run. A changeset",
      "may name a package that is not a workspace member (the ROOT manifest's own name is",
      "the one that has happened), or one that `.changeset/config.json` ignores. Fix the",
      "frontmatter of the named file, or delete it when the change it describes reaches no",
      "publishable package.",
      "",
    ].join("\n"),
  );
  return 1;
}

// Run as a script; stay silent when imported by the self-test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
