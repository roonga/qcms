#!/usr/bin/env node
// @ts-check
/**
 * Run a Next build, waiting out a concurrent build of the SAME app (issue #925).
 *
 * ## What the lock actually is
 *
 * Since Next 16, `next build` takes an advisory file lock on `<distDir>/lock` and
 * refuses to start while another live process holds it:
 *
 * ```text
 * Another next build process is already running.
 *
 *   This could be:
 *   - A next build still in progress
 *   - A previous build that didn't exit cleanly
 * ```
 *
 * The lock path is `path.join(distDir, 'lock')`, taken under
 * `experimental.lockDistDir` (default `true`) - vercel/next.js v16.3.5,
 * `packages/next/src/build/index.ts` lines 1264-1270, message raised in
 * `packages/next/src/build/lockfile.ts` line 225 (`acquireWithRetriesOrExit`, which
 * retries for 1000 ms in 10 ms steps and then exits 1). The feature landed in
 * vercel/next.js PR #84428, "Acquire a lockfile on `distDir` in `next dev` and
 * `next build`"; `distDir` itself is documented at
 * https://nextjs.org/docs/app/api-reference/config/next-config-js/distDir.
 *
 * So the lock is keyed on a directory INSIDE the checkout - `apps/portal/.next` or
 * `apps/admin/.next` here - and it is a live lock held on an open descriptor, not the
 * presence of a file. Two facts follow, and both were measured against the pinned Next
 * before this script was written (`scripts/next-build.test.ts` asserts the parts that
 * can be asserted without a build):
 *
 *   - **A sibling worktree cannot cause this.** Two lanes hold two different paths,
 *     and two different paths never collide. Issue #925 was filed on the opposite
 *     assumption (a per-user lock in a temp directory), and reading the message as
 *     cross-lane contention sends a lane to re-run "on a quieter moment" when what it
 *     has is a second build of its own.
 *   - **A lock file left behind by a killed build is harmless.** The lock is released
 *     when the file descriptor closes, so a stale `.next/lock` is acquired normally.
 *     Only a process that is still ALIVE blocks the build.
 *
 * ## So what does cause it, and why wait
 *
 * Something in this checkout is building the same app right now. In this repository
 * that is one of two shapes, and neither is helped by failing:
 *
 *   - Two turbo invocations at once in one checkout - a `pnpm verify` beside a
 *     `pnpm exec turbo run test --force`, the shape issues #494, #798 and #863
 *     describe from the `dist/` side.
 *   - An orphaned `next build` from a run whose wrapper was killed at a harness cap
 *     (issue #846). The wrapper dies, the build does not, and it holds the lock until
 *     it finishes.
 *
 * Both end by themselves. This script therefore waits for the lock rather than
 * reporting a red build: it re-runs the build while the failure carries the lock
 * signature and nothing else, bounded at {@link DEFAULT_WAIT_MS}, and it names the
 * process holding the lock - pid, working directory and command line - so the wait is
 * attributed rather than mysterious. Any other failure is returned untouched on the
 * first attempt, because a build that is genuinely broken must stay broken.
 *
 * Usage (cwd = the app root, as a package `build` script):
 *
 *   node ../../scripts/next-build.mjs next build
 *   node ../../scripts/next-build.mjs --lock-dir .next next build
 *
 * Env:
 *   QCMS_NEXT_BUILD_WAIT_MS   how long to keep waiting (default 600000, 10 minutes)
 *   QCMS_NEXT_BUILD_POLL_MS   how long between attempts (default 5000)
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The production build directory both Next apps here use, and therefore where their
 * lock lives. Each app's `next.config.ts` returns `.next` for every non-dev phase;
 * `scripts/next-build.test.ts` asserts that rather than trusting this constant, so a
 * config that moved it fails a test instead of quietly disabling the diagnostic.
 */
export const DEFAULT_LOCK_DIR = ".next";

/** How long to keep waiting for another build before giving up (issue #925 asks 10 minutes). */
export const DEFAULT_WAIT_MS = 600_000;

/** How long between attempts. `next build` itself gives up on the lock after about a second. */
export const DEFAULT_POLL_MS = 5_000;

/** How often the wait prints a line, so a long wait is visible rather than silent. */
export const PROGRESS_INTERVAL_MS = 30_000;

/** The tail of the child's output kept for signature matching, in bytes. */
export const OUTPUT_TAIL_BYTES = 64 * 1024;

/**
 * The line Next prints when it cannot take the build lock, with the colouring removed.
 * Matched on the sentence rather than on the whole block: the bullets under it are
 * advice and could be reworded upstream without the meaning changing.
 */
const CONTENTION_PATTERN = /Another\s+next build\s+process is already running/;

/**
 * The two control characters an escape sequence can start with, built rather than
 * written: `check:no-control-chars` refuses a source file that contains either one,
 * and it is right to - an invisible byte in a pattern is unreviewable.
 */
const SEQUENCE_STARTS = [String.fromCharCode(0x1b), String.fromCharCode(0x9b)].join("");

/** CSI and OSC sequences, which turbo's `FORCE_COLOR` puts inside the sentence above. */
const ANSI_PATTERN = new RegExp(
  `[${SEQUENCE_STARTS}][[\\]()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><]`,
  "g",
);

/**
 * @param {string} text
 * @returns {string} the same text with terminal escape sequences removed
 */
export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * Is this failure the build lock rather than a broken build?
 *
 * @param {string} output combined stdout and stderr of the attempt
 * @returns {boolean}
 */
export function isBuildLockContention(output) {
  return CONTENTION_PATTERN.test(stripAnsi(output));
}

/**
 * The pids `/proc/locks` reports as holding a lock on `inode`.
 *
 * A row is `<id>: <type> <mode> <access> <pid> <major>:<minor>:<inode> <start> <end>`,
 * with an optional `->` after the id marking a blocked WAITER rather than a holder -
 * the one distinction that matters here, so waiters are dropped. Matching is on the
 * inode alone; the device is not decoded, because {@link lockHolders} confirms every
 * candidate by looking for the file itself among that process's open descriptors,
 * which an inode collision on another device cannot survive.
 *
 * @param {string} text contents of `/proc/locks`
 * @param {number} inode
 * @returns {number[]} pids, in the order the file lists them, without duplicates
 */
export function parseLockHolderPids(text, inode) {
  /** @type {number[]} */
  const pids = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) continue;
    // Drop the `<id>:` column, then skip the row entirely if it is a waiter.
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

/** The real reads, each one best-effort: a process can exit between two of them. */
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
 * Who holds the build lock, as lines fit to print.
 *
 * Every read is allowed to fail and the answer is then simply shorter: this is a
 * diagnostic printed on a path that is already waiting, and `/proc` is a moving target
 * on which the honest failure mode is silence rather than a crash. Nothing here
 * signals anything - it reads.
 *
 * @param {string} lockPath absolute path of the build lock
 * @param {ProcIo} [io]
 * @returns {string[]} one line per holder, empty when nothing could be established
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
 * Does this process have the lock file open? The confirmation that makes matching on
 * an inode alone safe.
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
    // Unreadable (another user's process, or one already gone). Reporting the pid
    // unconfirmed would be worse than reporting nothing: this text is read as an
    // accusation.
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
 * @returns {string} the process's command line, NUL separators turned back into spaces
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
 * Run the build, waiting out a concurrent build of the same app.
 *
 * The loop is deliberately "re-run the build" rather than "poll the lock, then build":
 * `next build` gives up on the lock in about a second, so an attempt IS the poll, and
 * it cannot race the way a separate check-then-act would.
 *
 * @param {object} options
 * @param {() => Promise<Attempt>} options.run one build attempt
 * @param {() => string[]} options.holders who holds the lock, for the wait message
 * @param {(line: string) => void} options.log
 * @param {(ms: number) => Promise<void>} options.sleep
 * @param {() => number} options.now
 * @param {number} options.waitMs
 * @param {number} options.pollMs
 * @returns {Promise<number>} the exit code to leave with
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
 * @returns {number} whole seconds, for a message a person reads
 */
function seconds(ms) {
  return Math.round(ms / 1000);
}

/**
 * @param {string[]} args everything after the script path
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
 * The executable to spawn for a bare command name.
 *
 * pnpm puts the calling package's `node_modules/.bin` on `PATH`, so `next` resolves
 * for every route this script is actually wired into. It does not resolve when the
 * script is run by hand from the app directory, and `spawn next ENOENT` is a poor
 * answer to "why did my build not start", so a bare name is looked for in the app's
 * own bin directory first. A name that already carries a path separator is the
 * caller's to resolve.
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
 * Spawn one attempt, teeing the child's output so the build looks exactly as it does
 * without this wrapper while the signature is still matchable.
 *
 * `FORCE_COLOR` is set when this process has a terminal, because piping the child's
 * output is what would otherwise take its colours away.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<Attempt>}
 */
function spawnAttempt(command, args) {
  return new Promise((resolveAttempt, rejectAttempt) => {
    const child = spawn(resolveCommand(command, cwd()), args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: stdout.isTTY ? { ...env, FORCE_COLOR: env.FORCE_COLOR ?? "1" } : env,
    });
    let output = "";
    /**
     * @param {Buffer} chunk
     * @param {NodeJS.WriteStream} sink
     */
    const tee = (chunk, sink) => {
      sink.write(chunk);
      output = (output + chunk.toString("utf8")).slice(-OUTPUT_TAIL_BYTES);
    };
    child.stdout?.on("data", (chunk) => tee(chunk, stdout));
    child.stderr?.on("data", (chunk) => tee(chunk, stderr));
    child.on("error", rejectAttempt);
    child.on("close", (code, signal) => {
      // A signalled child is not a lock failure and must not be retried: report it the
      // way a shell does, so a harness kill stays legible as a kill.
      resolveAttempt({ code: signal === null ? (code ?? 1) : 128 + signalNumber(signal), output });
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

/** @returns {Promise<number>} process exit code */
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
