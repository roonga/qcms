#!/usr/bin/env node
// @ts-check
/**
 * A wrapper because `changeset status` exits nonzero in CI, where the base branch exists only as
 * a remote ref. That one failure is tolerated, only after confirming the base does not resolve.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** What `@changesets/git` says when the configured base branch does not resolve. */
const UNRESOLVABLE_BASE = /Failed to find where HEAD diverged from/;

/**
 * Defaulted, not required, and to the same value changesets itself defaults to, so
 * this gate's diagnosis matches the command's behaviour rather than merely resembling it.
 *
 * @param {string} configText
 * @returns {string}
 */
export function baseBranchFrom(configText) {
  const config = JSON.parse(configText);
  return typeof config.baseBranch === "string" ? config.baseBranch : "master";
}

/**
 * @param {{ code: number, output: string, baseBranchResolves: boolean }} run
 * @returns {"ok" | "no-base-ref" | "failed"}
 */
export function classify({ code, output, baseBranchResolves }) {
  if (code === 0) return "ok";
  if (!baseBranchResolves && UNRESOLVABLE_BASE.test(output)) return "no-base-ref";
  return "failed";
}

/**
 * How to invoke `pnpm exec changeset status`, per platform.
 *
 * `pnpm` on Windows is `pnpm.cmd`, which Node refuses to start without a shell, so that
 * branch hands the whole line to one and lets `PATHEXT` resolve the shim. One string
 * rather than argv plus `shell`, which is deprecated (DEP0190).
 *
 * @param {NodeJS.Platform} platform
 * @returns {{ command: string, args: string[], shell: boolean }}
 */
export function statusInvocation(platform) {
  const args = ["exec", "changeset", "status"];
  if (platform !== "win32") return { command: "pnpm", args, shell: false };
  return { command: ["pnpm", ...args].join(" "), args: [], shell: true };
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

/** @returns {number} */
function main() {
  const baseBranch = baseBranchFrom(readFileSync(".changeset/config.json", "utf8"));
  const baseBranchResolves = refResolves(baseBranch);

  const invocation = statusInvocation(process.platform);
  /** @type {import("node:child_process").SpawnSyncOptionsWithStringEncoding} */
  const options = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: invocation.shell,
  };
  // Argv is omitted in the shell case, so DEP0190 never fires.
  const run = invocation.shell
    ? spawnSync(invocation.command, options)
    : spawnSync(invocation.command, invocation.args, options);
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
