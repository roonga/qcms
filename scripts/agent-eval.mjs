#!/usr/bin/env node
// @ts-check
/**
 * The agent builder eval's command line. It settles the key, the filters and the run's own
 * scratch directory before any container starts, then hands the run to Vitest.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

import { scratchPath } from "./agent-scratch.mjs";

export const KEY_VARIABLE = "QCMS_AGENT_API_KEY";

/** Word for word what `apps/api/eval/key.ts` throws; `key.test.ts` fails on drift. */
export const KEY_MISSING_MESSAGE = "Set QCMS_AGENT_API_KEY to run the agent eval";

export const PROJECT = "qcms-api-agent-eval";

export const USAGE = "usage: pnpm agent:eval [--scenario B09,B11] [--safety-only] [--reps n]";

/** Word for word what `apps/api/eval/results.ts` writes; `results.test.ts` fails on drift. */
export const RESULTS_FILE_NAME = "results.json";

/** A repetition Vitest skipped is no pass, so the command has its own code for it. */
export const NOT_RUN_EXIT = 3;

/**
 * How many repetitions the cap left unrun, from the run's own result file. A run that wrote
 * none reports zero, because Vitest's own status already carries that failure.
 *
 * @param {string} directory
 * @returns {number}
 */
export function notRunCount(directory) {
  let results;
  try {
    results = JSON.parse(readFileSync(join(directory, RESULTS_FILE_NAME), "utf8"));
  } catch {
    return 0;
  }
  const counted = results?.summary?.notRun;
  return typeof counted === "number" ? counted : 0;
}

/**
 * @param {readonly string[]} args
 * @returns {{ scenarios?: string; safetyOnly: boolean; reps?: number }}
 */
export function parseArgs(args) {
  /** @type {{ scenarios?: string; safetyOnly: boolean; reps?: number }} */
  const parsed = { safetyOnly: false };
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--scenario") {
      const value = remaining.shift();
      if (value === undefined || value.trim() === "")
        throw new Error("--scenario requires a value");
      parsed.scenarios = value.trim();
    } else if (arg === "--safety-only") {
      parsed.safetyOnly = true;
    } else if (arg === "--reps") {
      const reps = Number(remaining.shift());
      if (!Number.isInteger(reps) || reps < 1) {
        throw new Error("--reps requires a whole number above zero");
      }
      parsed.reps = reps;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @returns {boolean}
 */
export function hasKey(environment) {
  const key = environment[KEY_VARIABLE]?.trim();
  return key !== undefined && key !== "";
}

/**
 * @param {Date} now
 * @param {string} suffix
 * @returns {string}
 */
export function runId(now, suffix) {
  return `${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")}-${suffix}`;
}

/**
 * The run's own facts, passed by name so nothing in the eval shells out for them.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @param {{ id: string; directory: string; gitSha: string; parsed: ReturnType<typeof parseArgs> }} run
 * @returns {NodeJS.ProcessEnv}
 */
export function runEnv(environment, run) {
  return {
    ...environment,
    QCMS_EVAL_RUN_ID: run.id,
    QCMS_EVAL_DIR: run.directory,
    QCMS_EVAL_GIT_SHA: run.gitSha,
    ...(run.parsed.scenarios === undefined ? {} : { QCMS_EVAL_SCENARIOS: run.parsed.scenarios }),
    ...(run.parsed.safetyOnly ? { QCMS_EVAL_SAFETY_ONLY: "1" } : {}),
    ...(run.parsed.reps === undefined ? {} : { QCMS_EVAL_REPS: String(run.parsed.reps) }),
  };
}

/** @returns {string[]} */
export function vitestArgs() {
  return ["exec", "vitest", "run", "--project", PROJECT];
}

/**
 * @param {string} directory
 * @returns {string}
 */
function headSha(directory) {
  try {
    return execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * @param {readonly string[]} args
 * @param {{ directory: string; environment: NodeJS.ProcessEnv; now: Date;
 *   spawn?: (command: string, args: string[], options: object) => { status: number | null } }} context
 * @returns {number}
 */
export function main(args, context) {
  const { directory, environment, now, spawn = spawnSync } = context;
  /** @type {ReturnType<typeof parseArgs>} */
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    stderr.write(
      `agent-eval: ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`,
    );
    return 2;
  }

  // Before the harness, and so before any container: the eval never falls back to the
  // scripted provider and never reports a pass without a real model.
  if (!hasKey(environment)) {
    stderr.write(`${KEY_MISSING_MESSAGE}\n`);
    return 2;
  }

  const id = runId(now, randomBytes(3).toString("hex"));
  const target = scratchPath({ directory, environment, name: `agent-eval-${id}` });
  stdout.write(`agent-eval: ${id}, results in ${target}\n`);

  const result = spawn("pnpm", vitestArgs(), {
    cwd: directory,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: runEnv(environment, { id, directory: target, gitSha: headSha(directory), parsed }),
  });
  const status = result.status ?? 1;
  if (status !== 0) return status;

  const unrun = notRunCount(target);
  if (unrun === 0) return 0;
  stderr.write(
    `agent-eval: ${String(unrun)} repetitions did not run; the run reached its token cap\n`,
  );
  return NOT_RUN_EXIT;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2), { directory: cwd(), environment: env, now: new Date() }));
}
