#!/usr/bin/env node
// @ts-check
/**
 * Three different faults look identical to a frozen clock when `date` is the only
 * instrument, and each needs a different fix: a wall clock that is frozen or stepped,
 * in-process timers that do not wait, and a `sleep` binary that does not wait. So each
 * kind of wait is measured against BOTH clocks. The monotonic clock is the control,
 * because it cannot be set, only advanced.
 *
 * Deliberately not part of `check:all`: it asserts a property of the machine rather than
 * of the tree, and costs seconds of pure waiting to do it.
 */

import { spawnSync } from "node:child_process";
import { argv, exit, hrtime } from "node:process";
import { pathToFileURL } from "node:url";

export const SLEEP_MS = 2000;

/**
 * Generous on purpose: the question is whether the wait happened at all, not whether the
 * scheduler is punctual, so a loaded machine has room without an instant return passing.
 */
export const MIN_ADVANCE_MS = 1500;

/** Milliseconds on the wall clock, which can be set, stepped, slewed or frozen. */
const wallClockNow = () => Date.now();

/** Milliseconds on the monotonic clock, which can only ever move forwards. */
const monotonicNow = () => Number(hrtime.bigint() / 1000n) / 1000;

const timerWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Three outcomes, not two. Never spawned leaves the question unanswered, so it is reported
 * rather than failed. Spawned and not completed is a failure: a harness that will not let
 * a foreground `sleep` run is as likely to kill or refuse it as to short-circuit it, and
 * calling that "not measured" would pass on a machine where shell waiting is broken.
 */
function runSleepBinary(seconds) {
  const result = spawnSync("sleep", [String(seconds)], { stdio: "ignore" });
  if (result.error !== undefined) {
    return { spawned: false, completed: false, detail: result.error.message };
  }
  if (result.signal !== null) {
    return { spawned: true, completed: false, detail: `killed by ${result.signal}` };
  }
  if (result.status !== 0) {
    return { spawned: true, completed: false, detail: `exit ${String(result.status)}` };
  }
  return { spawned: true, completed: true, detail: "exit 0" };
}

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
 * @typedef {{
 *   timer: Elapsed;
 *   binary: Elapsed | null;
 *   binaryDetail: string;
 *   binaryFailure?: string | null;
 * }} Measurements
 */

/**
 * Ordered so the most fundamental fault is named first: a wall clock that does not advance
 * makes every other reading here untrustworthy, the timer readings included.
 */
export function verdict(measured, limits = {}) {
  const sleepMs = limits.sleepMs ?? SLEEP_MS;
  const minAdvanceMs = limits.minAdvanceMs ?? MIN_ADVANCE_MS;
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
        `monotonic +${ms(measured.binary.monotonic)} (${measured.binaryDetail})`,
    );
  }

  /** @type {string[]} */
  const faults = [];
  const monotonicWaited = measured.timer.monotonic >= minAdvanceMs;
  const binaryFailure = measured.binaryFailure ?? null;

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

  if (binaryFailure !== null) {
    faults.push(
      `the SLEEP BINARY did not complete: 'sleep ${(sleepMs / 1000).toFixed(0)}' ran and then ` +
        `${binaryFailure}. A shell poll loop cannot wait here at all, and this is the same ` +
        `finding as a sleep that returns early rather than a missing tool: whatever refuses a ` +
        `foreground wait is as free to kill it as to short-circuit it. Wait on the process ` +
        `instead - 'tail --pid=<pid> -f /dev/null' blocks on the process, not on elapsed time.`,
    );
  } else if (
    measured.binary !== null &&
    measured.binary.monotonic < minAdvanceMs &&
    monotonicWaited
  ) {
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

export async function main(options = {}) {
  const clocks = options.clocks ?? { wall: wallClockNow, monotonic: monotonicNow };
  const wait = options.wait ?? timerWait;
  const sleepBinary = options.sleepBinary ?? runSleepBinary;
  const sleepMs = options.sleepMs ?? SLEEP_MS;
  const minAdvanceMs = options.minAdvanceMs ?? MIN_ADVANCE_MS;
  const log = options.log ?? ((line) => console.log(line));

  const timer = await timeBothClocks(() => wait(sleepMs), clocks);

  /** @type {{ spawned: boolean; completed: boolean; detail: string }} */
  let outcome = { spawned: false, completed: false, detail: "not attempted" };
  const timed = await timeBothClocks(() => {
    outcome = sleepBinary(sleepMs / 1000);
  }, clocks);
  const binary = outcome.spawned ? timed : null;
  const binaryDetail = outcome.spawned
    ? outcome.detail
    : `could not run 'sleep': ${outcome.detail}`;
  const binaryFailure = outcome.spawned && !outcome.completed ? outcome.detail : null;

  const { ok, lines } = verdict(
    { timer, binary, binaryDetail, binaryFailure },
    { sleepMs, minAdvanceMs },
  );
  for (const line of lines) log(line);
  return ok ? 0 : 1;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(await main());
}
