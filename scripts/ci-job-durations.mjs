#!/usr/bin/env node
// @ts-check
/**
 * Measures the JOB (`started_at` to `completed_at`), never the workflow run, which includes queue time.
 * The job name is matched exactly, so a renamed job contributes no sample to the old figures; `--prefix`
 * instead spans a SET of jobs, which is the only honest figure for a sharded one.
 */

import { execFileSync } from "node:child_process";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "roonga/qcms";

export const DEFAULTS = {
  workflow: "ci.yml",
  branch: "main",
  runs: 20,
};

/** Slack for runs predating the job or skipping it. One API call per run, so also a cost ceiling. */
export const SCAN_FACTOR = 2;

/**
 * @typedef {object} Sample
 * @property {number} runId
 * @property {string} startedAt
 * @property {string} completedAt
 * @property {number} seconds
 */

/**
 * @typedef {object} Summary
 * @property {string} job
 * @property {number} count
 * @property {number} scanned
 * @property {string | undefined} earliest
 * @property {string | undefined} latest
 * @property {number} p50
 * @property {number} p90
 * @property {number} max
 * @property {number} min
 * @property {string[]} namesSeen
 * @property {Sample[]} samples
 */

/**
 * Nearest-rank, not interpolated, so every figure printed is a run that happened.
 *
 * @param {number[]} ascending
 * @param {number} percentile
 * @returns {number}
 */
export function nearestRank(ascending, percentile) {
  if (ascending.length === 0) throw new Error("nearestRank needs at least one sample");
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new Error(`percentile must be in (0, 100], got ${String(percentile)}`);
  }
  const rank = Math.ceil((percentile / 100) * ascending.length);
  return ascending[Math.min(rank, ascending.length) - 1] ?? 0;
}

/**
 * @param {string} startedAt
 * @param {string} completedAt
 * @returns {number}
 */
export function durationSeconds(startedAt, completedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`unparseable timestamps: '${startedAt}' .. '${completedAt}'`);
  }
  return Math.round((end - start) / 1000);
}

/**
 * @param {number} seconds
 * @returns {string}
 */
export function minutes(seconds) {
  return (seconds / 60).toFixed(1);
}

/**
 * @param {string} job
 * @param {Sample[]} samples
 * @param {number} scanned
 * @param {Iterable<string>} [namesSeen]
 * @returns {Summary}
 */
export function summarize(job, samples, scanned, namesSeen = []) {
  const ascending = samples.map((sample) => sample.seconds).sort((a, b) => a - b);
  const dates = samples.map((sample) => sample.startedAt.slice(0, 10)).sort();
  return {
    job,
    count: samples.length,
    scanned,
    earliest: dates[0],
    latest: dates[dates.length - 1],
    p50: ascending.length === 0 ? 0 : nearestRank(ascending, 50),
    p90: ascending.length === 0 ? 0 : nearestRank(ascending, 90),
    max: ascending.length === 0 ? 0 : nearestRank(ascending, 100),
    min: ascending[0] ?? 0,
    namesSeen: [...new Set(namesSeen)].sort(),
    samples,
  };
}

/**
 * @param {Summary} summary
 * @returns {string}
 */
export function render(summary) {
  if (summary.count === 0) {
    const head = `ci-job-durations: no '${summary.job}' job in the last ${String(summary.scanned)} successful runs`;
    if (summary.namesSeen.length === 0) return head;
    // The likeliest cause is a nearly-right name, so answer with the list rather than a guess.
    return [`${head}. Job names seen:`, ...summary.namesSeen.map((name) => `  ${name}`)].join("\n");
  }
  const lines = [
    `${summary.job}: p50 ${minutes(summary.p50)} / p90 ${minutes(summary.p90)} / max ${minutes(summary.max)} minutes`,
    `  ${String(summary.count)} successful runs between ${String(summary.earliest)} and ${String(summary.latest)} (${String(summary.scanned)} scanned), min ${minutes(summary.min)}`,
    "",
  ];
  for (const sample of summary.samples) {
    lines.push(
      `  ${sample.startedAt}  ${String(sample.runId).padStart(11)}  ${minutes(sample.seconds).padStart(5)} min`,
    );
  }
  return lines.join("\n");
}

/**
 * @param {string[]} args
 * @returns {{ job: string; workflow: string; branch: string; runs: number; json: boolean; prefix: boolean }}
 */
export function parseArgs(args) {
  const parsed = { job: "", ...DEFAULTS, json: false, prefix: false };
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--json") parsed.json = true;
    else if (arg === "--prefix") parsed.prefix = true;
    else if (arg === "--workflow") {
      const value = remaining.shift();
      if (value === undefined || value.startsWith("-")) throw new Error(`${arg} needs a value`);
      parsed.workflow = value;
    } else if (arg === "--branch") {
      const value = remaining.shift();
      if (value === undefined || value.startsWith("-")) throw new Error(`${arg} needs a value`);
      parsed.branch = value;
    } else if (arg === "--runs") {
      const value = remaining.shift();
      const count = Number(value);
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error(`--runs needs a positive integer, got '${String(value)}'`);
      }
      parsed.runs = count;
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else if (parsed.job !== "") throw new Error(`only one job name at a time, got '${arg}' too`);
    else parsed.job = arg;
  }
  if (parsed.job === "") {
    throw new Error(
      "usage: pnpm ci:durations <job-name> [--prefix] [--runs N] [--branch B] [--workflow W] [--json]",
    );
  }
  return parsed;
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/**
 * @param {{ workflow: string; branch: string; limit: number }} options
 * @returns {{ databaseId: number; createdAt: string }[]}
 */
export function listSuccessfulRuns({ workflow, branch, limit }) {
  return JSON.parse(
    gh([
      "run",
      "list",
      "--repo",
      REPOSITORY,
      "--workflow",
      workflow,
      "--branch",
      branch,
      "--status",
      "success",
      "--limit",
      String(limit),
      "--json",
      "databaseId,createdAt",
    ]),
  );
}

/**
 * @typedef {object} Job
 * @property {string} name
 * @property {string | null} conclusion
 * @property {string} started_at
 * @property {string | null} completed_at
 */

/**
 * @param {number} runId
 * @returns {Job[]}
 */
export function runJobs(runId) {
  /** @type {{ jobs: Job[] }} */
  const payload = JSON.parse(gh(["api", `repos/${REPOSITORY}/actions/runs/${String(runId)}/jobs`]));
  return payload.jobs;
}

/**
 * Under `prefix` the whole matching set has to have succeeded, so a run where one shard was
 * skipped or red contributes nothing rather than a span measured over a partial suite.
 *
 * @param {Job[]} jobs
 * @param {number} runId
 * @param {string} job
 * @param {boolean} [prefix]
 * @returns {Sample | undefined}
 */
export function sampleFrom(jobs, runId, job, prefix = false) {
  const matches = jobs.filter((candidate) =>
    prefix ? candidate.name.startsWith(job) : candidate.name === job,
  );
  if (matches.length === 0) return undefined;
  if (matches.some((match) => match.conclusion !== "success" || match.completed_at === null)) {
    return undefined;
  }
  const byInstant = (/** @type {string} */ a, /** @type {string} */ b) =>
    Date.parse(a) - Date.parse(b);
  const startedAt = matches.map((match) => match.started_at).sort(byInstant)[0] ?? "";
  const completedAt =
    matches
      .map((match) => /** @type {string} */ (match.completed_at))
      .sort(byInstant)
      .at(-1) ?? "";
  return {
    runId,
    startedAt,
    completedAt,
    seconds: durationSeconds(startedAt, completedAt),
  };
}

/**
 * @param {string[]} args
 * @returns {number}
 */
export function main(args) {
  /** @type {ReturnType<typeof parseArgs>} */
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`ci-job-durations: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  /** @type {Sample[]} */
  const samples = [];
  /** @type {Set<string>} */
  const namesSeen = new Set();
  let scanned = 0;
  try {
    const runs = listSuccessfulRuns({
      workflow: options.workflow,
      branch: options.branch,
      limit: options.runs * SCAN_FACTOR,
    });
    for (const run of runs) {
      if (samples.length >= options.runs) break;
      scanned += 1;
      const jobs = runJobs(run.databaseId);
      for (const candidate of jobs) namesSeen.add(candidate.name);
      const sample = sampleFrom(jobs, run.databaseId, options.job, options.prefix);
      if (sample !== undefined) samples.push(sample);
    }
  } catch (error) {
    console.error(`ci-job-durations: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const label = options.prefix ? `${options.job}*` : options.job;
  const summary = summarize(label, samples, scanned, namesSeen);
  console.log(options.json ? JSON.stringify(summary, null, 2) : render(summary));
  return summary.count === 0 ? 1 : 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2)));
}
