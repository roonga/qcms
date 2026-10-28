#!/usr/bin/env node
// @ts-check
/**
 * A wrapper rather than the command as the step: `changeset status` also asks git what
 * changed since its configured base branch, and in CI that branch exists only as a
 * remote ref, so the command exits nonzero on every pull request. This tolerates that
 * one failure, and only after independently confirming the base branch does not
 * resolve here. Every other nonzero exit stays a failure.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** What `@changesets/git` says when the configured base branch does not resolve. */
const UNRESOLVABLE_BASE = /Failed to find where HEAD diverged from/;

/**
 * Defaulted, not required, and to the same value changesets itself defaults to, so
 * this gate's diagnosis matches the command's behaviour rather than merely resembling it.
 */
export function baseBranchFrom(configText) {
  const config = JSON.parse(configText);
  return typeof config.baseBranch === "string" ? config.baseBranch : "master";
}

export function classify({ code, output, baseBranchResolves }) {
  if (code === 0) return "ok";
  if (!baseBranchResolves && UNRESOLVABLE_BASE.test(output)) return "no-base-ref";
  return "failed";
}

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
