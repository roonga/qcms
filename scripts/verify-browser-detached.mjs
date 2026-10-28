#!/usr/bin/env node
// @ts-check
/**
 * The browser gate outlasts every harness cap and a cap kill looks like a red suite, so the run is
 * detached and its verdict written to a file. The seat is released by PORT, signalling a holder only
 * once {@link ownershipOf} shows it belongs to this run.
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

export const RUN_FILES = {
  heartbeat: "browser-run.heartbeat",
  log: "browser-run.log",
  pid: "browser-run.pid",
  rc: "browser-run.rc",
};

export const DEFAULT_SLICE_SECONDS = 540;

export const DEFAULT_TAIL_LINES = 40;

export const HEARTBEAT_INTERVAL_MS = 30_000;

export const DEFAULT_POLL_MS = 2_000;

export const EXIT_USAGE = 64;

/** The slice ended with the suite still running. Re-invoke; nothing has failed. */
export const EXIT_STILL_RUNNING = 75;

/** The runner process is gone and recorded no rc, so the run was SIGKILLed. */
export const EXIT_RUNNER_VANISHED = 76;

/** The runner was signalled, killed the suite and released the seat. Not a verdict. */
export const EXIT_RUNNER_KILLED = 77;

/**
 * The SUITE died on a signal while the runner stayed up, which points at the host rather
 * than at a cap or another lane. Not a verdict either.
 */
export const EXIT_SUITE_SIGNALLED = 78;

export const GRACE_MS = 10_000;

const START_CONFIRM_MS = 15_000;

/**
 * Validated here rather than left to Playwright, because in the detached form the
 * failure would otherwise arrive half an hour after the mistake.
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
 * `--project` is emitted as `--project=<name>` because Playwright's own flag is variadic
 * and the space form swallows the next argument as a second project name.
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
        // Recorded, not used for arithmetic, so a kill can be attributed to a seat
        // without inferring one from a port number.
        seat = takeValue(remaining, "--seat");
      } else if (arg === "--repo-root") {
        // The tree whose processes this runner may signal. A flag only so the ownership
        // rule is testable.
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
 * `playwright test` directly rather than `pnpm run verify:browser`, so appended flags
 * cannot be claimed by pnpm's own argument parsing on the way through.
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
 * Signal 0 checks for existence without delivering anything.
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
 * The file is written by an atomic rename, so a missing or unparseable one means "not
 * finished yet" rather than "corrupt". A kill recorded without a target is read as
 * `runner`, the conservative reading.
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
 * The pid to signal when the runner is already gone: a SIGKILLed runner never ran its
 * trap, so the suite and its dev servers outlive it.
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
 * Through a temporary file and a rename, so no reader ever sees a partial verdict.
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
 * `setsid` puts the run in a session of its own, which is what makes it survive the
 * harness killing the shell that asked for it. The supervisor runs there rather than the
 * suite itself, because the heartbeat, the rc file and the signal handler all need a
 * process that outlives the caller and knows the suite's process group.
 *
 * @param {{ command?: string[]; directory?: string; environment?: NodeJS.ProcessEnv; out?: (line: string) => void; repoRoot?: string; confirmMs?: number; platform?: NodeJS.Platform }} options
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
  platform = process.platform,
} = {}) {
  // Refused rather than ported: this needs a session of its own, a process group to
  // signal, and `/proc/<pid>/cwd`, and Windows has no equivalent of any of the three.
  if (platform === "win32") {
    out("verify:browser:detached does not run on native Windows.");
    out("It needs POSIX sessions, process groups and /proc, which Windows does not have.");
    out("Run it from WSL or the dev container. Native Windows runs `pnpm verify` only.");
    out("See docs/DEVELOPER_GUIDE.md, 'Windows and WSL'.");
    return { code: EXIT_USAGE, directory };
  }

  assertPortSeatChosen(repoRoot, "pnpm verify:browser:detached", environment[PORT_SEAT_ENV_VAR]);

  const laneDirectory = scratchPath({ directory, environment });

  // Two browser suites at one seat collide on every harness port, and the run-fresh
  // paths below would delete the live run's own log.
  const existing = readPid(join(laneDirectory, RUN_FILES.pid));
  if (existing !== undefined && isAlive(existing)) {
    out(`a detached browser run is already live in this lane: pid ${String(existing)}`);
    out(`  ${laneDirectory}`);
    out("Wait for it, or stop it with: kill " + String(existing));
    return { code: EXIT_USAGE, directory: laneDirectory };
  }

  // Removed now, so a file read back later either holds this run's output or does not
  // exist: the scratch directory is shared across sessions.
  const paths = {
    heartbeat: scratchPath({ directory, environment, name: RUN_FILES.heartbeat }),
    log: scratchPath({ directory, environment, name: RUN_FILES.log }),
    pid: scratchPath({ directory, environment, name: RUN_FILES.pid }),
    rc: scratchPath({ directory, environment, name: RUN_FILES.rc }),
  };

  const suite = command ?? playwrightCommand();
  const self = fileURLToPath(import.meta.url);
  // Cleared by port rather than by ancestry: Playwright's dev servers are not in the
  // suite's process group.
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

  // The supervisor writes its own pid file: `setsid` may fork before exec, so its pid is
  // not reliably the process that ends up holding the run.
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
 * The suite gets its own process group, but Playwright starts each `webServer` in a session of its own
 * and the dev servers survive the group signal; hence {@link releaseSeat} by port. Never `pkill -f`:
 * gate command names are identical across lanes.
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
  // Declared before the handlers below, which are installed before the pid file exists:
  // left further down it would be in its temporal dead zone for the width of that
  // window, and a signal arriving inside it would throw instead of writing an rc file.
  const elapsedSeconds = () => Number((hrtime.bigint() - started) / 1_000_000_000n);

  /** @param {string} line */
  const note = (line) => {
    appendFileSync(handle, `[verify:browser:detached] ${line}\n`);
  };

  const child = spawn(command[0] ?? "", command.slice(1), {
    detached: true,
    stdio: ["ignore", handle, handle],
  });

  // Must be installed before the pid file exists: that file invites a signal, and a kill
  // arriving before the handler takes Node's default action, leaving no rc file.
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
      killGroup(child.pid, "SIGTERM");
      setTimeout(() => {
        killGroup(child.pid, "SIGKILL");
      }, GRACE_MS).unref();
      return await releaseSeat({
        ports: releasePorts,
        graceMs: GRACE_MS,
        note,
        skipPids: new Set([process.pid, child.pid ?? -1]),
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
      // What is left to kill when the runner is gone: SIGKILL leaves no chance to trap,
      // so the suite and its dev servers survive their supervisor.
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
  // The direct child is pnpm, which reaps a signal aimed at Playwright and exits 1, so
  // the signal never reaches `child.on("exit")` and the shape looks like a red suite.
  const relayed = signal === null && code !== 0 ? relayedSignal(log) : undefined;
  const lines = [`EXIT=${String(suiteCode)}`];
  if (signalled !== undefined) {
    lines.push(`killed=${signalled}`, ...provenance);
    // Written from what the port check found, never from the intention to clean up: a
    // release that failed is the case a report has to see.
    lines.push(...releaseLines(releasePorts, await (releasing ?? Promise.resolve([]))));
  } else if (signal !== null || relayed !== undefined) {
    lines.push(
      `killed=${signal ?? relayed ?? "unknown"}`,
      ...signalProvenance({
        signal: signal ?? relayed ?? "unknown",
        target: "suite",
        seat,
        elapsedSeconds: elapsedSeconds(),
        pid: child.pid ?? 0,
        parentPid: process.pid,
        runnerPid: process.pid,
        command,
      }),
      ...(relayed === undefined
        ? []
        : [
            "signal_relay=suite-wrapper",
            `# The signal did not reach this runner's own child: pnpm reported it and exited`,
            `# ${String(code)}. Read as a kill rather than a verdict because the log says so.`,
          ]),
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
 * The sender's pid cannot be among it: Linux carries `si_pid` only to an `SA_SIGINFO`
 * handler or a `signalfd` reader, and Node exposes neither. `signalled_pid` is therefore
 * the process that was hit, which for a suite-only kill is not the runner.
 *
 * @param {{ signal: string; target: "runner" | "suite"; seat?: string; elapsedSeconds: number; pid?: number; parentPid?: number; runnerPid?: number; command?: string[]; host?: () => string[] }} options
 * @returns {string[]}
 */
export function signalProvenance({
  signal,
  target,
  seat,
  elapsedSeconds,
  pid = process.pid,
  parentPid = process.ppid,
  runnerPid = process.pid,
  command,
  host = hostSnapshot,
}) {
  return [
    `signal=${signal}`,
    `signal_target=${target}`,
    `signal_at_elapsed_seconds=${String(elapsedSeconds)}`,
    `signalled_pid=${String(pid)}`,
    `signalled_ppid=${String(parentPid)}`,
    `signalled_parent=${commandLineOf(parentPid) ?? "unreadable"}`,
    // Passed in rather than read from `/proc`: by the time a suite kill is recorded the
    // suite has exited and its `/proc` entry is gone.
    ...(command === undefined ? [] : [`signalled_command=${boundedLine(command.join(" "))}`]),
    `runner_pid=${String(runnerPid)}`,
    `seat=${seat === undefined || seat === "" ? "unrecorded" : seat}`,
    ...host(),
    "# No sender pid: Linux passes one only through SA_SIGINFO or signalfd, neither of",
    "# which Node exposes to a signal handler. The fields above are what is knowable.",
  ];
}

/**
 * Read at the moment of the signal rather than afterwards: host pressure is the leading
 * explanation for a gate that died with no failing test, and the evidence does not keep.
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

export const RELAY_SCAN_LINES = 80;

/**
 * Recovers the signal pnpm swallowed when it reaped a kill aimed at Playwright and
 * exited 1. Matched on pnpm's own wording rather than on a bare signal name, so ordinary
 * test output naming SIGTERM cannot trip it.
 *
 * @param {string} logPath
 * @param {(path: string, count: number) => string[]} [tail]
 * @returns {string | undefined}
 */
export function relayedSignal(logPath, tail = tailLines) {
  for (const line of tail(logPath, RELAY_SCAN_LINES)) {
    const killed = /\bkilled with (SIG[A-Z0-9]+)\b/.exec(line);
    if (killed?.[1] !== undefined) return killed[1];
  }
  return undefined;
}

const COMMAND_LINE_LIMIT = 200;

/**
 * The rc file is parsed a line at a time, so an embedded newline in somebody's argv
 * would split a field in half.
 *
 * @param {number} pid
 * @param {(pid: number) => string | undefined} [read]
 * @returns {string | undefined}
 */
export function commandLineOf(pid, read = readProcCmdline) {
  if (!Number.isInteger(pid) || pid < 1) return undefined;
  const raw = read(pid);
  if (raw === undefined) return undefined;
  const bounded = boundedLine(raw);
  return bounded === "" ? undefined : bounded;
}

/**
 * One rc-file field value: a single line, bounded in length, no control characters.
 *
 * @param {string} raw
 * @returns {string} the empty string when nothing survives
 */
export function boundedLine(raw) {
  const collapsed = flattenArgv(raw);
  return collapsed.length <= COMMAND_LINE_LIMIT
    ? collapsed
    : `${collapsed.slice(0, COMMAND_LINE_LIMIT)}...(truncated)`;
}

/**
 * Uncapped, unlike {@link boundedLine}: {@link isOtherSupervisor} matches a marker that
 * sits past the cap in a deeply nested worktree, and a truncated argv would silently
 * answer "not a supervisor".
 *
 * @param {string} raw
 * @returns {string}
 */
export function flattenArgv(raw) {
  // By code point rather than by a regular expression: a literal control byte fails
  // `pnpm check:no-control-chars`, and the escaped class is an ESLint `no-control-regex`
  // error, so this is the one spelling that satisfies both gates.
  const flat = [...raw]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : character;
    })
    .join("");
  return flat.replace(/\s+/g, " ").trim();
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
 * Written from the port check rather than from the attempt. `seat_survivors` reads as an
 * instruction to kill those pids, so a holder this runner refused to signal is reported
 * under its own field with the opposite advice.
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
    // An unattributable holder on this seat's own ports may be this lane's own orphan, so
    // it gets different advice from a provably foreign one.
    if (foreign.some((listener) => listener.ownership === "foreign-tree")) {
      lines.push(
        "# foreign-tree: another checkout's process, so on a shared host it is another",
        "# lane's server. Do not kill it. Take a free seat instead.",
      );
    }
    if (foreign.some((listener) => listener.ownership === "other-run")) {
      lines.push(
        "# other-run: descended from a DIFFERENT detached runner, which can happen in this",
        "# very checkout when one lane's gate and its `pnpm verify` share a seat. Do not kill",
        "# it: something is still waiting on that run. Take a free seat instead.",
      );
    }
    if (foreign.some((listener) => listener.ownership === "unattributable")) {
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
 * The guard is not tidiness: `process.kill(0, ...)` signals the caller's own group and
 * `process.kill(-1, ...)` every process this user owns, so a leader below 2 is never a
 * group worth addressing.
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
 * @typedef {"descendant" | "same-tree" | "other-run" | "foreign-tree" | "unattributable"} PortOwnership
 * @typedef {{ port: number; pid: number | undefined; ownership?: PortOwnership }} PortListener
 */

/**
 * @param {PortOwnership | undefined} ownership
 * @returns {boolean}
 */
function isOwnProcess(ownership) {
  return ownership === "descendant" || ownership === "same-tree";
}

/**
 * `/proc/<pid>/stat`'s `comm` field is parenthesised and may itself contain spaces and
 * parentheses, so the numeric fields are read from after the LAST `)`.
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

/** The separator is what stops a prefix match on a sibling directory.
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
 * The nearest ancestor holding a `.git` entry, not a path prefix: an agent lane's
 * worktree lives inside the primary checkout, so a prefix test would answer "my tree"
 * about a neighbour. A linked worktree carries a `.git` file and resolves to itself.
 *
 * @param {string} directory
 * @param {(path: string) => boolean} [hasGit]
 * @returns {string | undefined}
 */
export function checkoutRootOf(directory, hasGit = gitEntryExists) {
  let candidate = withoutTrailingSlash(directory);
  // Bounded so an unexpected path shape ends the walk rather than spinning.
  for (let hop = 0; hop < 64 && candidate !== ""; hop += 1) {
    if (hasGit(`${candidate}/.git`)) return candidate;
    const parent = candidate.slice(0, candidate.lastIndexOf("/"));
    if (parent === candidate) break;
    candidate = parent;
  }
  return undefined;
}

export const SUPERVISOR_ARGV_MARK = "verify-browser-detached.mjs supervise";

/**
 * Matched on argv rather than on a pid file: reading every lane's scratch directory is
 * the shared-state trap, and a stale pid file there is indistinguishable from a live run.
 *
 * @param {number} pid
 * @param {(pid: number) => string | undefined} [read]
 * @returns {boolean}
 */
export function isOtherSupervisor(pid, read = readProcCmdline) {
  if (pid === process.pid) return false;
  const raw = read(pid);
  if (raw === undefined) return false;
  return flattenArgv(raw).includes(SUPERVISOR_ARGV_MARK);
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
 * Two grounds: `descendant` (the parent chain reaches this runner or suite) and `same-tree` (cwd inside
 * this checkout, all that is left once dev servers are reparented to pid 1), both overruled by
 * `other-run`. Nothing else is signalled.
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
    isForeignSupervisor = isOtherSupervisor,
  } = {},
) {
  if (pid === undefined || !Number.isInteger(pid) || pid < 2) return "unattributable";
  // Bounded rather than "until pid 1": a `/proc` read racing a reparent can produce a
  // chain that loops, and that must end the walk rather than the process.
  let walker = pid;
  for (let hop = 0; hop < 64; hop += 1) {
    if (ancestors.has(walker)) return "descendant";
    // Must be tested before the checkout test: a lane's own live gate in its own checkout
    // is same-tree by every other measure, and ours is already found through `ancestors`.
    if (isForeignSupervisor(walker)) return "other-run";
    const next = parent(walker);
    if (next === undefined || next < 2 || next === walker) break;
    walker = next;
  }
  const directory = workingDirectory(pid);
  if (directory === undefined) return "unattributable";
  const mine = checkoutRoot(repoRoot);
  const theirs = checkoutRoot(directory);
  // No `.git` above a path means the question cannot be answered, not that the answer is
  // yes, so `mine === theirs` holds only when NEITHER side resolved to a checkout.
  if (mine === undefined || theirs === undefined) {
    return isInside(directory, repoRoot) && mine === theirs ? "same-tree" : "unattributable";
  }
  return withoutTrailingSlash(mine) === withoutTrailingSlash(theirs) ? "same-tree" : "foreign-tree";
}

/**
 * An unattributable holder is spelled `unknown` rather than `0`, because 0 is a real
 * argument to `kill` meaning the caller's own process group and must never appear
 * anywhere a person might copy it into one.
 *
 * @param {PortListener} listener
 * @returns {string}
 */
export function describeListener({ port, pid }) {
  return `${String(port)}:${pid === undefined ? "unknown" : String(pid)}`;
}

/**
 * The grounds are appended because "outside this checkout" and "could not be attributed
 * at all" lead a reader to different next steps.
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
 * Mirrors `seatOccupants` in `apps/portal/e2e/support/port-seat.ts` rather than importing
 * it, because that file is TypeScript nothing compiles and this is plain JavaScript bare
 * `node` runs. A pid of `undefined` is an occupied port with an unknown holder, never a
 * free one: the question is whether the seat is clear, not whether it is ours.
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
 * @param {number | undefined} pid
 * @param {NodeJS.Signals} signal
 * @param {Set<number>} skipPids
 * @param {(line: string) => void} note
 * @returns {boolean} whether a signal was actually delivered
 */
function signalPid(pid, signal, skipPids, note) {
  // 0 is this process's own group and 1 is init: a `pid ?? 0` upstream is how 0 gets here.
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
 * By port, not ancestry, because both dev servers survive a signal to the suite's group. One pid per
 * call, never a pattern match. Every holder is checked with {@link ownershipOf} first; only an empty
 * return earns "seat released".
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
      if (!isOwnProcess(ownership)) {
        note(
          `port ${String(port)} is held by pid ${who} (${ownership ?? "unattributable"}): NOT ` +
            "signalling it, it is not this run's process (issue #902)",
        );
        continue;
      }
      note(`port ${String(port)} still held by pid ${who} (${ownership ?? "?"})`);
      const key = `${who}:${signal}`;
      if (signalled.has(key)) continue;
      signalled.add(key);
      signalPid(pid, signal, skipPids, note);
    }
    return listeners;
  };

  /**
   * "Nothing we own" rather than "nothing at all": signalling a foreign holder is
   * refused, so waiting for it to go away would cost the full grace period for nothing.
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
 * The bound is the point: a harness cap is shorter than the suite, so the wait returns
 * before it with {@link EXIT_STILL_RUNNING} rather than being killed at it with a code
 * that looks like a red suite. A caller re-invokes while it sees that code.
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
      // No rc and no runner means SIGKILL, so the seat's dev servers are probably still
      // holding their ports.
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
