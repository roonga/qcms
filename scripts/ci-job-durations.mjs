#!/usr/bin/env node
// @ts-check
/**
 * Print how long a CI job actually takes, from the runs GitHub already has (issue #858).
 *
 * `CONTRIBUTING.md` quotes a p50 and a max for the `browser-e2e` job so that a
 * contributor knows whether a half-hour run is normal or a hang. That number has gone
 * stale three times (issues #299, #744, #858), always the same way: the suite grows with
 * every spec that lands, nobody re-measures, and the sentence quietly turns a typical run
 * into an anomaly. The measurement itself was never hard - a run list and a jobs call -
 * but it was six commands and a pile of date arithmetic, which is enough friction that it
 * was only ever done when somebody filed an issue about it.
 *
 * So this is the refresh, in one command. It reads successful workflow runs on a branch,
 * asks each for the named job, and reports the durations plus p50, p90 and max. Nothing
 * is cached and nothing is committed: the answer is always derived from the API, because
 * a stored number is exactly what goes stale.
 *
 * Two things it deliberately does not do. It does not average across a job rename - it
 * matches the job name exactly, so a run predating a rename simply contributes no sample
 * and is reported as such, rather than being silently blended into figures for a
 * differently-scoped job (`portal-e2e` became `browser-e2e` on 2026-09-06, issue #493).
 * And it measures the JOB, from `started_at` to `completed_at`, not the workflow run: the
 * run includes queue time behind other jobs on a single runner, which tells a contributor
 * nothing about what a local invocation will cost.
 *
 * Percentiles use the nearest-rank method on the ascending samples - the p50 of an even
 * sample count is a real observed run rather than the mean of two, which keeps every
 * printed figure a duration that genuinely happened. With sample counts this small,
 * interpolating would invent precision the data does not carry.
 *
 * Usage:
 *   pnpm ci:durations browser-e2e
 *   pnpm ci:durations browser-e2e --runs 20
 *   pnpm ci:durations "verify (node-24)" --branch main --workflow ci.yml --json
 *
 * The job name is matched exactly, and a matrix job's real name carries its suffix
 * (`verify (node-24)`, not `verify`), so quote anything with a space in it. Guessing
 * wrong is cheap rather than confusing: a run that carries no such job contributes no
 * sample, and a search that finds none reports the names it did see.
 *
 * Requires an authenticated `gh`. Exit code: 0 when samples were found, 1 when none were,
 * 2 on a usage error or a failed `gh` call.
 */

import { execFileSync } from "node:child_process";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

/** The repository these figures are about. */
export const REPOSITORY = "roonga/qcms";

/** Defaults, all overridable; `runs` is a sample target rather than a scan depth. */
export const DEFAULTS = {
  workflow: "ci.yml",
  branch: "main",
  runs: 20,
};

/**
 * How many successful workflow runs to inspect per sample wanted. A job that exists in
 * every run needs 1; the slack covers runs predating the job, or a run where it was
 * skipped. Scanning is one API call per run, so this is a cost ceiling as much as a
 * search depth.
 */
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
 * The nearest-rank percentile of an ascending array of numbers: the smallest value at or
 * above the requested rank, so every result is an observed sample.
 *
 * @param {number[]} ascending non-empty, sorted ascending
 * @param {number} percentile in (0, 100]
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
 * Whole seconds between two ISO-8601 instants.
 *
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
 * @returns {string} the same duration in minutes, one decimal place
 */
export function minutes(seconds) {
  return (seconds / 60).toFixed(1);
}

/**
 * @param {string} job
 * @param {Sample[]} samples
 * @param {number} scanned successful workflow runs inspected
 * @param {Iterable<string>} [namesSeen] every job name met while scanning, for the
 *   empty-result message
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
    // The likeliest cause is a name that is nearly right - a matrix suffix dropped, or a
    // job renamed - and the answer to that is a list, not another guess.
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
 * @returns {{ job: string; workflow: string; branch: string; runs: number; json: boolean }}
 */
export function parseArgs(args) {
  const parsed = { job: "", ...DEFAULTS, json: false };
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--json") parsed.json = true;
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
      "usage: pnpm ci:durations <job-name> [--runs N] [--branch B] [--workflow W] [--json]",
    );
  }
  return parsed;
}

/**
 * @param {string[]} args
 * @returns {string} stdout
 */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Successful runs of a workflow on a branch, newest first.
 *
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
 * Every job in one run, in the API's order.
 *
 * @param {number} runId
 * @returns {Job[]}
 */
export function runJobs(runId) {
  /** @type {{ jobs: Job[] }} */
  const payload = JSON.parse(gh(["api", `repos/${REPOSITORY}/actions/runs/${String(runId)}/jobs`]));
  return payload.jobs;
}

/**
 * The named job's completed timings within one run's jobs, or undefined when there is no
 * such job or it did not complete successfully.
 *
 * @param {Job[]} jobs
 * @param {number} runId
 * @param {string} job
 * @returns {Sample | undefined}
 */
export function sampleFrom(jobs, runId, job) {
  const match = jobs.find(
    (candidate) =>
      candidate.name === job && candidate.conclusion === "success" && candidate.completed_at,
  );
  if (match === undefined || match.completed_at === null) return undefined;
  return {
    runId,
    startedAt: match.started_at,
    completedAt: match.completed_at,
    seconds: durationSeconds(match.started_at, match.completed_at),
  };
}

/**
 * @param {string[]} args
 * @returns {number} exit code
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
      const sample = sampleFrom(jobs, run.databaseId, options.job);
      if (sample !== undefined) samples.push(sample);
    }
  } catch (error) {
    console.error(`ci-job-durations: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const summary = summarize(options.job, samples, scanned, namesSeen);
  console.log(options.json ? JSON.stringify(summary, null, 2) : render(summary));
  return summary.count === 0 ? 1 : 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2)));
}
