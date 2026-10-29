/**
 * A `setTimeout` chain rather than `setInterval`, so runs never overlap and each tick
 * carries its own jitter: several instances polling the same tables spread their load
 * instead of stampeding.
 */

import type { Logger } from "../logger.js";

export interface Scheduler {
  /** Idempotent: a second call while running is a no-op. */
  start(): void;
  /** Waits for any in-flight run to finish. Idempotent. */
  stop(): Promise<void>;
  readonly running: boolean;
}

export interface IntervalSchedulerOptions {
  readonly name: string;
  readonly intervalMs: number;
  readonly jitterMs?: number;
  /** A rejection is logged and scheduling continues. */
  readonly task: () => Promise<void>;
  readonly logger: Logger;
  readonly random?: () => number;
}

export function createIntervalScheduler(options: IntervalSchedulerOptions): Scheduler {
  const jitterMs = options.jitterMs ?? 0;
  const random = options.random ?? Math.random;

  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  const nextDelay = (): number => options.intervalMs + Math.floor(random() * (jitterMs + 1));

  const scheduleNext = (): void => {
    if (!running) return;
    timer = setTimeout(runOnce, nextDelay());
    // Do not keep the event loop alive solely for the scheduler.
    timer.unref?.();
  };

  const runOnce = (): void => {
    inFlight = (async () => {
      try {
        await options.task();
      } catch (err) {
        options.logger.error("scheduler task failed", { scheduler: options.name, err });
      }
    })();
    // The IIFE above wraps its whole body in try/catch, so this rejects only if the logger
    // itself throws, and a handler could only try to log again.
    // eslint-disable-next-line qcms/no-unhandled-then -- rejects only if the logger itself throws; see above
    void inFlight.then(() => {
      inFlight = undefined;
      scheduleNext();
    });
  };

  return {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      scheduleNext();
    },
    async stop() {
      if (!running) return;
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (inFlight !== undefined) {
        await inFlight;
      }
    },
  };
}
