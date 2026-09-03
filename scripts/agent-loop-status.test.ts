import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_STALE_HOURS,
  LOG_NAME,
  assess,
  findSupervisors,
  parseArgs,
  readLog,
  render,
} from "./agent-loop-status.mjs";

/**
 * Supervisor visibility (issue #597).
 *
 * The failure being guarded against is a confident wrong answer, in either direction:
 * the dev seat ran unsupervised for three weeks while both seats believed a safety net
 * was in place, and the correction is not a supervisor that never stops but a check that
 * says truthfully whether it has. So the cases here are the three ways a naive check
 * would lie: a stopped supervisor read as running, a stuck one read as healthy, and an
 * unreadable process table read as "nothing is running".
 */

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "qcms-agent-loop-status-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** A checkout holding an `agent-loop.log` with `contents`, last written `ageHours` ago. */
function checkoutWithLog(contents: string, ageHours: number): string {
  const directory = temporaryDirectory();
  const path = join(directory, LOG_NAME);
  writeFileSync(path, contents, "utf8");
  const when = new Date(Date.now() - ageHours * 3_600_000);
  utimesSync(path, when, when);
  return directory;
}

/** A `/proc` stand-in holding one process whose command line is `argv`. */
function procWith(entries: Record<string, string[]>): string {
  const root = temporaryDirectory();
  for (const [pid, argumentList] of Object.entries(entries)) {
    mkdirSync(join(root, pid), { recursive: true });
    writeFileSync(join(root, pid, "cmdline"), `${argumentList.join("\0")}\0`, "utf8");
  }
  // A non-numeric entry, as the real /proc has, to prove the filter is on the name.
  mkdirSync(join(root, "self"), { recursive: true });
  return root;
}

/** The line the supervisor's log really ended on when #597 was filed. */
const THE_2026_08_01_LOG = [
  "2026-08-01 05:52:11  iteration 5: launching fresh session",
  "2026-08-01 05:52:11  seat mail: delivering 1 message(s) into the prompt",
  "You've hit your session limit",
  "2026-08-01 06:23:46  limit reset detected at 10:20 - sleeping until then",
  "",
].join("\n");

describe("findSupervisors", () => {
  it("finds the supervisor whether it was launched by path or by name", () => {
    const proc = procWith({
      "101": ["bash", "scripts/agent-loop.sh", "--parallel", "3"],
      "102": ["/bin/bash", "/opt/qcms/scripts/agent-loop.sh"],
    });
    const found = findSupervisors(proc, 0);
    expect(found?.map((supervisor) => supervisor.pid).sort((a, b) => a - b)).toEqual([101, 102]);
  });

  it("does not count a process that merely mentions the script", () => {
    // `grep agent-loop.sh`, an editor with the file open, or this check itself. Counting
    // one would produce the exact false all-clear the issue is about.
    const proc = procWith({
      "201": ["grep", "-r", "agent-loop.sh", "."],
      "202": ["node", "scripts/agent-loop-status.mjs"],
      "203": ["grep", "/opt/qcms/scripts/agent-loop.sh", "."],
      "204": ["vim", "scripts/agent-loop.sh"],
    });
    expect(findSupervisors(proc, 0)).toEqual([]);
  });

  it("skips its own pid, so the check never reports itself as the supervisor", () => {
    const proc = procWith({ "301": ["bash", "scripts/agent-loop.sh"] });
    expect(findSupervisors(proc, 301)).toEqual([]);
  });

  it("returns undefined when the process table cannot be read, rather than an empty list", () => {
    expect(findSupervisors(join(temporaryDirectory(), "absent"), 0)).toBeUndefined();
  });
});

describe("readLog", () => {
  it("surfaces the last line, the last start and the last sentinel", () => {
    const checkout = checkoutWithLog(
      [
        "2026-08-01 05:00:00  supervisor start: '/next-work 3', retry 30m, max 100 iterations",
        "2026-08-01 05:30:00  NEXT-WORK: LANDED issue #123",
        "2026-08-01 06:23:46  limit reset detected at 10:20 - sleeping until then",
        "",
      ].join("\n"),
      1,
    );
    const log = readLog(join(checkout, LOG_NAME));
    expect(log.exists).toBe(true);
    expect(log.lastStart).toMatch(/supervisor start/);
    expect(log.lastSentinel).toMatch(/NEXT-WORK: LANDED issue #123/);
    expect(log.lastLine).toMatch(/sleeping until then/);
    expect(log.ageHours).toBeGreaterThan(0.9);
  });

  it("reports an absent log without throwing", () => {
    expect(readLog(join(temporaryDirectory(), LOG_NAME)).exists).toBe(false);
  });
});

describe("assess", () => {
  const log = (contents: string, ageHours: number) =>
    readLog(join(checkoutWithLog(contents, ageHours), LOG_NAME));

  it("calls a live supervisor with a current log RUNNING", () => {
    const status = assess({
      supervisors: [{ pid: 1, cwd: "/repo", since: Date.now(), command: "bash agent-loop.sh" }],
      log: log("2026-09-03 05:00:00  iteration 2: launching fresh session\n", 0.5),
      staleHours: DEFAULT_STALE_HOURS,
    });
    expect(status.verdict).toBe("RUNNING");
  });

  it("calls a live supervisor with a long-silent log STALLED", () => {
    // A process that exists is not a supervisor that is working. `ps` alone cannot tell
    // the two apart, which is why the log age is read beside it.
    const status = assess({
      supervisors: [{ pid: 1, cwd: "/repo", since: 0, command: "bash agent-loop.sh" }],
      log: log(THE_2026_08_01_LOG, 24),
      staleHours: DEFAULT_STALE_HOURS,
    });
    expect(status.verdict).toBe("STALLED");
    expect(status.reason).toMatch(/has not moved/);
  });

  it("names a run that died mid-iteration, which is exactly what #597 found", () => {
    const status = assess({
      supervisors: [],
      log: log(THE_2026_08_01_LOG, 500),
      staleHours: DEFAULT_STALE_HOURS,
    });
    expect(status.verdict).toBe("STOPPED");
    expect(status.reason).toMatch(/died mid-iteration/);
  });

  it("distinguishes a deliberate stop from a death", () => {
    const status = assess({
      supervisors: [],
      log: log("2026-09-01 10:00:00  supervisor exit\n", 500),
      staleHours: DEFAULT_STALE_HOURS,
    });
    expect(status.verdict).toBe("STOPPED");
    expect(status.reason).toMatch(/clean `supervisor exit`/);
  });

  it("says UNKNOWN when liveness cannot be read, never 'stopped'", () => {
    const status = assess({
      supervisors: undefined,
      log: log("2026-09-01 10:00:00  supervisor exit\n", 1),
      staleHours: DEFAULT_STALE_HOURS,
    });
    expect(status.verdict).toBe("UNKNOWN");
  });
});

describe("render", () => {
  it("prints the last log line whatever the verdict, because that is the line nobody read", () => {
    const checkout = checkoutWithLog(THE_2026_08_01_LOG, 500);
    const text = render(
      assess({
        supervisors: [],
        log: readLog(join(checkout, LOG_NAME)),
        staleHours: DEFAULT_STALE_HOURS,
      }),
    );
    expect(text).toMatch(/^agent-loop: STOPPED/);
    expect(text).toContain("sleeping until then");
  });
});

describe("parseArgs", () => {
  it("defaults the window to the supervisor's own longest legitimate sleep", () => {
    // `scripts/agent-loop.sh` caps a limit-reset sleep at 21600 seconds, so a silence
    // longer than six hours is not explainable by waiting out a usage limit. The two
    // numbers have to agree or the check reports a healthy supervisor as stalled.
    const supervisor = readFileSync(
      fileURLToPath(new URL("agent-loop.sh", import.meta.url)),
      "utf8",
    );
    expect(supervisor).toContain("21600");
    expect(DEFAULT_STALE_HOURS * 3600).toBe(21600);
    expect(parseArgs([])).toEqual({ json: false, staleHours: DEFAULT_STALE_HOURS });
  });

  it("rejects an unusable window instead of disabling the staleness check", () => {
    expect(() => parseArgs(["--stale-hours", "later"])).toThrow(/positive number/);
    expect(() => parseArgs(["--verbose"])).toThrow(/unknown option/);
  });
});
