#!/usr/bin/env node
// @ts-check
/**
 * Runs a Next build, waiting out a concurrent build of the same app: `next build` locks `<distDir>/lock`
 * (next 16.4.2, `packages/next/src/build/index.ts:1370-1376`; message in `packages/next/src/build/lockfile.ts:225`), re-read on a `next` bump.
 * Only a live build of this app holds it, never a sibling worktree or a stale file, so this waits and names the holder.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import nodeProcess, { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Each app's `next.config.ts` returns this for every non-dev phase. A test asserts that
 * rather than trusting the constant, so a config that moved it fails instead of quietly
 * disabling the diagnostic.
 */
export const DEFAULT_LOCK_DIR = ".next";

export const DEFAULT_WAIT_MS = 600_000;

/** `next build` itself gives up on the lock after about a second. */
export const DEFAULT_POLL_MS = 5_000;

export const PROGRESS_INTERVAL_MS = 30_000;

/**
 * In UTF-16 code units, which is what `String.prototype.slice` counts, so this is not
 * named for bytes.
 */
export const OUTPUT_TAIL_UNITS = 64 * 1024;

/**
 * Matched on the sentence rather than the whole block, because the bullets under it are
 * advice and could be reworded upstream without the meaning changing.
 */
const CONTENTION_PATTERN = /Another\s+next build\s+process is already running/;

/**
 * Built rather than written literally: `check:no-control-chars` refuses a source file
 * containing either, and an invisible byte in a pattern is unreviewable.
 */
const SEQUENCE_STARTS = [String.fromCharCode(0x1b), String.fromCharCode(0x9b)].join("");

/** turbo's `FORCE_COLOR` puts these inside the sentence above. */
const ANSI_PATTERN = new RegExp(
  `[${SEQUENCE_STARTS}][[\\]()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><]`,
  "g",
);

/**
 * @param {string} text
 * @returns {string}
 */
export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * @param {string} output
 * @returns {boolean}
 */
export function isBuildLockContention(output) {
  return CONTENTION_PATTERN.test(stripAnsi(output));
}

/**
 * A row is `<id>: <type> <mode> <access> <pid> <major>:<minor>:<inode> <start> <end>`,
 * and an optional `->` after the id marks a blocked waiter rather than a holder.
 *
 * Matching is on the inode alone because {@link lockHolders} confirms every candidate
 * against that process's open descriptors, which an inode collision cannot survive.
 *
 * @param {string} text
 * @param {number} inode
 * @returns {number[]}
 */
export function parseLockHolderPids(text, inode) {
  /** @type {number[]} */
  const pids = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) continue;
    const rest = fields.slice(1);
    if (rest[0] === "->") continue;
    const pid = Number(rest[3]);
    const inodeField = rest[4]?.split(":")[2];
    if (!Number.isInteger(pid) || inodeField === undefined) continue;
    if (Number(inodeField) !== inode) continue;
    if (!pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

/**
 * The filesystem reads this module makes, injected so the tests can describe a host
 * rather than need one.
 *
 * @typedef {object} ProcIo
 * @property {(path: string) => string} readText
 * @property {(path: string) => string[]} readDir
 * @property {(path: string) => string} readLink
 * @property {(path: string) => number} inodeOf
 */

/** Each read is best-effort: a process can exit between two of them. */
export const nodeProcIo = {
  /** @param {string} path */
  readText: (path) => readFileSync(path, "utf8"),
  /** @param {string} path */
  readDir: (path) => readdirSync(path),
  /** @param {string} path */
  readLink: (path) => readlinkSync(path),
  /** @param {string} path */
  inodeOf: (path) => Number(statSync(path).ino),
};

/**
 * `/proc` is a moving target, so every read may fail and the answer is then shorter:
 * on a diagnostic path the honest failure mode is silence rather than a crash. This
 * only reads; it signals nothing.
 *
 * @param {string} lockPath
 * @param {ProcIo} [io]
 * @returns {string[]}
 */
export function lockHolders(lockPath, io = nodeProcIo) {
  /** @type {number} */
  let inode;
  try {
    inode = io.inodeOf(lockPath);
  } catch {
    return [];
  }
  /** @type {number[]} */
  let pids;
  try {
    pids = parseLockHolderPids(io.readText("/proc/locks"), inode);
  } catch {
    return [];
  }
  /** @type {string[]} */
  const lines = [];
  for (const pid of pids) {
    if (!holdsFile(pid, lockPath, io)) continue;
    lines.push(`pid ${pid}  cwd ${procValue(io, `/proc/${pid}/cwd`, true)}  ${commandOf(pid, io)}`);
  }
  return lines;
}

/**
 * The confirmation that makes matching on an inode alone safe.
 *
 * @param {number} pid
 * @param {string} lockPath
 * @param {ProcIo} io
 * @returns {boolean}
 */
function holdsFile(pid, lockPath, io) {
  /** @type {string[]} */
  let entries;
  try {
    entries = io.readDir(`/proc/${pid}/fd`);
  } catch {
    // Unreadable, so report nothing: this text is read as an accusation, and an
    // unconfirmed pid would be worse than silence.
    return false;
  }
  for (const entry of entries) {
    try {
      if (io.readLink(`/proc/${pid}/fd/${entry}`) === lockPath) return true;
    } catch {
      // The descriptor closed between the listing and the read.
    }
  }
  return false;
}

/**
 * @param {ProcIo} io
 * @param {string} path
 * @param {boolean} asLink
 * @returns {string}
 */
function procValue(io, path, asLink) {
  try {
    return asLink ? io.readLink(path) : io.readText(path);
  } catch {
    return "(unknown)";
  }
}

/**
 * @param {number} pid
 * @param {ProcIo} io
 * @returns {string}
 */
function commandOf(pid, io) {
  const raw = procValue(io, `/proc/${pid}/cmdline`, false);
  const command = raw.replaceAll(String.fromCharCode(0), " ").trim();
  return command === "" ? "(unknown)" : command;
}

/**
 * @typedef {object} Attempt
 * @property {number} code the child's exit code, or 128+signal when it was signalled
 * @property {string} output combined stdout and stderr
 */

/**
 * The loop re-runs the build rather than polling the lock and then building: an attempt
 * is the poll, so it cannot race the way a separate check-then-act would.
 *
 * @param {object} options
 * @param {() => Promise<Attempt>} options.run
 * @param {() => string[]} options.holders
 * @param {(line: string) => void} options.log
 * @param {(ms: number) => Promise<void>} options.sleep
 * @param {() => number} options.now
 * @param {number} options.waitMs
 * @param {number} options.pollMs
 * @returns {Promise<number>}
 */
export async function buildWaitingForLock({ run, holders, log, sleep, now, waitMs, pollMs }) {
  const startedAt = now();
  let lastProgressAt = startedAt;
  let waits = 0;
  for (;;) {
    const attempt = await run();
    const waitedMs = now() - startedAt;
    if (attempt.code === 0) {
      if (waits > 0) {
        log(`next-build: waited ${seconds(waitedMs)} s for another next build in this checkout.`);
      }
      return 0;
    }
    if (!isBuildLockContention(attempt.output)) return attempt.code;
    if (waitedMs >= waitMs) {
      log(
        `next-build: gave up after ${seconds(waitedMs)} s. Another next build in THIS checkout ` +
          `still holds the build lock, so this is contention inside the checkout rather than a ` +
          `broken build. It is never a sibling worktree: the lock is on this app's own build ` +
          `directory (issue #925).`,
      );
      for (const holder of holders()) log(`next-build:   holder: ${holder}`);
      return attempt.code;
    }
    if (waits === 0 || now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now();
      log(
        `next-build: another next build in this checkout holds the build lock; waiting ` +
          `(${seconds(waitedMs)} s of ${seconds(waitMs)} s).`,
      );
      for (const holder of holders()) log(`next-build:   holder: ${holder}`);
    }
    waits += 1;
    await sleep(pollMs);
  }
}

/**
 * @param {number} ms
 * @returns {number}
 */
function seconds(ms) {
  return Math.round(ms / 1000);
}

/**
 * @param {string[]} args
 * @returns {{ ok: true; lockDir: string; command: string; commandArgs: string[] } | { ok: false; reason: string }}
 */
export function parseArgs(args) {
  let lockDir = DEFAULT_LOCK_DIR;
  let index = 0;
  while (args[index] === "--lock-dir") {
    const value = args[index + 1];
    if (value === undefined) return { ok: false, reason: "--lock-dir needs a directory" };
    lockDir = value;
    index += 2;
  }
  const command = args[index];
  if (command === undefined) return { ok: false, reason: "no build command given" };
  return { ok: true, lockDir, command, commandArgs: args.slice(index + 1) };
}

/**
 * pnpm puts the package's `node_modules/.bin` on `PATH`, but a hand-run from the app
 * directory has no such `PATH`, and `spawn next ENOENT` is a poor answer to "why did my
 * build not start". A name carrying a path separator is the caller's to resolve.
 *
 * @param {string} command
 * @param {string} packageRoot
 * @param {(path: string) => boolean} [exists]
 * @returns {string}
 */
export function resolveCommand(command, packageRoot, exists = existsSync) {
  if (command.includes("/") || command.includes("\\")) return command;
  const local = join(packageRoot, "node_modules", ".bin", command);
  return exists(local) ? local : command;
}

/**
 * One argument, quoted for `cmd.exe`, which takes a doubled quote as a literal one.
 *
 * @param {string} value
 * @returns {string}
 */
function quoteForShell(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * What to hand `spawn`, per platform.
 *
 * Windows runs the `next.CMD` shim, which Node refuses to start without a shell. A shell is
 * used only there: it reports a missing command as its own exit 1, hiding the 127.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} packageRoot
 * @param {NodeJS.Platform} [platform]
 * @param {(path: string) => boolean} [exists]
 * @returns {{ command: string, args: string[], shell: boolean }}
 */
export function resolveSpawn(
  command,
  args,
  packageRoot,
  platform = nodeProcess.platform,
  exists = existsSync,
) {
  if (platform !== "win32") {
    return { command: resolveCommand(command, packageRoot, exists), args, shell: false };
  }
  const named = command.includes("/") || command.includes("\\");
  if (named) {
    if (!/.(?:cmd|bat)$/i.test(command)) return { command, args, shell: false };
    return { command: [command, ...args].map(quoteForShell).join(" "), args: [], shell: true };
  }
  const shim = join(packageRoot, "node_modules", ".bin", `${command}.CMD`);
  const resolved = exists(shim) ? shim : command;
  return { command: [resolved, ...args].map(quoteForShell).join(" "), args: [], shell: true };
}

/**
 * Forwarded so a wrapper killed at a harness cap does not leave `next build` reparented
 * and still holding the lock. `SIGKILL` is absent because it cannot be caught; only a
 * process group could close that gap.
 */
export const FORWARDED_SIGNALS = /** @type {const} */ (["SIGTERM", "SIGINT", "SIGHUP"]);

/**
 * `FORCE_COLOR` is set when this process has a terminal, because piping the child's
 * output would otherwise take its colours away. Piping still costs the child its TTY,
 * so `next build` lays its output out at a default width.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<Attempt>}
 */
function spawnAttempt(command, args) {
  return new Promise((resolveAttempt) => {
    const plan = resolveSpawn(command, args, cwd());
    /** @type {import("node:child_process").SpawnOptions} */
    const options = {
      stdio: ["inherit", "pipe", "pipe"],
      env: stdout.isTTY ? { ...env, FORCE_COLOR: env.FORCE_COLOR ?? "1" } : env,
      shell: plan.shell,
    };
    // Argv is omitted in the shell case, so DEP0190 never fires.
    const child = plan.shell
      ? spawn(plan.command, options)
      : spawn(plan.command, plan.args, options);
    let output = "";
    /**
     * @param {Buffer} chunk
     * @param {NodeJS.WriteStream} sink
     */
    const tee = (chunk, sink) => {
      sink.write(chunk);
      output = (output + chunk.toString("utf8")).slice(-OUTPUT_TAIL_UNITS);
    };
    child.stdout?.on("data", (chunk) => tee(chunk, stdout));
    child.stderr?.on("data", (chunk) => tee(chunk, stderr));

    // Registered per attempt and removed on close: listeners accumulated across a
    // hundred attempts would trip Node's max-listeners warning into the build log.
    /** @type {NodeJS.Signals | undefined} the signal this wrapper was asked to stop on */
    let forwarded;
    /** @type {Array<[NodeJS.Signals, () => void]>} */
    const forwarders = FORWARDED_SIGNALS.map((signal) => [
      signal,
      () => {
        forwarded ??= signal;
        child.kill(signal);
      },
    ]);
    for (const [signal, handler] of forwarders) nodeProcess.on(signal, handler);
    const stopForwarding = () => {
      for (const [signal, handler] of forwarders) nodeProcess.off(signal, handler);
    };

    child.on("error", (error) => {
      // A spawn failure is not a lock failure and must not be retried.
      stopForwarding();
      console.error(`next-build: could not start ${command}: ${error.message}`);
      resolveAttempt({ code: 127, output: "" });
    });
    child.on("close", (code, signal) => {
      // A signalled run is not a lock failure and must not be retried. `forwarded` is
      // the case where the build caught the signal and exited cleanly: the run was still
      // interrupted, and reporting 0 would hide that behind a success.
      stopForwarding();
      const stoppedBy = signal ?? forwarded;
      resolveAttempt({
        code:
          stoppedBy === undefined || stoppedBy === null
            ? (code ?? 1)
            : 128 + signalNumber(stoppedBy),
        output,
      });
    });
  });
}

/**
 * @param {NodeJS.Signals} signal
 * @returns {number}
 */
function signalNumber(signal) {
  const known = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
  return known[/** @type {keyof typeof known} */ (signal)] ?? 0;
}

/** @returns {Promise<number>} */
async function main() {
  const parsed = parseArgs(argv.slice(2));
  if (!parsed.ok) {
    console.error(`next-build: ${parsed.reason}`);
    console.error(
      "usage: node ../../scripts/next-build.mjs [--lock-dir <dir>] <command> [args...]",
    );
    return 64;
  }
  const lockPath = join(resolve(cwd(), parsed.lockDir), "lock");
  return await buildWaitingForLock({
    run: () => spawnAttempt(parsed.command, parsed.commandArgs),
    holders: () => lockHolders(lockPath),
    log: (line) => console.error(line),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    waitMs: positiveNumber(env.QCMS_NEXT_BUILD_WAIT_MS, DEFAULT_WAIT_MS),
    pollMs: positiveNumber(env.QCMS_NEXT_BUILD_POLL_MS, DEFAULT_POLL_MS),
  });
}

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
export function positiveNumber(raw, fallback) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(await main());
}
