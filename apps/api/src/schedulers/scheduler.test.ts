import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNullLogger } from "../logger.js";
import { createIntervalScheduler } from "./scheduler.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const logger = createNullLogger();

describe("createIntervalScheduler (exit criterion 5, first half)", () => {
  it("runs the task once per interval while running", async () => {
    let runs = 0;
    const s = createIntervalScheduler({
      name: "t",
      intervalMs: 100,
      jitterMs: 0,
      random: () => 0,
      logger,
      task: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(350); // ticks at 100, 200, 300
    expect(runs).toBe(3);
    await s.stop();
  });

  it("start() is idempotent - a second call does not double-schedule", async () => {
    let runs = 0;
    const s = createIntervalScheduler({
      name: "t",
      intervalMs: 100,
      jitterMs: 0,
      random: () => 0,
      logger,
      task: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    s.start();
    s.start(); // no-op
    s.start(); // no-op
    expect(s.running).toBe(true);
    await vi.advanceTimersByTimeAsync(350);
    // A single chain: exactly 3 runs, not 9.
    expect(runs).toBe(3);
    await s.stop();
  });

  it("stop() halts scheduling and is idempotent", async () => {
    let runs = 0;
    const s = createIntervalScheduler({
      name: "t",
      intervalMs: 100,
      jitterMs: 0,
      random: () => 0,
      logger,
      task: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(250); // 2 runs
    await s.stop();
    expect(s.running).toBe(false);
    const after = runs;
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(after); // nothing more scheduled
    await s.stop(); // second stop resolves immediately
  });

  it("stop() waits for an in-flight run (graceful)", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;
    const s = createIntervalScheduler({
      name: "t",
      intervalMs: 100,
      jitterMs: 0,
      random: () => 0,
      logger,
      task: async () => {
        await gate;
        finished = true;
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(100); // enters the task; it awaits the gate

    let stopped = false;
    const stopping = s.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false); // still waiting on the in-flight run
    expect(finished).toBe(false);

    release?.();
    await stopping;
    expect(finished).toBe(true);
    expect(stopped).toBe(true);
  });

  it("continues scheduling after a task rejection (logged, not fatal)", async () => {
    let runs = 0;
    const s = createIntervalScheduler({
      name: "t",
      intervalMs: 100,
      jitterMs: 0,
      random: () => 0,
      logger,
      task: () => {
        runs += 1;
        return Promise.reject(new Error("transient"));
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toBeGreaterThanOrEqual(2); // kept going despite rejections
    await s.stop();
  });

  it("adds jitter within [0, jitterMs] to the interval", async () => {
    let runs = 0;
    const s = createIntervalScheduler({
      name: "t",
      intervalMs: 100,
      jitterMs: 50,
      random: () => 0.5, // → +25ms → 125ms per tick
      logger,
      task: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(124);
    expect(runs).toBe(0); // not yet - first tick is at 125ms
    await vi.advanceTimersByTimeAsync(2);
    expect(runs).toBe(1);
    await s.stop();
  });
});
