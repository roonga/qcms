import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MIN_ADVANCE_MS, SLEEP_MS, main, timeBothClocks, verdict } from "./check-clock.mjs";

/**
 * The clock check (issue #590).
 *
 * Three different faults look identical from a shell - a frozen wall clock, timers that
 * do not wait, and a `sleep` binary that returns at once - and the check exists to tell
 * them apart. So the tests drive each fault with injected clocks and waits rather than
 * by sleeping, and assert on WHICH fault is named, not merely that something failed. A
 * check that failed for the wrong reason would send the next person to the wrong fix.
 *
 * One test does run the real script, because everything above it is only as good as the
 * default wiring underneath.
 */

const SCRIPT = fileURLToPath(new URL("check-clock.mjs", import.meta.url));

/** A pair of clocks whose readings are handed out in order, so time is scripted. */
function scriptedClocks(wall: number[], monotonic: number[]) {
  const next = (queue: number[]) => () => {
    const value = queue.shift();
    if (value === undefined) throw new Error("clock read more times than the test scripted");
    return value;
  };
  return { wall: next([...wall]), monotonic: next([...monotonic]) };
}

/** Elapsed pairs for the two waits, as `timeBothClocks` reads them: before, after. */
function readings(timer: [number, number], binary: [number, number]) {
  return [timer[0], timer[1], binary[0], binary[1]];
}

const ran = { ran: true, detail: "exit 0" };

async function run(options: Parameters<typeof main>[0]) {
  const lines: string[] = [];
  const code = await main({ ...options, log: (line: string) => lines.push(line) });
  return { code, output: lines.join("\n") };
}

describe("timeBothClocks", () => {
  it("reports each clock's own advance across the same wait", async () => {
    const clocks = scriptedClocks([1000, 1002], [500, 2500]);
    const elapsed = await timeBothClocks(() => undefined, clocks);
    expect(elapsed).toEqual({ wall: 2, monotonic: 2000 });
  });

  it("awaits an asynchronous wait before reading the clocks again", async () => {
    let settled = false;
    const clocks = {
      wall: () => (settled ? 2000 : 0),
      monotonic: () => (settled ? 2000 : 0),
    };
    const elapsed = await timeBothClocks(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            settled = true;
            resolve();
          }, 1);
        }),
      clocks,
    );
    expect(elapsed.monotonic).toBe(2000);
  });
});

describe("verdict", () => {
  it("passes when both waits clear the floor on both clocks", () => {
    const result = verdict({
      timer: { wall: 2002, monotonic: 2002 },
      binary: { wall: 2004, monotonic: 2004 },
      binaryDetail: "exit 0",
    });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("OK");
  });

  it("names the wall clock when only the monotonic clock advanced", () => {
    const result = verdict({
      timer: { wall: 30, monotonic: 2001 },
      binary: { wall: 30, monotonic: 2002 },
      binaryDetail: "exit 0",
    });
    expect(result.ok).toBe(false);
    const output = result.lines.join("\n");
    expect(output).toContain("WALL CLOCK is frozen or stepped");
    // The wall clock being wrong is not evidence about the sleep binary, whose own
    // monotonic reading here is fine. Accusing both would bury the real fault.
    expect(output).not.toContain("SLEEP BINARY");
  });

  it("names in-process timers when the monotonic clock shows no wait at all", () => {
    const result = verdict({
      timer: { wall: 1, monotonic: 1 },
      binary: { wall: 1, monotonic: 1 },
      binaryDetail: "exit 0",
    });
    expect(result.ok).toBe(false);
    const output = result.lines.join("\n");
    expect(output).toContain("IN-PROCESS TIMERS do not wait");
    // Same reason as above: with timers broken, the binary's reading proves nothing.
    expect(output).not.toContain("SLEEP BINARY");
  });

  it("names the sleep binary when only it returns early, and points at tail --pid", () => {
    const result = verdict({
      timer: { wall: 2002, monotonic: 2002 },
      binary: { wall: 3, monotonic: 3 },
      binaryDetail: "exit 0",
    });
    expect(result.ok).toBe(false);
    const output = result.lines.join("\n");
    expect(output).toContain("SLEEP BINARY returns early");
    expect(output).toContain("tail --pid=<pid> -f /dev/null");
  });

  it("reports an unavailable sleep binary without failing on it", () => {
    const result = verdict({
      timer: { wall: 2002, monotonic: 2002 },
      binary: null,
      binaryDetail: "could not run 'sleep': ENOENT",
    });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("not measured (could not run 'sleep': ENOENT)");
  });

  it("honours a caller's floor rather than only the default", () => {
    const measured = {
      timer: { wall: 1800, monotonic: 1800 },
      binary: { wall: 1800, monotonic: 1800 },
      binaryDetail: "exit 0",
    };
    expect(verdict(measured).ok).toBe(true);
    expect(verdict(measured, { sleepMs: 2000, minAdvanceMs: 1900 }).ok).toBe(false);
  });
});

describe("main", () => {
  it("exits 0 when both waits are real", async () => {
    const { code, output } = await run({
      clocks: scriptedClocks(readings([0, 2002], [2002, 4006]), readings([0, 2002], [2002, 4006])),
      wait: () => undefined,
      sleepBinary: () => ran,
    });
    expect(code).toBe(0);
    expect(output).toContain("OK");
  });

  it("exits 1 and names the frozen wall clock", async () => {
    const { code, output } = await run({
      // The wall clock stands still while the monotonic clock records both waits.
      clocks: scriptedClocks([0, 0, 0, 0], readings([0, 2002], [2002, 4006])),
      wait: () => undefined,
      sleepBinary: () => ran,
    });
    expect(code).toBe(1);
    expect(output).toContain("WALL CLOCK is frozen or stepped");
  });

  it("exits 1 and names the sleep binary when only the binary returns at once", async () => {
    const { code, output } = await run({
      clocks: scriptedClocks(readings([0, 2002], [2002, 2005]), readings([0, 2002], [2002, 2005])),
      wait: () => undefined,
      sleepBinary: () => ran,
    });
    expect(code).toBe(1);
    expect(output).toContain("SLEEP BINARY returns early");
  });

  it("asks each wait for the configured duration", async () => {
    const asked: number[] = [];
    await run({
      clocks: scriptedClocks(readings([0, 400], [400, 800]), readings([0, 400], [400, 800])),
      wait: (ms: number) => {
        asked.push(ms);
      },
      sleepBinary: (seconds: number) => {
        asked.push(seconds);
        return ran;
      },
      sleepMs: 400,
      minAdvanceMs: 300,
    });
    expect(asked).toEqual([400, 0.4]);
  });

  it("runs for real and reports a machine where waiting works", { timeout: 30_000 }, () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(result.stdout).toContain("in-process timer:");
    expect(result.stdout).toContain("sleep binary:");
    // Asserted rather than skipped: if waiting is broken on the machine running this
    // suite, that is exactly the finding issue #590 is about and it should be loud.
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe("the published limits", () => {
  it("keeps the floor below what it asks for, so a loaded machine is not a failure", () => {
    expect(MIN_ADVANCE_MS).toBeLessThan(SLEEP_MS);
    expect(MIN_ADVANCE_MS).toBeGreaterThan(SLEEP_MS / 2);
  });
});
