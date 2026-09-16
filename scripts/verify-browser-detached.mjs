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
 * with Playwright's own code (0, or 1 for failures); the five below sit in the
 * `sysexits.h` range, which Playwright does not use, so none of them can be mistaken
 * for a test verdict:
 *
 *   64  usage: no directory, or no run recorded there
 *   75  the slice ended with the suite still running - re-invoke, nothing is wrong
 *   76  the runner is gone and recorded no rc (SIGKILL): the seat may hold orphans
 *   77  the runner was signalled: it stopped the suite and cleared the seat's ports
 *   78  the SUITE died on a signal while the runner lived: an external kill
 *
 * ## Who may be signalled, and why that needed confining (issue #902)
 *
 * The seat release below goes by PORT, because Playwright's dev servers sit in process
 * groups the suite's leader cannot address (see {@link releaseSeat}). "Whoever is
 * listening on these four ports" is not the same set as "processes this run started",
 * and the gap between them was a live cross-seat kill: `startDetached` derives the
 * release ports from `QCMS_PORT_SEAT`, and this script's OWN test suite starts a runner
 * at a hard-coded seat and then signals it, so every `pnpm verify` on this host sent
 * SIGTERM and then SIGKILL to whatever held that seat's four harness ports - including a
 * neighbouring lane's live browser gate. That is the shape issue #902 reported twice,
 * both sightings on the same seat as the test's, with `EXIT=143` and no failing test.
 *
 * So a pid is signalled only once it is shown to belong to this run: a descendant of this
 * runner or its suite, or a process whose `/proc/<pid>/cwd` resolves to this runner's own
 * CHECKOUT ({@link ownershipOf}, by nearest `.git` rather than by path prefix, because
 * lane worktrees nest inside the primary checkout). Anything else is named in the log and
 * in the rc file's `seat_foreign` field and left alone, because a port this run cannot
 * account for belongs to somebody.
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { argv, cwd, env, exit, hrtime } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scratchPath } from "./agent-scratch.mjs";
import {
  PORT_SEAT_ENV_VAR,
  assertPortSeatChosen,
  harnessPorts,
  resolvePortSeat,
  withoutTrailingSlash,
} from "./ports.mjs";

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

/**
 * The SUITE died on a signal while the runner stayed up. Not a verdict either.
 *
 * Separated from {@link EXIT_RUNNER_KILLED} because the two point at different causes and
 * a reader of the exit code should not have to open the log to tell them apart (issue
 * #902). 77 means something signalled this script, which is a per-command cap, an
 * operator, or another lane. 78 means Playwright itself was killed underneath a runner
 * that was never touched, which is the host: the OOM killer, a cgroup limit, or a group
 * signal aimed at the suite's session.
 */
export const EXIT_SUITE_SIGNALLED = 78;

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
 * @typedef {{ mode: "supervise"; heartbeat: string; log: string; pid: string; rc: string; releasePorts: number[]; seat?: string; repoRoot?: string; command: string[] }} SuperviseArgs
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
    /** @type {number[]} */
    const releasePorts = [];
    /** @type {string[]} */
    let command = [];
    /** @type {string | undefined} */
    let seat;
    /** @type {string | undefined} */
    let repoRoot;
    while (remaining.length > 0) {
      const arg = /** @type {string} */ (remaining.shift());
      if (arg === "--") {
        command = remaining.splice(0, remaining.length);
      } else if (arg === "--heartbeat" || arg === "--log" || arg === "--pid" || arg === "--rc") {
        files[arg.slice(2)] = takeValue(remaining, arg);
      } else if (arg === "--seat") {
        // Recorded rather than used for arithmetic: the ports arrive already resolved in
        // `--release-port`, and this is here so a kill can be attributed to a seat
        // afterwards without inferring one from a port number (issue #902).
        seat = takeValue(remaining, "--seat");
      } else if (arg === "--repo-root") {
        // The tree whose processes this runner may signal. Defaults to the checkout this
        // script lives in, and is a flag only so the ownership rule is testable.
        repoRoot = takeValue(remaining, "--repo-root");
      } else if (arg === "--release-port") {
        releasePorts.push(
          positiveInteger(takeValue(remaining, "--release-port"), "--release-port"),
        );
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
      releasePorts,
      ...(seat === undefined ? {} : { seat }),
      ...(repoRoot === undefined ? {} : { repoRoot }),
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
 * `target` says WHICH process the signal reached, which is the distinction issue #902
 * asked for: `runner` is something signalling this script (a per-command cap, an
 * operator, another lane), `suite` is Playwright dying underneath a runner nobody
 * touched, which is the host. An rc file that records a kill without naming a target is
 * read as `runner`, the conservative reading, because that is the only shape any
 * previous version of this script wrote.
 *
 * @param {string} path
 * @returns {{ code: number; signalled: boolean; target: "runner" | "suite"; signal?: string; survivors?: string; foreign?: string } | undefined}
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
  const survivors = /^seat_survivors=(.+)$/m.exec(text)?.[1];
  const foreign = /^seat_foreign=(.+)$/m.exec(text)?.[1];
  const signal = /^killed=(.+)$/m.exec(text)?.[1];
  return {
    code: Number(match[1]),
    signalled: /^killed=/m.test(text),
    target: /^signal_target=suite$/m.test(text) ? "suite" : "runner",
    ...(signal === undefined ? {} : { signal }),
    ...(survivors === undefined ? {} : { survivors }),
    ...(foreign === undefined ? {} : { foreign }),
  };
}

/**
 * The suite's process group leader, recorded beside the runner pid.
 *
 * This is the pid to signal when the RUNNER is already gone: a SIGKILLed runner never
 * ran its trap, so the suite and its dev servers outlive it with nothing left holding
 * their pids. `kill -<this>` takes the group.
 *
 * @param {string} path
 * @returns {number | undefined}
 */
export function readSuiteGroup(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const match = /^suite_group=(\d+)/m.exec(text);
  if (match?.[1] === undefined) return undefined;
  const pid = Number(match[1]);
  return pid < 2 ? undefined : pid;
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
  // The ports this run owns, so a signalled runner can clear them by port rather than
  // by ancestry. Playwright's dev servers are not in the suite's process group.
  const seatNumber = resolvePortSeat(environment[PORT_SEAT_ENV_VAR]);
  const releaseArgs = harnessPorts(seatNumber).flatMap(({ port }) => [
    "--release-port",
    String(port),
  ]);
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
      // The seat, so a kill can be attributed to one afterwards, and the tree whose
      // processes the seat release is allowed to signal at all (issue #902).
      "--seat",
      String(seatNumber),
      "--repo-root",
      repoRoot,
      ...releaseArgs,
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
 * The suite gets a process group of its own (`detached`), so one `kill(-pgid)` reaches
 * Playwright and everything Playwright kept in that group. **That is not enough on its
 * own, measured rather than assumed**: Playwright starts each `webServer` in a session
 * of ITS own, so the two `next dev` servers sit in process groups the suite's leader
 * pid cannot address, and a run stopped that way left both of them bound to the seat's
 * ports 25 seconds later. The group signal is therefore step one of {@link releaseSeat},
 * which then goes by PORT: it asks `/proc` who is listening on this seat's harness ports
 * and signals those pids one at a time. Never `pkill -f` - the gate command names are
 * identical across every lane on this host, so a pattern kill is lane-agnostic and has
 * already taken out a neighbour's gate and the killer's own shell (issue #890).
 *
 * @param {SuperviseArgs} args
 * @returns {Promise<number>}
 */
export async function supervise({
  command,
  heartbeat,
  log,
  pid: pidPath,
  rc: rcPath,
  releasePorts = [],
  seat,
  repoRoot = REPO_ROOT,
}) {
  mkdirSync(dirname(log), { recursive: true });
  const handle = openSync(log, "a");
  const started = hrtime.bigint();
  // Defined up here rather than beside the heartbeat that also uses it, because the
  // signal handler below calls it and handlers are installed before the pid file exists
  // on purpose. Left further down it is a `const` in its temporal dead zone for the width
  // of that window, and a signal arriving inside it would throw from the handler instead
  // of writing an rc file, which is the one outcome this script exists to prevent.
  const elapsedSeconds = () => Number((hrtime.bigint() - started) / 1_000_000_000n);

  /** @param {string} line */
  const note = (line) => {
    appendFileSync(handle, `[verify:browser:detached] ${line}\n`);
  };

  const child = spawn(command[0] ?? "", command.slice(1), {
    detached: true,
    stdio: ["ignore", handle, handle],
  });

  // Installed BEFORE the pid file exists, and that order is load-bearing rather than
  // stylistic. The pid file is this runner's public invitation to signal it, so a
  // handler registered after it leaves a window in which a kill arriving on the
  // advertised pid takes Node's default action: the runner dies without stopping the
  // suite, without clearing the seat and without writing an rc file, which is precisely
  // the unreadable outcome this script exists to prevent. Caught as a one-in-three flake
  // in the test that kills the moment the pid file appears.
  /** @type {NodeJS.Signals | undefined} */
  let signalled;
  /** @type {Promise<PortListener[]> | undefined} */
  let releasing;
  /** @type {string[]} */
  let provenance = [];
  /** @param {NodeJS.Signals} signal */
  const onSignal = (signal) => {
    if (signalled !== undefined) return;
    signalled = signal;
    provenance = signalProvenance({
      signal,
      target: "runner",
      seat,
      elapsedSeconds: elapsedSeconds(),
    });
    note(`runner received ${signal}: stopping the suite and releasing the seat`);
    for (const line of provenance) note(`  ${line}`);
    releasing = (async () => {
      // Step one: the suite's own group. Playwright and anything it left in that group
      // go here; its separately-sessioned dev servers do not, which is step two.
      killGroup(child.pid, "SIGTERM");
      setTimeout(() => {
        killGroup(child.pid, "SIGKILL");
      }, GRACE_MS).unref();
      return await releaseSeat({
        ports: releasePorts,
        graceMs: GRACE_MS,
        note,
        skipPids: new Set([process.pid, child.pid ?? -1]),
        // What makes a port holder this run's to kill: descent from one of these two, or
        // a working directory inside this checkout (issue #902).
        ancestors: new Set([process.pid, child.pid ?? -1]),
        repoRoot,
      });
    })();
  };
  for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGTERM", "SIGINT", "SIGHUP"])) {
    process.on(signal, () => {
      onSignal(signal);
    });
  }

  writeAtomic(
    pidPath,
    [
      String(process.pid),
      // A field rather than prose, because it is what is left to kill when the runner
      // itself is gone: SIGKILL leaves no chance to trap, so the suite and its dev
      // servers survive their supervisor. `kill -<pid>` signals the whole group.
      `suite_group=${String(child.pid ?? 0)}`,
      "# The first line is the runner pid, in a session of its own.",
      `# Stop the run with: kill ${String(process.pid)}  (never pkill -f, see issue #890)`,
      "",
    ].join("\n"),
  );
  note(`runner pid ${String(process.pid)}, suite pid ${String(child.pid ?? 0)}`);
  note(`command: ${command.join(" ")}`);

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

  const { code, signal } = await exited;
  clearInterval(beat);

  const suiteCode = signal === null ? code : 128 + signalNumber(signal);
  const lines = [`EXIT=${String(suiteCode)}`];
  if (signalled !== undefined) {
    lines.push(`killed=${signalled}`, ...provenance);
    // Only ever written from what the port check actually found, never from the
    // intention to clean up: a release that failed is the case a report has to see.
    lines.push(...releaseLines(releasePorts, await (releasing ?? Promise.resolve([]))));
  } else if (signal !== null) {
    // The suite died on a signal this runner never saw, so nothing in this tree sent it.
    // `wait` reports that as its own exit code rather than folding it into "the runner
    // was killed", because the two have different causes (issue #902).
    lines.push(
      `killed=${signal}`,
      ...signalProvenance({ signal, target: "suite", seat, elapsedSeconds: elapsedSeconds() }),
      "# The SUITE died on a signal while this runner was never signalled; this is not a",
      "# test verdict. Nothing in this tree sent it: look at the host (the OOM killer, a",
      "# cgroup limit, or a group signal aimed at the suite's own session).",
    );
  }
  lines.push(`elapsed_seconds=${String(elapsedSeconds())}`, "");
  writeAtomic(rcPath, lines.join("\n"));
  note(`finished: EXIT=${String(suiteCode)} after ${String(elapsedSeconds())}s`);
  return suiteCode;
}

/**
 * What a Node signal handler can honestly say about where its signal came from.
 *
 * The sender's pid is NOT among it, and that is a platform fact rather than an omission:
 * Linux carries `si_pid` only to a handler installed with `SA_SIGINFO`, or to a reader of
 * a `signalfd`, and Node exposes neither to `process.on("SIGTERM")`. So nothing here can
 * name the killer. What it can do is record everything that makes the next sighting
 * attributable without a live process to inspect (issue #902, whose two reports had no
 * evidence beyond a timestamp and an exit code): which process was hit, its parent, the
 * seat, how far into the run it happened, and what the machine looked like at that
 * moment. A supervisor started under `setsid` normally reports `runner_ppid=1`, which is
 * itself the useful reading - nothing in this tree is left that could have sent it.
 *
 * @param {{ signal: string; target: "runner" | "suite"; seat?: string; elapsedSeconds: number; pid?: number; parentPid?: number; host?: () => string[] }} options
 * @returns {string[]}
 */
export function signalProvenance({
  signal,
  target,
  seat,
  elapsedSeconds,
  pid = process.pid,
  parentPid = process.ppid,
  host = hostSnapshot,
}) {
  return [
    `signal=${signal}`,
    `signal_target=${target}`,
    `signal_at_elapsed_seconds=${String(elapsedSeconds)}`,
    `runner_pid=${String(pid)}`,
    `runner_ppid=${String(parentPid)}`,
    `runner_parent=${commandLineOf(parentPid) ?? "unreadable"}`,
    `seat=${seat === undefined || seat === "" ? "unrecorded" : seat}`,
    ...host(),
    "# No sender pid: Linux passes one only through SA_SIGINFO or signalfd, neither of",
    "# which Node exposes to a signal handler. The fields above are what is knowable.",
  ];
}

/**
 * Load average and free memory, for the question every kill sighting asks next.
 *
 * Cheap on purpose (two small `/proc` reads, once per run) and read at the moment of the
 * signal rather than afterwards, because a host under pressure is the leading explanation
 * for a gate that died with no failing test and the evidence is gone by the time anyone
 * looks.
 *
 * @returns {string[]}
 */
function hostSnapshot() {
  /** @type {string[]} */
  const lines = [];
  try {
    lines.push(
      `loadavg=${readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/).slice(0, 3).join(" ")}`,
    );
  } catch {
    lines.push("loadavg=unreadable");
  }
  try {
    const available = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
    lines.push(`mem_available_kb=${available?.[1] ?? "unreadable"}`);
  } catch {
    lines.push("mem_available_kb=unreadable");
  }
  return lines;
}

/** How much of a parent's command line the rc file records. */
const COMMAND_LINE_LIMIT = 200;

/**
 * One process's command line, on a single line and bounded in length.
 *
 * The NUL separators `/proc` uses become spaces and every other control character goes,
 * because this lands in a file whose whole contract is that a reader can parse it a line
 * at a time: one embedded newline in somebody else's argv would split a field in half. The
 * length cap is for the same reason at a different scale - a shell wrapper's argv can run
 * to kilobytes, and the rc file is meant to be read whole.
 *
 * @param {number} pid
 * @param {(pid: number) => string | undefined} [read] the `/proc` read, injectable so the
 *   sanitising above has a test that does not need a process with an awkward argv
 * @returns {string | undefined}
 */
export function commandLineOf(pid, read = readProcCmdline) {
  if (!Number.isInteger(pid) || pid < 1) return undefined;
  const raw = read(pid);
  if (raw === undefined) return undefined;
  // Filtered by code point rather than by a regular expression, which is the one spelling
  // that satisfies both gates at once: a literal control byte in source is invisible to a
  // reader and `pnpm check:no-control-chars` refuses it, while the escaped equivalent
  // (a `u0000-u001F` class spelled with escapes) is an ESLint `no-control-regex` error.
  const flat = [...raw]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : character;
    })
    .join("");
  const collapsed = flat.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length <= COMMAND_LINE_LIMIT
    ? collapsed
    : `${collapsed.slice(0, COMMAND_LINE_LIMIT)}...(truncated)`;
}

/**
 * @param {number} pid
 * @returns {string | undefined}
 */
function readProcCmdline(pid) {
  try {
    return readFileSync(`/proc/${String(pid)}/cmdline`, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The rc file's account of the seat, written from the port check rather than from the
 * attempt. Four honest outcomes: nothing was asked for, the ports are clear, named pids
 * of OURS are still holding them, or a port is held by something that is not this run's
 * to kill and was therefore left alone (issue #902).
 *
 * The last two are deliberately different fields. `seat_survivors` is an instruction -
 * those pids are yours, kill them - and pointing that instruction at a neighbouring
 * lane's live gate is the defect this whole confinement exists to remove, so a holder
 * this runner refused to signal is reported under its own name with the opposite advice.
 *
 * @param {number[]} ports
 * @param {PortListener[]} remaining
 * @returns {string[]}
 */
export function releaseLines(ports, remaining) {
  const preamble = "# The RUNNER was signalled; this is not a test verdict.";
  if (ports.length === 0) {
    return [`${preamble} No seat ports were given, so nothing was released.`];
  }
  if (remaining.length === 0) {
    return [`${preamble} Seat released: nothing is listening on ${ports.join(", ")}.`];
  }
  const survivors = remaining.filter((listener) => isOwnProcess(listener.ownership));
  const foreign = remaining.filter((listener) => !isOwnProcess(listener.ownership));
  /** @type {string[]} */
  const lines = [];
  if (survivors.length > 0) {
    lines.push(
      `seat_survivors=${survivors.map(describeListener).join(",")}`,
      `${preamble} THE SEAT WAS NOT RELEASED: the pids above still hold those ports.`,
      "# Kill them by hand, one pid per argument, from outside any sandbox.",
    );
  } else {
    lines.push(`${preamble} Every port this run owned was released.`);
  }
  if (foreign.length > 0) {
    lines.push(
      `seat_foreign=${foreign.map(describeForeignListener).join(",")}`,
      "# Those holders were deliberately NOT signalled, and the grounds above decide what",
      "# to do about each one (issue #902).",
    );
    // The two grounds need opposite advice, and conflating them was worth one more
    // paragraph. A `foreign-tree` holder is provably somebody else's and killing it is the
    // defect this confinement removes. An `unattributable` one is a holder `/proc` could
    // not name at that instant: on THIS seat's own ports it may well be this lane's own
    // orphan, so telling an operator to leave it alone would strand their seat.
    if (foreign.some((listener) => listener.ownership === "foreign-tree")) {
      lines.push(
        "# foreign-tree: another checkout's process, so on a shared host it is another",
        "# lane's server. Do not kill it. Take a free seat instead.",
      );
    }
    if (foreign.some((listener) => listener.ownership !== "foreign-tree")) {
      lines.push(
        "# unattributable: the holder could not be identified from /proc (another user,",
        "# another PID namespace, or a socket closing mid-scan). It may be this lane's own",
        "# orphan. Re-check with `ss -ltnp` and read /proc/<pid>/cwd before killing anything;",
        "# the next run's seat preflight will name it too.",
      );
    }
  }
  return lines;
}

/**
 * Signal a process GROUP by its leader's pid, tolerating a group that has already gone.
 *
 * The guard is not defensive tidiness. `process.kill(0, ...)` signals the CALLER'S OWN
 * process group, and `process.kill(-1, ...)` signals every process this user owns, so a
 * pid that arrived as `undefined` and was defaulted to 0 would turn a cleanup into
 * suicide or a massacre. A leader below 2 is never a group worth addressing.
 *
 * @param {number | undefined} leader
 * @param {NodeJS.Signals} signal
 */
function killGroup(leader, signal) {
  if (leader === undefined || !Number.isInteger(leader) || leader < 2) return;
  try {
    process.kill(-leader, signal);
  } catch {
    // Already gone, which is the outcome being asked for.
  }
}

/**
 * @typedef {"descendant" | "same-tree" | "foreign-tree" | "unattributable"} PortOwnership
 * @typedef {{ port: number; pid: number | undefined; ownership?: PortOwnership }} PortListener
 */

/**
 * Whether an ownership verdict entitles this runner to signal the holder.
 *
 * @param {PortOwnership | undefined} ownership
 * @returns {boolean}
 */
function isOwnProcess(ownership) {
  return ownership === "descendant" || ownership === "same-tree";
}

/**
 * One process's parent, from `/proc/<pid>/stat`.
 *
 * The `comm` field is parenthesised and may itself contain spaces and parentheses, so the
 * numeric fields are read from after the LAST `)` rather than by splitting the whole line.
 * A `next dev` process is not going to be called `foo) 1 2 3 (bar`, but reading it the
 * naive way is how a process-tree walk silently follows a pid that was never there.
 *
 * @param {number} pid
 * @returns {number | undefined}
 */
function parentOf(pid) {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/);
    // After `comm` the fields are: state, ppid, pgrp, session, ...
    const parent = Number(fields[1]);
    return Number.isInteger(parent) && parent > 0 ? parent : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One process's working directory, which on a dev server is its app directory.
 *
 * @param {number} pid
 * @returns {string | undefined}
 */
function workingDirectoryOf(pid) {
  try {
    return readlinkSync(`/proc/${String(pid)}/cwd`);
  } catch {
    return undefined;
  }
}

/** True when `path` is `root` or sits inside it. The separator is what stops a prefix
 * match on a sibling directory (`/repo` against `/repo-other`).
 *
 * @param {string} path
 * @param {string} root
 * @returns {boolean}
 */
function isInside(path, root) {
  const base = withoutTrailingSlash(root);
  const candidate = withoutTrailingSlash(path);
  return candidate === base || candidate.startsWith(`${base}/`);
}

/**
 * The checkout `directory` belongs to: the nearest ancestor holding a `.git` entry.
 *
 * A path prefix test alone is not enough to decide "my tree", and this is the reason it
 * is not: **an agent lane's worktree lives INSIDE the primary checkout** (`.worktrees/`,
 * `.claude/worktrees/`), so every nested lane's dev server is under the primary
 * checkout's path. A runner in the primary tree asking only "is this cwd inside my root"
 * would answer yes about a neighbour, and that is the same cross-seat kill by a different
 * route - the #902 sightings came from a lane running in exactly such a nested worktree.
 *
 * The nearest `.git` is the honest boundary: a linked worktree carries a `.git` FILE
 * (`scripts/ports.mjs`, `isLinkedWorktree`), so it resolves to itself rather than to the
 * checkout that contains it.
 *
 * @param {string} directory
 * @param {(path: string) => boolean} [hasGit]
 * @returns {string | undefined}
 */
export function checkoutRootOf(directory, hasGit = gitEntryExists) {
  let candidate = withoutTrailingSlash(directory);
  // Bounded because an unexpected path shape must end the walk, not spin: 64 is far past
  // any real repository depth.
  for (let hop = 0; hop < 64 && candidate !== ""; hop += 1) {
    if (hasGit(`${candidate}/.git`)) return candidate;
    const parent = candidate.slice(0, candidate.lastIndexOf("/"));
    if (parent === candidate) break;
    candidate = parent;
  }
  return undefined;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function gitEntryExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `pid` is this run's to signal, and on what grounds (issue #902).
 *
 * Two grounds, both needed:
 *
 * - **descendant**: walking `/proc/<pid>/stat`'s parent chain reaches this runner or its
 *   suite. That covers the normal case. Playwright starts each `webServer` in a session
 *   of its own, so a group signal cannot reach the dev servers, but `setsid` does not
 *   reparent anything: the parent chain from `next-server` up through `next dev`, `pnpm`
 *   and the wrapper still ends at the suite pid this runner spawned.
 * - **same-tree**: `/proc/<pid>/cwd` resolves to this runner's own CHECKOUT, by
 *   {@link checkoutRootOf} rather than by a path prefix. That is the case the chain cannot
 *   see, and it is not hypothetical: once step one of the cleanup has taken the Playwright
 *   runner down, its dev servers are reparented to pid 1 and the chain above them is gone,
 *   while their cwd is still this worktree's `apps/portal` and `apps/admin`. One worktree
 *   is one lane and a second live run in it is refused at `start`, so "in my checkout"
 *   cannot mean somebody else's run - whereas "under my path" can, because lanes nest.
 *
 * Everything else is `foreign-tree` (a neighbouring lane, which is exactly what the
 * cross-seat kill was) or `unattributable` (another user, another PID namespace, or a pid
 * that exited mid-scan). Neither is signalled: "I cannot account for this" and "it is
 * mine" must not collapse into one outcome, the same rule the seat preflight already
 * applies to adoption in `apps/portal/e2e/support/port-seat.ts`.
 *
 * @param {number | undefined} pid
 * @param {{ ancestors?: Set<number>; repoRoot?: string; parent?: (pid: number) => number | undefined; workingDirectory?: (pid: number) => string | undefined; checkoutRoot?: (directory: string) => string | undefined }} options
 * @returns {PortOwnership}
 */
export function ownershipOf(
  pid,
  {
    ancestors = new Set(),
    repoRoot = REPO_ROOT,
    parent = parentOf,
    workingDirectory = workingDirectoryOf,
    checkoutRoot = checkoutRootOf,
  } = {},
) {
  if (pid === undefined || !Number.isInteger(pid) || pid < 2) return "unattributable";
  // Bounded rather than "until pid 1": a chain that loops (a `/proc` read racing a
  // reparent can produce one) must end the walk rather than the process.
  let walker = pid;
  for (let hop = 0; hop < 64; hop += 1) {
    if (ancestors.has(walker)) return "descendant";
    const next = parent(walker);
    if (next === undefined || next < 2 || next === walker) break;
    walker = next;
  }
  const directory = workingDirectory(pid);
  if (directory === undefined) return "unattributable";
  const mine = checkoutRoot(repoRoot);
  const theirs = checkoutRoot(directory);
  // No `.git` above either path means the question cannot be answered, not that the
  // answer is yes. Falls back to "is it literally my root", which is true of a runner
  // started in a plain directory (a fixture, a tarball) and false of everything else.
  if (mine === undefined || theirs === undefined) {
    return isInside(directory, repoRoot) && mine === theirs ? "same-tree" : "unattributable";
  }
  return withoutTrailingSlash(mine) === withoutTrailingSlash(theirs) ? "same-tree" : "foreign-tree";
}

/**
 * How a listener is named in a log line or the rc file.
 *
 * `/proc` cannot always attribute a live socket (another user's process, another PID
 * namespace, or a socket already closing), and the holder is then genuinely unknown.
 * It is spelled `unknown` rather than `0` because 0 is a real argument to `kill` with a
 * disastrous meaning (the caller's own process group), so it must never appear anywhere
 * a person might copy it into one.
 *
 * @param {PortListener} listener
 * @returns {string}
 */
export function describeListener({ port, pid }) {
  return `${String(port)}:${pid === undefined ? "unknown" : String(pid)}`;
}

/**
 * How a holder this runner refused to signal is named, with the grounds appended.
 *
 * The grounds are the whole value of the `seat_foreign` field: "outside this checkout" and
 * "could not be attributed at all" lead a reader to different next steps, and a report of
 * a cross-seat sighting needs to say which one it was (issue #902).
 *
 * @param {PortListener} listener
 * @returns {string}
 */
export function describeForeignListener(listener) {
  return `${describeListener(listener)}:${listener.ownership ?? "unattributable"}`;
}

/** `st` value for `TCP_LISTEN` in `/proc/net/tcp`. */
const TCP_LISTEN = "0A";

/**
 * Every process listening on any of `ports`, from `/proc`.
 *
 * This mirrors `seatOccupants` in `apps/portal/e2e/support/port-seat.ts`, which is the
 * lookup the seat preflight already uses to name an occupant. It is mirrored rather
 * than imported because that file is TypeScript nothing compiles and this is plain
 * JavaScript bare `node` runs; `docs/PORTS.md` records that moving the `/proc` reader
 * down beside `scripts/ports.mjs` so both callers can share one copy belongs with issue
 * #318, and this copy is deliberately small enough to fold in when that happens.
 *
 * A pid can be `undefined` on a real listener (another user's process, or another PID
 * namespace). That is reported as an occupied port with an unknown holder rather than
 * as a free port, because the caller's question is "is the seat clear", not "is it
 * mine".
 *
 * @param {number[]} ports
 * @returns {PortListener[]}
 */
export function listenersOnPorts(ports) {
  if (ports.length === 0 || !existsSync("/proc/net/tcp")) return [];
  /** @type {PortListener[]} */
  const found = [];
  for (const port of ports) {
    const inodes = listeningSocketInodes(port);
    if (inodes.size === 0) continue;
    found.push({ port, pid: pidHoldingSocket(inodes) });
  }
  return found;
}

/**
 * Inode numbers of every listening TCP socket bound to `port`.
 *
 * @param {number} port
 * @returns {Set<string>}
 */
function listeningSocketInodes(port) {
  const inodes = new Set();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = readFileSync(table, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      const localAddress = columns[1];
      const state = columns[3];
      const inode = columns[9];
      if (localAddress === undefined || state !== TCP_LISTEN || inode === undefined) continue;
      const hexPort = localAddress.split(":")[1];
      if (hexPort !== undefined && Number.parseInt(hexPort, 16) === port) inodes.add(inode);
    }
  }
  return inodes;
}

/**
 * The pid holding any of `inodes` open, by scanning `/proc/<pid>/fd`.
 *
 * @param {Set<string>} inodes
 * @returns {number | undefined}
 */
function pidHoldingSocket(inodes) {
  if (inodes.size === 0) return undefined;
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return undefined;
  }
  const targets = new Set([...inodes].map((inode) => `socket:[${inode}]`));
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let descriptors;
    try {
      descriptors = readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      try {
        if (targets.has(readlinkSync(`/proc/${entry}/fd/${descriptor}`))) return Number(entry);
      } catch {
        // The descriptor closed between the listing and the readlink.
      }
    }
  }
  return undefined;
}

/**
 * Signal one pid, refusing the values that mean something else entirely.
 *
 * @param {number | undefined} pid
 * @param {NodeJS.Signals} signal
 * @param {Set<number>} skipPids
 * @param {(line: string) => void} note
 * @returns {boolean} whether a signal was actually delivered
 */
function signalPid(pid, signal, skipPids, note) {
  // 0 is this process's own group and 1 is init. Neither is ever the answer, and a
  // `pid ?? 0` upstream is exactly how 0 gets here.
  if (pid === undefined || !Number.isInteger(pid) || pid < 2) return false;
  if (pid === process.pid || skipPids.has(pid)) return false;
  try {
    process.kill(pid, signal);
    note(`sent ${signal} to pid ${String(pid)}`);
    return true;
  } catch (error) {
    note(`could not signal pid ${String(pid)}: ${error instanceof Error ? error.message : "?"}`);
    return false;
  }
}

/**
 * Clear every process listening on this seat's harness ports, and report what is left.
 *
 * Killing the suite's process group does NOT do this, which is the measurement that
 * made this function necessary: Playwright starts each `webServer` in a session of its
 * own, so the portal and admin dev servers sit in groups the suite's leader pid cannot
 * address. Two SIGTERM runs on a real seat left both `next-server` processes bound to
 * their ports 25 seconds later, while the rc file claimed the seat had been released.
 *
 * So the seat is cleared by PORT, not by ancestry: ask `/proc` who is listening, signal
 * those pids one at a time, wait, then SIGKILL whoever is left. One pid per call and
 * never a pattern match - `pkill -f "pnpm verify"` is lane-agnostic on this host and
 * has already killed a neighbour's gate (issue #890).
 *
 * **But by port is not the same as ours, and the difference was a live defect** (issue
 * #902). The original reasoning here was that the ports are this seat's own allocation
 * (`docs/PORTS.md`, R8) and the preflight refuses to start when anything else holds them,
 * so a listener on them must be this run's. That holds for a run that got as far as the
 * preflight. It does not hold for a runner whose release ports came from a seat it never
 * bound: this script's own test suite starts a supervisor at a hard-coded seat and
 * signals it, so `pnpm verify` on this host swept a seat no part of it was using and
 * killed whatever held it - a neighbouring lane's browser gate, twice reported, with
 * `EXIT=143` and no failing test. So every holder is now checked with
 * {@link ownershipOf} before it is signalled, and one that cannot be shown to be this
 * run's is named and left alone.
 *
 * Returns every port holder still listening, each with its ownership verdict, which is
 * what the rc file reports. An empty array is the only thing that earns "seat released";
 * a foreign holder is reported separately, because it is not the caller's to kill.
 *
 * @param {{ ports: number[]; ancestors?: Set<number>; repoRoot?: string; graceMs?: number; note?: (line: string) => void; pollMs?: number; skipPids?: Set<number>; settleMs?: number }} options
 * @returns {Promise<PortListener[]>}
 */
export async function releaseSeat({
  ports,
  ancestors = new Set(),
  repoRoot = REPO_ROOT,
  graceMs = GRACE_MS,
  note = () => {},
  pollMs = 250,
  skipPids = new Set(),
  settleMs = 2_000,
}) {
  if (ports.length === 0) return [];
  const signalled = new Set();

  /** @returns {PortListener[]} */
  const observe = () =>
    listenersOnPorts(ports).map((listener) => ({
      ...listener,
      ownership: ownershipOf(listener.pid, { ancestors, repoRoot }),
    }));

  /** @param {NodeJS.Signals} signal */
  const sweep = (signal) => {
    const listeners = observe();
    for (const listener of listeners) {
      const { port, pid, ownership } = listener;
      const who = pid === undefined ? "unknown" : String(pid);
      const key = `${who}:${signal}`;
      if (signalled.has(key)) continue;
      signalled.add(key);
      if (!isOwnProcess(ownership)) {
        note(
          `port ${String(port)} is held by pid ${who} (${ownership ?? "unattributable"}): NOT ` +
            "signalling it, it is not this run's process (issue #902)",
        );
        continue;
      }
      note(`port ${String(port)} still held by pid ${who} (${ownership ?? "?"})`);
      signalPid(pid, signal, skipPids, note);
    }
    return listeners;
  };

  /**
   * Sweep until nothing this run owns is left, or the budget runs out.
   *
   * "Nothing we own" rather than "nothing at all" is what keeps a foreign holder from
   * costing the full grace period twice over: signalling it is refused, so waiting for it
   * to go away is waiting for something that was never going to happen.
   *
   * @param {number} budgetMs
   * @param {NodeJS.Signals} signal
   * @returns {Promise<PortListener[]>}
   */
  const drain = async (budgetMs, signal) => {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      const listeners = sweep(signal);
      if (!listeners.some((listener) => isOwnProcess(listener.ownership))) return listeners;
      if (Date.now() >= deadline) return observe();
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  };

  let remaining = await drain(graceMs, "SIGTERM");
  if (remaining.some((listener) => isOwnProcess(listener.ownership))) {
    remaining = await drain(settleMs, "SIGKILL");
  }
  const survivors = remaining.filter((listener) => isOwnProcess(listener.ownership));
  const foreign = remaining.filter((listener) => !isOwnProcess(listener.ownership));
  if (remaining.length === 0) {
    note(`seat released: nothing is listening on ${ports.join(", ")}`);
  } else if (survivors.length === 0) {
    note(
      `seat released as far as this run owned it; still held by another tree: ${foreign
        .map(describeForeignListener)
        .join(", ")}`,
    );
  } else {
    note(`SEAT NOT RELEASED: ${survivors.map(describeListener).join(", ")}`);
  }
  return remaining;
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

  /**
   * Print the rc file verbatim after a signalled run.
   *
   * It is a dozen short lines and every one of them is evidence a report of an unexplained
   * kill needs (the seat, the elapsed time, the load average and free memory at the moment
   * the signal arrived). Reprinting it here is what stops that evidence from being
   * something a reader has to know to go and open (issue #902).
   */
  const printRc = () => {
    let text;
    try {
      text = readFileSync(paths.rc, "utf8");
    } catch {
      return;
    }
    out("");
    out(`--- ${paths.rc} ---`);
    for (const line of text.split("\n")) {
      if (line !== "") out(line);
    }
    out("--- end of rc ---");
  };

  const pid = readPid(paths.pid);
  out(`[verify:browser:wait] slice ${String(sliceSeconds)}s, run pid ${String(pid ?? 0)}`);
  const deadline = Date.now() + sliceSeconds * 1_000;
  for (;;) {
    const rc = readRc(paths.rc);
    if (rc !== undefined) {
      drainHeartbeat();
      if (rc.signalled) {
        const seat =
          rc.foreign === undefined
            ? ""
            : ` A port on this seat is held by something this run could not claim, and it ` +
              `was left alone: ${rc.foreign} (port:pid:grounds). The grounds decide what to ` +
              "do about it and the rc file below spells that out: another checkout's " +
              "process is not yours to kill, an unattributable one may be your own orphan.";
        const owned =
          rc.survivors === undefined
            ? ""
            : ` The seat was NOT released: ${rc.survivors} (port:pid). Kill those pids by ` +
              "hand, one pid per argument, from outside any sandbox, before the next run.";
        if (rc.target === "suite") {
          withTail(
            `EXIT=${String(rc.code)} but the SUITE was killed by ${rc.signal ?? "a signal"} ` +
              "while this runner was never signalled, so nothing in the run's own tree sent " +
              "it: suspect the host (the OOM killer, a cgroup limit, or a group signal aimed " +
              "at the suite's session). Not a red suite; the rc file below has the load " +
              "average and free memory from the moment it happened." +
              seat +
              owned,
          );
          printRc();
          return EXIT_SUITE_SIGNALLED;
        }
        withTail(
          `EXIT=${String(rc.code)} but the RUNNER was SIGNALLED, not judged: the suite never ` +
            "finished. Re-run it; this is not a red suite." +
            seat +
            owned,
        );
        printRc();
        return EXIT_RUNNER_KILLED;
      }
      withTail(`EXIT=${String(rc.code)}`);
      return rc.code;
    }
    if (pid !== undefined && !isAlive(pid)) {
      // No rc and no runner: SIGKILL, which leaves no chance to clean up. The seat's
      // dev servers are probably still holding their ports.
      drainHeartbeat();
      const group = readSuiteGroup(paths.pid);
      withTail(
        "the runner is gone and recorded no rc, so it was SIGKILLed. The suite never " +
          "finished, and nothing ran the cleanup, so the seat may hold orphan dev " +
          "servers" +
          (group === undefined ? "" : ` (the suite's process group was ${String(group)})`) +
          ": clear them as docs/DEVELOPER_GUIDE.md describes before starting another run.",
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
