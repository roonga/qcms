/**
 * The scheduling shell (task 017; ARCHITECTURE §5.3).
 *
 * The API process hosts background schedulers, started by the server entry
 * (`serve.ts`), never by a handler - so fetch-purity is untouched. This is the
 * generic shell: a self-rescheduling interval with jitter, idempotent
 * start/stop, and graceful stop that waits for an in-flight run to finish.
 * The *work* each scheduler does is supplied as `task`; the outbox deliverer's
 * actual delivery logic lands in 025.
 *
 * Self-rescheduling (a `setTimeout` chain) rather than `setInterval` so runs
 * never overlap and each interval can carry independent jitter - several API
 * instances polling the same tables spread their load instead of stampeding.
 */

import type { Logger } from "../logger.js";

export interface Scheduler {
  /** Begin scheduling. Idempotent: a second call while running is a no-op. */
  start(): void;
  /**
   * Stop scheduling and wait for any in-flight run to finish (graceful).
   * Idempotent: a second call resolves immediately.
   */
  stop(): Promise<void>;
  /** Whether the scheduler is currently active. */
  readonly running: boolean;
}

export interface IntervalSchedulerOptions {
  /** Human-readable name for log lines. */
  readonly name: string;
  /** Base delay between runs, in ms. */
  readonly intervalMs: number;
  /** Max extra random delay added per tick, in ms (default 0). */
  readonly jitterMs?: number;
  /** The work to run each tick. Rejections are logged; scheduling continues. */
  readonly task: () => Promise<void>;
  /** Logger for run failures. */
  readonly logger: Logger;
  /** Injectable randomness for deterministic jitter in tests (default Math.random). */
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
