#!/usr/bin/env node
// @ts-check
/**
 * Resolve this lane's private scratch directory, and a run-fresh path inside it
 * (issues #396, #602).
 *
 * The harness advertises its scratchpad as session-specific. It is not. One directory
 * per repository checkout is reused by every session and every subagent that opens it,
 * so `/tmp/.../scratchpad` was found holding logs from other lanes and other days. The
 * filenames a gate naturally produces are the ones every lane picks independently -
 * `verify.log`, `forced.log`, `browser.log`, `pr-body.md` - so two lanes writing "the
 * obvious name" write the same file. Two failures follow, and the second is the
 * dangerous one:
 *
 * - **Interleaving.** Two concurrent browser suites wrote one `browser.log`, and its
 *   tail showed one lane's seat refusal inside the other lane's evidence (#396, which
 *   records four occurrences, `pr-body.md` clobbered twice).
 * - **A stale read.** A lane found `verify.log` and `forced.log` already present, left
 *   by an earlier lane, and briefly read a result from a previous day as its own run's
 *   output (#602). A stale green is indistinguishable from this run's green unless
 *   somebody thinks to check an mtime, and the artifact in question is the evidence a
 *   merge verdict rests on.
 *
 * The convention this implements is the one that was already working in practice: a
 * lane writes under a private subdirectory named for its branch, never the shared root.
 * The branch is the right key because the branch **is** the claim (`CONTRIBUTING.md`,
 * "Git and PR rules"), so exactly one executor lane owns it at a time. An agent that is
 * not that lane's executor - a reviewer running the gates independently on the same
 * branch - sets `QCMS_AGENT_LANE` to a distinct value rather than sharing the directory.
 *
 * Given a file name, the path is also made **run-fresh**: any file already at that path
 * is removed before the path is printed. So a log read back after the command that was
 * supposed to write it either holds this run's output or does not exist, which is a
 * clear failure rather than a silent stale read. That is #602's second acceptance
 * criterion, and it is why the file form exists at all.
 *
 * Usage:
 *   dir=$(node scripts/agent-scratch.mjs)              # this lane's directory
 *   log=$(node scripts/agent-scratch.mjs verify.log)   # a run-fresh path in it
 *   pnpm verify > "$log" 2>&1; rc=$?; echo "EXIT=$rc"
 *
 *   --lane <name>   override the lane key (default: the branch, or QCMS_AGENT_LANE)
 *   --print-lane    print the lane key instead of a path
 *
 * Environment:
 *   QCMS_AGENT_LANE          lane key, when the branch is not the right one
 *   QCMS_AGENT_SCRATCH_ROOT  scratch root (default: $TMPDIR/qcms-agent-scratch)
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { argv, cwd, env } from "node:process";
import { pathToFileURL } from "node:url";

/** Where lane directories live when nothing overrides it. */
export const DEFAULT_ROOT_NAME = "qcms-agent-scratch";

/**
 * A lane key safe to use as one path segment: lowercase, alphanumerics and hyphens
 * only, no leading or trailing hyphen, and bounded so a long branch name cannot push
 * the path past a filesystem limit.
 *
 * `fix/agent-infra` becomes `fix-agent-infra`. The slug is deliberately lossy and two
 * branches could in principle collide in it; that is acceptable here because the branch
 * namespace is `feat/NNN-slug` and `fix/NN-slug`, where the number leads and is unique.
 *
 * @param {string} name
 * @returns {string}
 */
export function laneSlug(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (slug === "") throw new Error(`lane name has no usable characters: '${name}'`);
  return slug;
}

/**
 * The lane key for a working directory: `QCMS_AGENT_LANE` when set, otherwise the
 * checked-out branch. A detached HEAD keys on its short SHA rather than falling back to
 * a shared name, because a shared fallback is the defect this file exists to remove.
 *
 * @param {string} directory
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string}
 */
export function resolveLane(directory, environment) {
  const override = environment.QCMS_AGENT_LANE?.trim();
  if (override !== undefined && override !== "") return laneSlug(override);

  /** @param {string[]} args */
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  let branch;
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    throw new Error(
      `not a git working tree: ${directory}. Run this from a worktree, or set QCMS_AGENT_LANE.`,
    );
  }
  if (branch === "HEAD") return laneSlug(`detached-${git(["rev-parse", "--short", "HEAD"])}`);
  return laneSlug(branch);
}

/**
 * The scratch root, from the environment or the platform temp directory.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string}
 */
export function resolveRoot(environment) {
  const configured = environment.QCMS_AGENT_SCRATCH_ROOT?.trim();
  if (configured !== undefined && configured !== "") return resolve(configured);
  return join(tmpdir(), DEFAULT_ROOT_NAME);
}

/**
 * Create this lane's directory and return the path to print.
 *
 * With no `name`, that is the directory itself. With one, it is a run-fresh path inside
 * it: an existing file there is removed first, so nothing a previous run left can be
 * read back as this run's output.
 *
 * @param {{ directory: string; environment: NodeJS.ProcessEnv; lane?: string; name?: string; printLane?: boolean }} options
 * @returns {string}
 */
export function scratchPath({ directory, environment, lane, name, printLane = false }) {
  const key = lane === undefined ? resolveLane(directory, environment) : laneSlug(lane);
  if (printLane) return key;

  const laneDirectory = join(resolveRoot(environment), key);
  mkdirSync(laneDirectory, { recursive: true });
  if (name === undefined) return laneDirectory;

  // One path segment only. A name carrying a separator would reach outside the lane
  // directory, which would reintroduce exactly the sharing this removes.
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new Error(`file name must be a single path segment, got '${name}'`);
  }
  const file = join(laneDirectory, name);
  rmSync(file, { force: true, recursive: true });
  return file;
}

/**
 * @param {string[]} args
 * @returns {{ lane?: string; name?: string; printLane: boolean }}
 */
export function parseArgs(args) {
  /** @type {{ lane?: string; name?: string; printLane: boolean }} */
  const parsed = { printLane: false };
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--lane") {
      const value = remaining.shift();
      if (value === undefined) throw new Error("--lane requires a value");
      parsed.lane = value;
    } else if (arg === "--print-lane") {
      parsed.printLane = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (parsed.name === undefined) {
      parsed.name = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

/**
 * @param {string[]} args
 * @param {string} directory
 * @param {NodeJS.ProcessEnv} environment
 * @returns {number}
 */
export function main(args, directory, environment) {
  try {
    const { lane, name, printLane } = parseArgs(args);
    console.log(scratchPath({ directory, environment, lane, name, printLane }));
    return 0;
  } catch (error) {
    console.error(`agent-scratch: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main(argv.slice(2), cwd(), env));
}
