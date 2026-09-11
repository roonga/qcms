#!/usr/bin/env node
// @ts-check
/**
 * Is time in this environment trustworthy enough to wait on? (issue #590)
 *
 * The reported symptom was "the dev container's clock is frozen": across a session
 * whose `sleep` calls totalled well over an hour, `date` advanced about a minute, so
 * every sleep-based wait returned at once and polling a twelve-minute gate cost dozens
 * of turns. Three different faults produce that same appearance, they need different
 * fixes, and none of them can be told apart by reading `date` twice:
 *
 *  1. **The wall clock is frozen or stepped.** `CLOCK_REALTIME` stands still (or jumps
 *     backwards) while real time passes. Sleeping still works; only the readings lie.
 *  2. **Timers do not wait.** The process asks for two seconds and is resumed at once.
 *  3. **The `sleep` binary returns early.** The clocks are fine and in-process timers
 *     are fine, but the thing a shell poll loop is built on comes straight back. An
 *     agent harness that refuses or short-circuits a foreground `sleep` lands here, and
 *     it is indistinguishable from a frozen clock if `date` is your only instrument.
 *
 * So this check measures one two-second wait of each kind against BOTH clocks and names
 * which of the three it found. `CLOCK_MONOTONIC` (via `process.hrtime.bigint`) is the
 * control: it cannot be set, only advanced, so a wait that is long on the monotonic
 * clock and short on the wall clock isolates fault 1 from faults 2 and 3.
 *
 * Usage: `pnpm check:clock` (or `node scripts/check-clock.mjs`)
 *
 * Deliberately NOT part of `check:all`. It costs four seconds of pure waiting, it
 * asserts a property of the machine rather than of the tree, and a gate that is slow
 * for reasons the diff can never change is a gate people learn to route around. Run it
 * when waits look wrong. What to do when it fails is in `docs/DEVELOPER_GUIDE.md`,
 * under "Waiting for a long gate".
 */

import { spawnSync } from "node:child_process";
import { argv, exit, hrtime } from "node:process";
import { pathToFileURL } from "node:url";

/** How long each of the two waits asks for. */
export const SLEEP_MS = 2000;

/**
 * The floor a wait has to clear to count as real. Generous on purpose: the question is
 * "did this wait at all", not "is the scheduler punctual", and 1.5s of a requested 2s
 * leaves room for a loaded machine without admitting an instant return.
 */
export const MIN_ADVANCE_MS = 1500;

/** Milliseconds on the wall clock, which can be set, stepped, slewed or frozen. */
const wallClockNow = () => Date.now();

/** Milliseconds on the monotonic clock, which can only ever move forwards. */
const monotonicNow = () => Number(hrtime.bigint() / 1000n) / 1000;

/**
 * Wait in-process, the way a Node script or a test timeout waits.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const timerWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait by running the `sleep` binary, the way a shell poll loop waits.
 *
 * @param {number} seconds
 * @returns {{ ran: boolean; detail: string }}
 */
function runSleepBinary(seconds) {
  const result = spawnSync("sleep", [String(seconds)], { stdio: "ignore" });
  if (result.error !== undefined) return { ran: false, detail: result.error.message };
  if (result.signal !== null) return { ran: false, detail: `killed by ${result.signal}` };
  if (result.status !== 0) return { ran: false, detail: `exit ${String(result.status)}` };
  return { ran: true, detail: "exit 0" };
}

/**
 * One wait, timed on both clocks at once.
 *
 * @param {() => void | Promise<void>} wait
 * @param {{ wall: () => number; monotonic: () => number }} clocks
 * @returns {Promise<{ wall: number; monotonic: number }>}
 */
export async function timeBothClocks(wait, clocks) {
  const wallBefore = clocks.wall();
  const monotonicBefore = clocks.monotonic();
  await wait();
  return {
    wall: clocks.wall() - wallBefore,
    monotonic: clocks.monotonic() - monotonicBefore,
  };
}

/**
 * @typedef {{ wall: number; monotonic: number }} Elapsed
 * @typedef {{ timer: Elapsed; binary: Elapsed | null; binaryDetail: string }} Measurements
 */

/**
 * Turn the measurements into a verdict and the lines to print.
 *
 * Ordered so the most fundamental fault is named first: a wall clock that does not
 * advance makes every other reading here untrustworthy, including the ones this check
 * would otherwise use to accuse the timers.
 *
 * @param {Measurements} measured
 * @param {{ sleepMs?: number; minAdvanceMs?: number }} [limits]
 * @returns {{ ok: boolean; lines: string[] }}
 */
export function verdict(measured, limits = {}) {
  const sleepMs = limits.sleepMs ?? SLEEP_MS;
  const minAdvanceMs = limits.minAdvanceMs ?? MIN_ADVANCE_MS;
  /** @param {number} value */
  const ms = (value) => `${value.toFixed(0)}ms`;
  const asked = `asked for ${ms(sleepMs)}, floor ${ms(minAdvanceMs)}`;

  const lines = [
    `in-process timer: wall +${ms(measured.timer.wall)}, monotonic +${ms(measured.timer.monotonic)}`,
  ];
  if (measured.binary === null) {
    lines.push(`sleep binary: not measured (${measured.binaryDetail})`);
  } else {
    lines.push(
      `sleep binary: wall +${ms(measured.binary.wall)}, ` +
        `monotonic +${ms(measured.binary.monotonic)}`,
    );
  }

  /** @type {string[]} */
  const faults = [];
  const monotonicWaited = measured.timer.monotonic >= minAdvanceMs;

  if (measured.timer.wall < minAdvanceMs && monotonicWaited) {
    faults.push(
      `the WALL CLOCK is frozen or stepped: a wait of ${ms(measured.timer.monotonic)} on the ` +
        `monotonic clock advanced Date.now() by only ${ms(measured.timer.wall)}. Anything that ` +
        `measures elapsed time from a timestamp is wrong here, including test timeouts, ` +
        `cookie Max-Age assertions and rate limits.`,
    );
  } else if (!monotonicWaited) {
    faults.push(
      `IN-PROCESS TIMERS do not wait: setTimeout(${ms(sleepMs)}) returned after ` +
        `${ms(measured.timer.monotonic)} on the monotonic clock. Nothing built on a timer can ` +
        `be trusted to wait, test timeouts included.`,
    );
  }

  if (measured.binary !== null && measured.binary.monotonic < minAdvanceMs && monotonicWaited) {
    faults.push(
      `the SLEEP BINARY returns early: 'sleep ${(sleepMs / 1000).toFixed(0)}' took ` +
        `${ms(measured.binary.monotonic)}. In-process timers are fine, so this is something ` +
        `between the shell and the binary rather than the clock: a shell poll loop will spin ` +
        `and cost a turn per iteration. Wait on the process instead - ` +
        `'tail --pid=<pid> -f /dev/null' blocks on the process, not on elapsed time.`,
    );
  }

  if (faults.length === 0) {
    lines.push(`OK: both waits cleared the floor (${asked}).`);
    return { ok: true, lines };
  }
  for (const fault of faults) lines.push(`FAIL: ${fault}`);
  lines.push(`(${asked}; see docs/DEVELOPER_GUIDE.md, "Waiting for a long gate")`);
  return { ok: false, lines };
}

/**
 * @param {{
 *   clocks?: { wall: () => number; monotonic: () => number };
 *   wait?: (ms: number) => void | Promise<void>;
 *   sleepBinary?: (seconds: number) => { ran: boolean; detail: string };
 *   sleepMs?: number;
 *   minAdvanceMs?: number;
 *   log?: (line: string) => void;
 * }} [options]
 * @returns {Promise<number>} process exit code
 */
export async function main(options = {}) {
  const clocks = options.clocks ?? { wall: wallClockNow, monotonic: monotonicNow };
  const wait = options.wait ?? timerWait;
  const sleepBinary = options.sleepBinary ?? runSleepBinary;
  const sleepMs = options.sleepMs ?? SLEEP_MS;
  const minAdvanceMs = options.minAdvanceMs ?? MIN_ADVANCE_MS;
  const log = options.log ?? ((line) => console.log(line));

  const timer = await timeBothClocks(() => wait(sleepMs), clocks);

  // A `sleep` that could not run at all is reported, not failed: this check is about
  // whether waiting works, and a platform without the binary has not answered that
  // question either way.
  /** @type {{ ran: boolean; detail: string }} */
  let outcome = { ran: false, detail: "not attempted" };
  const timed = await timeBothClocks(() => {
    outcome = sleepBinary(sleepMs / 1000);
  }, clocks);
  const binary = outcome.ran ? timed : null;
  const binaryDetail = outcome.ran ? outcome.detail : `could not run 'sleep': ${outcome.detail}`;

  const { ok, lines } = verdict({ timer, binary, binaryDetail }, { sleepMs, minAdvanceMs });
  for (const line of lines) log(line);
  return ok ? 0 : 1;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(await main());
}
