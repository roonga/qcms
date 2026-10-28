#!/usr/bin/env node
// @ts-check
/**
 * The harness calls its scratchpad session-specific, but one directory per checkout is shared by
 * every session. The lane key is the branch, and a named path is made run-fresh so a stale file
 * cannot pass as this run's output.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { argv, cwd, env } from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_ROOT_NAME = "qcms-agent-scratch";

/**
 * Bounded so a long branch name cannot push the path past a filesystem limit. The slug
 * is lossy, which is safe only because the branch namespace leads with a unique number.
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
 * A detached HEAD keys on its short SHA rather than a shared fallback name, since a
 * shared fallback is the defect this file exists to remove.
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
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string}
 */
export function resolveRoot(environment) {
  const configured = environment.QCMS_AGENT_SCRATCH_ROOT?.trim();
  if (configured !== undefined && configured !== "") return resolve(configured);
  return join(tmpdir(), DEFAULT_ROOT_NAME);
}

/**
 * @param {{ directory: string; environment: NodeJS.ProcessEnv; lane?: string; name?: string; printLane?: boolean }} options
 * @returns {string}
 */
export function scratchPath({ directory, environment, lane, name, printLane = false }) {
  const key = lane === undefined ? resolveLane(directory, environment) : laneSlug(lane);
  if (printLane) return key;

  const laneDirectory = join(resolveRoot(environment), key);
  mkdirSync(laneDirectory, { recursive: true });
  if (name === undefined) return laneDirectory;

  // One path segment only: a separator would reach outside the lane directory.
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
