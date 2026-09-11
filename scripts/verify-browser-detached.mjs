#!/usr/bin/env node
// @ts-check
/**
 * Run the browser gate detached, and wait for it in bounded slices (issue #846).
 *
 * `pnpm verify:browser` is about half an hour long (`CONTRIBUTING.md` quotes the CI
 * job's p50, and `pnpm ci:durations browser-e2e` reprints it). Every per-command cap an
 * agent harness or a script wrapper imposes is shorter than that, and the failure shape
 * is the problem rather than the lost time: a harness kill and a red suite both surface
 * as a nonzero exit code over a truncated log, so a lane can report a killed gate as a
 * failing one, or the reverse. Three lanes hit exactly that on one day (issue #846 and
 * its comments: EXIT=143 at the 600 s foreground cap, EXIT=137 from a background
 * mechanism, tests 187, 220, 223 and 234 of 293, no Playwright summary in any of them),
 * and each kill left the seat's `next dev` servers orphaned so the seat preflight then
 * refused the next attempt (issue #295, `docs/PORTS.md`).
 *
 * The shape that survived all three times is a run under `setsid` whose exit code is
 * written to a file. This script is that recipe with the three things the recipe cannot
 * give you: a pid recorded where a later command can find it, a heartbeat so a silent
 * run can be told from a hung one, and a companion wait that returns a DISTINCT exit
 * code for "the slice ended, the suite is still running" rather than a verdict.
 *
 *   start      spawn the suite under `setsid`, record pid / log / heartbeat / rc, return
 *   wait       block for one bounded slice, print progress, exit with the suite's rc
 *   supervise  the detached side (start spawns this; not called by hand)
 *
 * `pnpm verify:browser` is deliberately untouched: CI runs that, and a gate CI depends
 * on does not acquire a new wrapper for an agent's benefit.
 *
 * Usage:
 *   QCMS_PORT_SEAT=<0-9> pnpm verify:browser:detached
 *   QCMS_PORT_SEAT=<0-9> pnpm verify:browser:detached --shard 1/2
 *   QCMS_PORT_SEAT=<0-9> pnpm verify:browser:detached --project admin-chromium --shard 1/2
 *   pnpm verify:browser:wait <dir>              # one slice, default 540 s
 *   pnpm verify:browser:wait <dir> --slice 300 --tail 80
 *
 * Exit codes from `wait`, chosen so a caller can branch on them. A finished suite exits
 * with Playwright's own code (0, or 1 for failures); the four below sit in the
 * `sysexits.h` range, which Playwright does not use, so none of them can be mistaken
 * for a test verdict:
 *
 *   64  usage: no directory, or no run recorded there
 *   75  the slice ended with the suite still running - re-invoke, nothing is wrong
 *   76  the runner is gone and recorded no rc (SIGKILL): the seat may hold orphans
 *   77  the runner was signalled and released the seat: not a test verdict
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { argv, cwd, env, exit, hrtime } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scratchPath } from "./agent-scratch.mjs";
import { PORT_SEAT_ENV_VAR, assertPortSeatChosen } from "./ports.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The run's four files, inside this lane's `agent-scratch` directory. */
export const RUN_FILES = {
  heartbeat: "browser-run.heartbeat",
  log: "browser-run.log",
  pid: "browser-run.pid",
  rc: "browser-run.rc",
};

/** How long one `wait` slice blocks before returning "still running". */
export const DEFAULT_SLICE_SECONDS = 540;

/** How many log lines a finished or interrupted slice prints. */
export const DEFAULT_TAIL_LINES = 40;

/** The heartbeat interval, as issue #846 asks for. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** `wait` polls the rc file this often. */
export const DEFAULT_POLL_MS = 2_000;

/** Bad arguments, or a directory holding no run. */
export const EXIT_USAGE = 64;

/** The slice ended with the suite still running. Re-invoke; nothing has failed. */
export const EXIT_STILL_RUNNING = 75;

/** The runner process is gone and recorded no rc, so the run was SIGKILLed. */
export const EXIT_RUNNER_VANISHED = 76;

/** The runner was signalled, killed the suite and released the seat. Not a verdict. */
export const EXIT_RUNNER_KILLED = 77;

/** How long the signal handler gives the suite's process group before SIGKILL. */
export const GRACE_MS = 10_000;

/** How long `start` waits for the detached side to record its pid. */
const START_CONFIRM_MS = 15_000;

/**
 * A shard plan Playwright accepts: `<index>/<total>`, index within total, both 1-based.
 *
 * Validated here rather than left to Playwright because the whole point of the detached
 * form is that the failure arrives 30 minutes later than the mistake. A bad plan is a
 * one-line refusal now.
 *
 * @param {string} plan
 * @returns {string}
 */
export function validateShard(plan) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(plan);
  if (match === null) {
    throw new Error(`--shard expects <index>/<total>, both 1-based, got '${plan}'`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index > total)
    throw new Error(`--shard index ${String(index)} exceeds total ${String(total)}`);
  return `${String(index)}/${String(total)}`;
}

/**
 * @typedef {{ mode: "start"; projects: string[]; shard?: string; passthrough: string[] }} StartArgs
 * @typedef {{ mode: "wait"; directory: string; sliceSeconds: number; tailLines: number }} WaitArgs
 * @typedef {{ mode: "supervise"; heartbeat: string; log: string; pid: string; rc: string; command: string[] }} SuperviseArgs
 * @typedef {StartArgs | WaitArgs | SuperviseArgs} Args
 */

/**
 * @param {string[]} remaining
 * @param {string} flag
 * @returns {string}
 */
function takeValue(remaining, flag) {
  const value = remaining.shift();
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

/**
 * @param {string} raw
 * @param {string} flag
 * @returns {number}
 */
function positiveInteger(raw, flag) {
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${flag} expects a positive integer, got '${raw}'`);
  return Number(raw);
}

/**
 * Parse one invocation.
 *
 * `--project` takes its value separately here and is emitted to Playwright in the
 * `--project=<name>` form on purpose: Playwright's own `--project` is variadic, so the
 * space form swallows the next argument as a second project name and fails with
 * "Project(s) ... not found" (issue #890). Passing the flag through this script removes
 * that footgun; anything after `--` is handed over verbatim for the cases it does not
 * cover.
 *
 * @param {string[]} args
 * @returns {Args}
 */
export function parseArgs(args) {
  const remaining = [...args];
  const mode = remaining.shift();
  if (mode === undefined) throw new Error("expected a mode: start, wait or supervise");

  if (mode === "start") {
    /** @type {StartArgs} */
    const parsed = { mode: "start", projects: [], passthrough: [] };
    while (remaining.length > 0) {
      const arg = /** @type {string} */ (remaining.shift());
      if (arg === "--") {
        parsed.passthrough.push(...remaining.splice(0, remaining.length));
      } else if (arg === "--shard") {
        parsed.shard = validateShard(takeValue(remaining, "--shard"));
      } else if (arg.startsWith("--shard=")) {
        parsed.shard = validateShard(arg.slice("--shard=".length));
      } else if (arg === "--project") {
        parsed.projects.push(takeValue(remaining, "--project"));
      } else if (arg.startsWith("--project=")) {
        parsed.projects.push(arg.slice("--project=".length));
      } else {
        throw new Error(`unknown option for start: ${arg} (pass Playwright flags after --)`);
      }
    }
    return parsed;
  }

  if (mode === "wait") {
    /** @type {WaitArgs} */
    const parsed = {
      mode: "wait",
      directory: "",
      sliceSeconds: DEFAULT_SLICE_SECONDS,
      tailLines: DEFAULT_TAIL_LINES,
    };
    while (remaining.length > 0) {
      const arg = /** @type {string} */ (remaining.shift());
      if (arg === "--slice") {
        parsed.sliceSeconds = positiveInteger(takeValue(remaining, "--slice"), "--slice");
      } else if (arg === "--tail") {
        parsed.tailLines = positiveInteger(takeValue(remaining, "--tail"), "--tail");
      } else if (arg.startsWith("--")) {
        throw new Error(`unknown option for wait: ${arg}`);
      } else if (parsed.directory === "") {
        parsed.directory = arg;
      } else {
        throw new Error(`unexpected argument: ${arg}`);
      }
    }
    if (parsed.directory === "")
      throw new Error("wait requires the run directory that start printed");
    return parsed;
  }

  if (mode === "supervise") {
    /** @type {Record<string, string>} */
    const files = {};
    /** @type {string[]} */
    let command = [];
    while (remaining.length > 0) {
      const arg = /** @type {string} */ (remaining.shift());
      if (arg === "--") {
        command = remaining.splice(0, remaining.length);
      } else if (arg === "--heartbeat" || arg === "--log" || arg === "--pid" || arg === "--rc") {
        files[arg.slice(2)] = takeValue(remaining, arg);
      } else {
        throw new Error(`unknown option for supervise: ${arg}`);
      }
    }
    for (const key of ["heartbeat", "log", "pid", "rc"]) {
      if (files[key] === undefined) throw new Error(`supervise requires --${key}`);
    }
    if (command.length === 0) throw new Error("supervise requires a command after --");
    return {
      mode: "supervise",
      heartbeat: /** @type {string} */ (files.heartbeat),
      log: /** @type {string} */ (files.log),
      pid: /** @type {string} */ (files.pid),
      rc: /** @type {string} */ (files.rc),
      command,
    };
  }

  throw new Error(`unknown mode: ${mode} (expected start, wait or supervise)`);
}

/**
 * The command the detached side runs: the same suite `pnpm verify:browser` runs, with
 * the optional shard and project plan appended.
 *
 * `playwright test` directly rather than `pnpm run verify:browser`, so appended flags
 * cannot be claimed by pnpm's own argument parsing on the way through.
 * `scripts/verify-browser-detached.test.ts` pins this against `package.json`'s
 * `verify:browser` so the two cannot drift apart silently.
 *
 * @param {{ projects?: string[]; shard?: string; passthrough?: string[] }} plan
 * @returns {string[]}
 */
export function playwrightCommand({ projects = [], shard, passthrough = [] } = {}) {
  const args = ["exec", "playwright", "test"];
  for (const project of projects) args.push(`--project=${project}`);
  if (shard !== undefined) args.push(`--shard=${shard}`);
  args.push(...passthrough);
  return ["pnpm", ...args];
}

/**
 * Is this pid still alive? Signal 0 checks for existence without delivering anything.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else, which is still "alive".
    return /** @type {{ code?: string }} */ (error).code === "EPERM";
  }
}

/**
 * The recorded rc, or `undefined` while the run has not finished.
 *
 * The rc file is written by an atomic rename, so a reader never sees half of it; a
 * missing or unparseable file therefore means "not finished yet" rather than "corrupt".
 *
 * @param {string} path
 * @returns {{ code: number; signalled: boolean } | undefined}
 */
export function readRc(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const match = /^EXIT=(-?\d+)/m.exec(text);
  if (match?.[1] === undefined) return undefined;
  return { code: Number(match[1]), signalled: /^killed=/m.test(text) };
}

/**
 * The pid recorded for the run, or `undefined` when there is none.
 *
 * @param {string} path
 * @returns {number | undefined}
 */
export function readPid(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const match = /^(\d+)/.exec(text.trim());
  if (match?.[1] === undefined) return undefined;
  return Number(match[1]);
}

/**
 * Write `text` at `path` through a temporary file and a rename, so no reader ever sees a
 * partial write. The rc file is the run's verdict, and a torn read of a verdict is the
 * class of defect this whole script exists to remove.
 *
 * @param {string} path
 * @param {string} text
 */
export function writeAtomic(path, text) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}

/**
 * The last `count` lines of a file, or a note when there is nothing to show.
 *
 * @param {string} path
 * @param {number} count
 * @returns {string[]}
 */
export function tailLines(path, count) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [`(no log at ${path})`];
  }
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return ["(log is empty)"];
  return lines.slice(Math.max(0, lines.length - count));
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Spawn the suite detached and record where its state lives.
 *
 * The suite runs under `setsid`, in a session of its own, which is what makes it survive
 * the harness killing the shell that asked for it. The supervisor below is what runs
 * there rather than the suite itself, because the heartbeat, the rc file and the
 * seat-releasing signal handler all need a process that outlives the caller and knows
 * the suite's process group.
 *
 * @param {{ command?: string[]; directory?: string; environment?: NodeJS.ProcessEnv; out?: (line: string) => void; repoRoot?: string; confirmMs?: number }} options
 * @returns {Promise<{ code: number; directory: string; pid?: number }>}
 */
export async function startDetached({
  command,
  directory = cwd(),
  environment = env,
  out = (line) => {
    process.stdout.write(`${line}\n`);
  },
  repoRoot = REPO_ROOT,
  confirmMs = START_CONFIRM_MS,
} = {}) {
  assertPortSeatChosen(repoRoot, "pnpm verify:browser:detached", environment[PORT_SEAT_ENV_VAR]);

  const laneDirectory = scratchPath({ directory, environment });

  // Refuse a second run in this lane while the first is alive. Two browser suites at one
  // seat collide on every harness port, and the run-fresh paths below would remove the
  // live run's own log on the way in.
  const existing = readPid(join(laneDirectory, RUN_FILES.pid));
  if (existing !== undefined && isAlive(existing)) {
    out(`a detached browser run is already live in this lane: pid ${String(existing)}`);
    out(`  ${laneDirectory}`);
    out("Wait for it, or stop it with: kill " + String(existing));
    return { code: EXIT_USAGE, directory: laneDirectory };
  }

  // Run-fresh paths: anything a previous run left at these names is removed now, so a
  // file read back later either holds this run's output or does not exist (issue #602).
  const paths = {
    heartbeat: scratchPath({ directory, environment, name: RUN_FILES.heartbeat }),
    log: scratchPath({ directory, environment, name: RUN_FILES.log }),
    pid: scratchPath({ directory, environment, name: RUN_FILES.pid }),
    rc: scratchPath({ directory, environment, name: RUN_FILES.rc }),
  };

  const suite = command ?? playwrightCommand();
  const self = fileURLToPath(import.meta.url);
  const supervisor = spawn(
    "setsid",
    [
      process.execPath,
      self,
      "supervise",
      "--log",
      paths.log,
      "--pid",
      paths.pid,
      "--rc",
      paths.rc,
      "--heartbeat",
      paths.heartbeat,
      "--",
      ...suite,
    ],
    { cwd: directory, detached: true, env: environment, stdio: "ignore" },
  );
  supervisor.unref();

  // The pid file is written by the supervisor, not guessed from `setsid`'s own pid:
  // `setsid` may fork before exec, so its pid is not reliably the process that ends up
  // holding the run.
  const deadline = Date.now() + confirmMs;
  let pid = readPid(paths.pid);
  while (pid === undefined && Date.now() < deadline) {
    await sleep(100);
    pid = readPid(paths.pid);
  }
  if (pid === undefined) {
    out("the detached runner did not record a pid; nothing is running");
    out(`  log: ${paths.log}`);
    return { code: 1, directory: laneDirectory };
  }

  const seat = (environment[PORT_SEAT_ENV_VAR] ?? "").trim();
  out(`[verify:browser:detached] started, seat ${seat === "" ? "0 (default)" : seat}`);
  out(`  command:   ${suite.join(" ")}`);
  out(`  pid:       ${String(pid)}  (${paths.pid})`);
  out(`  log:       ${paths.log}`);
  out(`  heartbeat: ${paths.heartbeat}`);
  out(`  rc:        ${paths.rc}`);
  out("");
  out("Wait for it in bounded slices, re-invoking while it exits 75:");
  out(`  pnpm verify:browser:wait ${laneDirectory}`);
  return { code: 0, directory: laneDirectory, pid };
}

/**
 * The detached side: run the suite, keep a heartbeat, record the rc, and release the
 * seat if this process is itself signalled.
 *
 * The suite gets a process group of its own (`detached`), which is the whole mechanism
 * behind the cleanup: one `kill(-pgid)` reaches Playwright AND the two `next dev`
 * servers it started, so a signalled runner does not leave the seat's `17Sxx` ports held
 * by orphans reparented to pid 1 (issue #295). Never `pkill -f`: the gate command names
 * are identical across lanes on this host, so a pattern kill is lane-agnostic and has
 * already taken out a neighbour's gate and the killer's own shell (issue #890).
 *
 * @param {SuperviseArgs} args
 * @returns {Promise<number>}
 */
export async function supervise({ command, heartbeat, log, pid: pidPath, rc: rcPath }) {
  mkdirSync(dirname(log), { recursive: true });
  const handle = openSync(log, "a");
  const started = hrtime.bigint();

  /** @param {string} line */
  const note = (line) => {
    appendFileSync(handle, `[verify:browser:detached] ${line}\n`);
  };

  const child = spawn(command[0] ?? "", command.slice(1), {
    detached: true,
    stdio: ["ignore", handle, handle],
  });

  writeAtomic(
    pidPath,
    [
      String(process.pid),
      `# runner pid, in its own session. Suite process group: ${String(child.pid ?? 0)}.`,
      `# Stop the run with: kill ${String(process.pid)}  (never pkill -f, see issue #890)`,
      "",
    ].join("\n"),
  );
  note(`runner pid ${String(process.pid)}, suite pid ${String(child.pid ?? 0)}`);
  note(`command: ${command.join(" ")}`);

  const elapsedSeconds = () => Number((hrtime.bigint() - started) / 1_000_000_000n);
  const beat = setInterval(() => {
    let bytes;
    try {
      bytes = statSync(log).size;
    } catch {
      bytes = 0;
    }
    const last = tailLines(log, 1)[0] ?? "";
    appendFileSync(
      heartbeat,
      `${new Date().toISOString()} elapsed=${String(elapsedSeconds())}s log_bytes=${String(bytes)} last=${last.slice(0, 160)}\n`,
    );
  }, HEARTBEAT_INTERVAL_MS);
  beat.unref();

  /** @type {(value: { code: number; signal: NodeJS.Signals | null }) => void} */
  let settle;
  /** @type {Promise<{ code: number; signal: NodeJS.Signals | null }>} */
  const exited = new Promise((resolve) => {
    settle = resolve;
  });
  child.on("exit", (code, signal) => {
    settle({ code: code ?? 0, signal });
  });
  child.on("error", (error) => {
    note(`could not start the suite: ${error.message}`);
    settle({ code: 127, signal: null });
  });

  /** @type {NodeJS.Signals | undefined} */
  let signalled;
  /** @param {NodeJS.Signals} signal */
  const onSignal = (signal) => {
    if (signalled !== undefined) return;
    signalled = signal;
    note(`runner received ${signal}: stopping the suite and releasing the seat`);
    // The whole group, so the dev servers go with it rather than surviving as orphans.
    killGroup(child.pid, "SIGTERM");
    setTimeout(() => {
      killGroup(child.pid, "SIGKILL");
    }, GRACE_MS).unref();
  };
  for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGTERM", "SIGINT", "SIGHUP"])) {
    process.on(signal, () => {
      onSignal(signal);
    });
  }

  const { code, signal } = await exited;
  clearInterval(beat);

  const suiteCode = signal === null ? code : 128 + signalNumber(signal);
  const lines = [`EXIT=${String(suiteCode)}`];
  if (signalled !== undefined) {
    lines.push(`killed=${signalled}`);
    lines.push(`# The RUNNER was signalled; this is not a test verdict. Seat released.`);
  } else if (signal !== null) {
    lines.push(`killed=${signal}`);
    lines.push("# The SUITE died on a signal; this is not a test verdict.");
  }
  lines.push(`elapsed_seconds=${String(elapsedSeconds())}`, "");
  writeAtomic(rcPath, lines.join("\n"));
  note(`finished: EXIT=${String(suiteCode)} after ${String(elapsedSeconds())}s`);
  return suiteCode;
}

/**
 * Signal a process GROUP by its leader's pid, tolerating a group that has already gone.
 *
 * @param {number | undefined} leader
 * @param {NodeJS.Signals} signal
 */
function killGroup(leader, signal) {
  if (leader === undefined || leader <= 0) return;
  try {
    process.kill(-leader, signal);
  } catch {
    // Already gone, which is the outcome being asked for.
  }
}

/**
 * @param {NodeJS.Signals} signal
 * @returns {number}
 */
function signalNumber(signal) {
  /** @type {Record<string, number>} */
  const known = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };
  return known[signal] ?? 0;
}

/**
 * Block for one bounded slice and report what happened.
 *
 * The bound is the point: an agent lane's per-command cap is shorter than the suite, so
 * the wait returns before the cap with a code that says "still running" rather than
 * being killed at it with a code that looks like a red suite. A caller re-invokes while
 * it sees {@link EXIT_STILL_RUNNING}.
 *
 * @param {{ directory: string; sliceSeconds?: number; tailLines?: number; pollMs?: number; out?: (line: string) => void }} options
 * @returns {Promise<number>}
 */
export async function waitForRun({
  directory,
  sliceSeconds = DEFAULT_SLICE_SECONDS,
  tailLines: tail = DEFAULT_TAIL_LINES,
  pollMs = DEFAULT_POLL_MS,
  out = (line) => {
    process.stdout.write(`${line}\n`);
  },
}) {
  const paths = {
    heartbeat: join(directory, RUN_FILES.heartbeat),
    log: join(directory, RUN_FILES.log),
    pid: join(directory, RUN_FILES.pid),
    rc: join(directory, RUN_FILES.rc),
  };
  if (!existsSync(paths.pid) && readRc(paths.rc) === undefined) {
    out(`no detached browser run recorded in ${directory}`);
    out("Start one with: QCMS_PORT_SEAT=<0-9> pnpm verify:browser:detached");
    return EXIT_USAGE;
  }

  /** Print each heartbeat line once, so a blocked slice shows progress as it goes. */
  let beatsPrinted = 0;
  const drainHeartbeat = () => {
    let text;
    try {
      text = readFileSync(paths.heartbeat, "utf8");
    } catch {
      return;
    }
    const lines = text.split("\n").filter((line) => line !== "");
    for (const line of lines.slice(beatsPrinted)) out(`  ${line}`);
    beatsPrinted = lines.length;
  };

  /** @param {string} headline */
  const withTail = (headline) => {
    out("");
    out(`--- tail of ${paths.log} ---`);
    for (const line of tailLines(paths.log, tail)) out(line);
    out("--- end of tail ---");
    out(headline);
  };

  const pid = readPid(paths.pid);
  out(`[verify:browser:wait] slice ${String(sliceSeconds)}s, run pid ${String(pid ?? 0)}`);
  const deadline = Date.now() + sliceSeconds * 1_000;
  for (;;) {
    const rc = readRc(paths.rc);
    if (rc !== undefined) {
      drainHeartbeat();
      if (rc.signalled) {
        withTail(
          `EXIT=${String(rc.code)} but the run was SIGNALLED, not judged: the suite never finished. ` +
            "Re-run it; this is not a red suite.",
        );
        return EXIT_RUNNER_KILLED;
      }
      withTail(`EXIT=${String(rc.code)}`);
      return rc.code;
    }
    if (pid !== undefined && !isAlive(pid)) {
      // No rc and no runner: SIGKILL, which leaves no chance to clean up. The seat's
      // dev servers are probably still holding their ports.
      drainHeartbeat();
      withTail(
        "the runner is gone and recorded no rc, so it was SIGKILLed. The suite never " +
          "finished, and the seat may hold orphan dev servers: clear them as " +
          "docs/DEVELOPER_GUIDE.md describes before starting another run.",
      );
      return EXIT_RUNNER_VANISHED;
    }
    if (Date.now() >= deadline) {
      drainHeartbeat();
      withTail(
        `still running after ${String(sliceSeconds)}s. Nothing has failed: re-invoke ` +
          `\`pnpm verify:browser:wait ${directory}\` for another slice.`,
      );
      return EXIT_STILL_RUNNING;
    }
    drainHeartbeat();
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

/**
 * @param {string[]} args
 * @param {string} directory
 * @param {NodeJS.ProcessEnv} environment
 * @returns {Promise<number>}
 */
export async function main(args, directory, environment) {
  /** @type {Args} */
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    process.stderr.write(
      `verify-browser-detached: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_USAGE;
  }

  try {
    if (parsed.mode === "start") {
      const { code } = await startDetached({
        command: playwrightCommand(parsed),
        directory,
        environment,
      });
      return code;
    }
    if (parsed.mode === "wait") {
      return await waitForRun({
        directory: parsed.directory,
        sliceSeconds: parsed.sliceSeconds,
        tailLines: parsed.tailLines,
      });
    }
    return await supervise(parsed);
  } catch (error) {
    process.stderr.write(
      `verify-browser-detached: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(await main(argv.slice(2), cwd(), env));
}
