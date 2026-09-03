#!/usr/bin/env node
// @ts-check
/**
 * Say whether the loop supervisor is running and current (issue #597).
 *
 * `scripts/agent-loop.sh` is the only supervisor, and `docs/DEVELOPER_GUIDE.md` presents
 * it as the way an unattended run survives a usage limit. On 2026-08-01 it stopped: the
 * last line of `agent-loop.log` is a limit-reset sleep that never woke, and every
 * session for the three weeks after that reasoned about a safety net that was not there.
 * Nobody noticed, because nothing anywhere answered the question - and the premise had
 * not gone stale by the time this landed: the first run, on 2026-09-03, reported
 * `STOPPED` with the log 797 hours old. That is the half this script fixes: not
 * supervising the supervisor, but making its absence **visible** to any session that
 * thinks to ask, in one command.
 *
 * Two facts, read rather than assumed, and reported together because either alone
 * misleads:
 *
 * - **Is a supervisor process alive?** Read from `/proc`, matching the script path in a
 *   process command line. Where `/proc` is unavailable the answer is `UNKNOWN`, never
 *   "stopped": a confident wrong all-clear in either direction is the failure #597 is
 *   about.
 * - **Has it moved recently?** `agent-loop.log` gains a line at every iteration
 *   boundary. An alive process with a log that has not moved is a supervisor stuck
 *   inside one iteration, which looks identical to a healthy one from `ps` alone.
 *
 * The staleness window defaults to 6 hours because that is the longest gap the
 * supervisor can legitimately produce: its limit-reset sleep is capped at 21600 seconds
 * (`until_sec` in `scripts/agent-loop.sh`), so a longer silence is not explainable by
 * waiting out a usage limit.
 *
 * The last log line is printed whatever the verdict, because in the #597 case it was the
 * line that named the failure ("limit reset detected ... sleeping until then") and it
 * sat there unread for three weeks beside an mtime that contradicted it.
 *
 * Usage:
 *   node scripts/agent-loop-status.mjs             # human-readable report
 *   node scripts/agent-loop-status.mjs --json      # one JSON object
 *   node scripts/agent-loop-status.mjs --stale-hours 12
 *
 * Exit code: 0 RUNNING, 1 STALLED or STOPPED, 2 UNKNOWN or a usage error.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, env, exit, pid as ownPid } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The supervisor script, by the name that appears in its command line. */
export const SUPERVISOR_SCRIPT = "agent-loop.sh";

/** The log the supervisor appends to, relative to the primary checkout. */
export const LOG_NAME = "agent-loop.log";

/**
 * Longest silence a healthy supervisor can produce, in hours. Its limit-reset sleep is
 * capped at 21600 seconds in `scripts/agent-loop.sh`, so anything beyond that is not a
 * usage-limit wait.
 */
export const DEFAULT_STALE_HOURS = 6;

/**
 * @typedef {{ pid: number; cwd: string | undefined; since: number | undefined; command: string }} Supervisor
 * @typedef {{ verdict: "RUNNING" | "STALLED" | "STOPPED" | "UNKNOWN"; reason: string; supervisors: Supervisor[]; processesReadable: boolean; log: LogState }} Status
 * @typedef {{ path: string; exists: boolean; mtimeMs: number | undefined; ageHours: number | undefined; lastLine: string | undefined; lastStart: string | undefined; lastExit: string | undefined; lastSentinel: string | undefined }} LogState
 */

/**
 * The primary checkout for whatever working tree `from` sits in. The supervisor runs
 * there and writes its log there, so a lane asking from a linked worktree still gets an
 * answer about the real thing.
 *
 * @param {string} from
 * @returns {string}
 */
export function primaryCheckout(from) {
  const common = execFileSync(
    "git",
    ["-C", from, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return dirname(common);
}

/** Interpreters the supervisor is launched through. */
const SHELLS = new Set(["bash", "sh", "dash", "zsh", "ksh"]);

/**
 * Whether a process command line is the supervisor running, rather than a process that
 * merely names the script.
 *
 * The distinction matters more than it looks: `grep agent-loop.sh`, an editor with the
 * file open, or this check itself would each be counted by a substring match, and every
 * one of them would produce the false all-clear #597 is about. So the script has to
 * appear where an interpreter would put it - as the executable itself, or as the script
 * argument of a shell - and it has to carry a path separator, which the documented
 * invocation (`bash scripts/agent-loop.sh`) always does. A run started as a bare
 * `agent-loop.sh` from inside `scripts/` is the one shape this misses, and it is
 * reported as no supervisor rather than mis-attributed.
 *
 * @param {string[]} argumentList
 * @returns {boolean}
 */
export function isSupervisorCommand(argumentList) {
  const args = argumentList.filter((value) => value !== "");
  const isScript = (/** @type {string | undefined} */ value) =>
    value !== undefined && value.endsWith(`/${SUPERVISOR_SCRIPT}`);
  if (isScript(args[0])) return true;
  const interpreter = args[0]?.split("/").pop();
  return interpreter !== undefined && SHELLS.has(interpreter) && isScript(args[1]);
}

/**
 * Live supervisor processes, read from `/proc`.
 *
 * Returns `undefined` when the process table cannot be enumerated at all, which is a
 * different answer from "none running" and is reported as such.
 *
 * @param {string} procRoot
 * @param {number} selfPid
 * @returns {Supervisor[] | undefined}
 */
export function findSupervisors(procRoot = "/proc", selfPid = ownPid) {
  /** @type {string[]} */
  let pids;
  try {
    pids = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return undefined;
  }

  /** @type {Supervisor[]} */
  const found = [];
  for (const entry of pids) {
    const pid = Number(entry);
    if (pid === selfPid) continue;
    let argumentList;
    try {
      argumentList = readFileSync(join(procRoot, entry, "cmdline"), "utf8").split("\0");
    } catch {
      continue; // the process exited between the listing and the read
    }
    if (!isSupervisorCommand(argumentList)) continue;

    let cwd;
    try {
      cwd = readlinkSync(join(procRoot, entry, "cwd"));
    } catch {
      cwd = undefined; // another user's process, or one that just exited
    }
    let since;
    try {
      since = statSync(join(procRoot, entry)).mtimeMs;
    } catch {
      since = undefined;
    }
    found.push({ pid, cwd, since, command: argumentList.filter(Boolean).join(" ") });
  }
  return found;
}

/**
 * What `agent-loop.log` currently says.
 *
 * @param {string} path
 * @param {number} now
 * @returns {LogState}
 */
export function readLog(path, now = Date.now()) {
  /** @type {LogState} */
  const absent = {
    path,
    exists: false,
    mtimeMs: undefined,
    ageHours: undefined,
    lastLine: undefined,
    lastStart: undefined,
    lastExit: undefined,
    lastSentinel: undefined,
  };
  let text;
  let mtimeMs;
  try {
    mtimeMs = statSync(path).mtimeMs;
    text = readFileSync(path, "utf8");
  } catch {
    return absent;
  }

  const lines = text.split("\n").filter((line) => line.trim() !== "");
  /** @param {RegExp} pattern */
  const last = (pattern) => [...lines].reverse().find((line) => pattern.test(line));
  return {
    path,
    exists: true,
    mtimeMs,
    ageHours: (now - mtimeMs) / 3_600_000,
    lastLine: lines.at(-1),
    lastStart: last(/supervisor start:/),
    lastExit: last(/supervisor exit/),
    lastSentinel: last(/NEXT-WORK:/),
  };
}

/**
 * Combine the two readings into one verdict.
 *
 * @param {{ supervisors: Supervisor[] | undefined; log: LogState; staleHours: number }} input
 * @returns {Status}
 */
export function assess({ supervisors, log, staleHours }) {
  const processesReadable = supervisors !== undefined;
  const live = supervisors ?? [];

  if (!processesReadable) {
    return {
      verdict: "UNKNOWN",
      reason: "the process table could not be read, so liveness is unknown (not 'stopped')",
      supervisors: live,
      processesReadable,
      log,
    };
  }

  if (live.length === 0) {
    if (!log.exists) {
      return {
        verdict: "STOPPED",
        reason: "no supervisor process, and no log: the supervisor has never run here",
        supervisors: live,
        processesReadable,
        log,
      };
    }
    const cleanly = log.lastLine !== undefined && /supervisor exit/.test(log.lastLine);
    return {
      verdict: "STOPPED",
      reason: cleanly
        ? "no supervisor process; the log ends on a clean `supervisor exit`"
        : "no supervisor process, and the log does not end on `supervisor exit`, so the last run died mid-iteration",
      supervisors: live,
      processesReadable,
      log,
    };
  }

  if (log.ageHours !== undefined && log.ageHours > staleHours) {
    return {
      verdict: "STALLED",
      reason: `a supervisor process is alive but the log has not moved for ${log.ageHours.toFixed(1)}h, past the ${String(staleHours)}h window`,
      supervisors: live,
      processesReadable,
      log,
    };
  }

  return {
    verdict: "RUNNING",
    reason: log.exists
      ? "a supervisor process is alive and the log is current"
      : "a supervisor process is alive; it has not written its log yet",
    supervisors: live,
    processesReadable,
    log,
  };
}

/**
 * @param {Status} status
 * @returns {string}
 */
export function render(status) {
  const lines = [`agent-loop: ${status.verdict} - ${status.reason}`];
  for (const supervisor of status.supervisors) {
    const where = supervisor.cwd === undefined ? "cwd unreadable" : supervisor.cwd;
    const since =
      supervisor.since === undefined ? "" : `, since ${new Date(supervisor.since).toISOString()}`;
    lines.push(`  pid ${String(supervisor.pid)}  ${where}${since}`);
    lines.push(`    ${supervisor.command}`);
  }
  lines.push(`  log ${status.log.path}`);
  if (!status.log.exists) {
    lines.push("    (absent)");
  } else {
    const age = status.log.ageHours ?? 0;
    lines.push(
      `    last written ${new Date(status.log.mtimeMs ?? 0).toISOString()} (${age.toFixed(1)}h ago)`,
    );
    if (status.log.lastStart !== undefined) lines.push(`    start    ${status.log.lastStart}`);
    if (status.log.lastSentinel !== undefined)
      lines.push(`    sentinel ${status.log.lastSentinel}`);
    if (status.log.lastLine !== undefined) lines.push(`    last     ${status.log.lastLine}`);
  }
  return lines.join("\n");
}

/**
 * @param {string[]} args
 * @returns {{ json: boolean; staleHours: number }}
 */
export function parseArgs(args) {
  const parsed = { json: false, staleHours: DEFAULT_STALE_HOURS };
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--json") parsed.json = true;
    else if (arg === "--stale-hours") {
      const value = remaining.shift();
      const hours = Number(value);
      if (value === undefined || !Number.isFinite(hours) || hours <= 0) {
        throw new Error(`--stale-hours needs a positive number, got '${String(value)}'`);
      }
      parsed.staleHours = hours;
    } else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

/**
 * @param {string[]} args
 * @param {string} checkout
 * @returns {number}
 */
export function main(args, checkout) {
  /** @type {ReturnType<typeof parseArgs>} */
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`agent-loop-status: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const status = assess({
    supervisors: findSupervisors(),
    log: readLog(join(checkout, LOG_NAME)),
    staleHours: options.staleHours,
  });

  console.log(options.json ? JSON.stringify(status, null, 2) : render(status));
  if (status.verdict === "RUNNING") return 0;
  if (status.verdict === "UNKNOWN") return 2;
  return 1;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2), env.QCMS_REPO_ROOT ?? primaryCheckout(REPO_ROOT)));
}
