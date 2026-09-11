import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_SLICE_SECONDS,
  EXIT_RUNNER_KILLED,
  EXIT_RUNNER_VANISHED,
  EXIT_STILL_RUNNING,
  EXIT_USAGE,
  RUN_FILES,
  isAlive,
  listenersOnPorts,
  parseArgs,
  playwrightCommand,
  readPid,
  readRc,
  releaseLines,
  startDetached,
  tailLines,
  validateShard,
  waitForRun,
  writeAtomic,
} from "./verify-browser-detached.mjs";

/**
 * The detached browser runner (issue #846).
 *
 * The defect it removes is that a harness kill at a per-command cap and a red suite look
 * identical from outside: both are a nonzero exit code over a truncated log. So what
 * these tests pin is the part that makes them distinguishable - the rc file protocol,
 * and the wait loop's exit codes - plus the argument parsing, because a bad argument
 * discovered by Playwright is a bad argument discovered half an hour late.
 *
 * No browser runs here. The suite is replaced by a fake child, which is what makes the
 * kill paths testable at all: a real 30-minute suite cannot be SIGTERMed in a unit test.
 */

const SCRIPT = fileURLToPath(new URL("verify-browser-detached.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const temporaryDirectories: string[] = [];
const spawnedPids: number[] = [];

/**
 * Kill one pid, refusing the values that mean something else entirely.
 *
 * `process.kill(0, ...)` signals the CALLER'S own process group, which here is the
 * Vitest runner: a `pid ?? 0` in a teardown is how a test suite kills itself.
 */
function killPid(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined || !Number.isInteger(pid) || pid < 2) return;
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone, which is the point.
  }
}

afterAll(() => {
  for (const pid of spawnedPids) killPid(pid, "SIGKILL");
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "qcms-detached-runner-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** A child that never exits on its own, standing in for the half-hour suite. */
const SLEEPER = [
  process.execPath,
  "-e",
  "process.stdout.write('fake suite running\\n'); setInterval(() => {}, 1000);",
];

/** A child that exits with a chosen code, standing in for a finished suite. */
function exiter(code: number): string[] {
  return [
    process.execPath,
    "-e",
    `process.stdout.write('fake suite line 1\\nfake suite line 2\\n'); process.exit(${String(code)});`,
  ];
}

/** Run `supervise` the way `start` runs it, but in the foreground of this test. */
function supervise(directory: string, command: string[], extra: string[] = []): number {
  const child = spawn(
    process.execPath,
    [
      SCRIPT,
      "supervise",
      "--log",
      join(directory, RUN_FILES.log),
      "--pid",
      join(directory, RUN_FILES.pid),
      "--rc",
      join(directory, RUN_FILES.rc),
      "--heartbeat",
      join(directory, RUN_FILES.heartbeat),
      ...extra,
      "--",
      ...command,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error("the supervisor did not start");
  spawnedPids.push(pid);
  return pid;
}

/** A port nothing is listening on right now, for the seat-release fixtures. */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

async function until(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("parseArgs", () => {
  it("takes a shard plan and a project, and hands the rest to Playwright verbatim", () => {
    expect(parseArgs(["start", "--shard", "1/2", "--project", "admin-chromium"])).toEqual({
      mode: "start",
      projects: ["admin-chromium"],
      shard: "1/2",
      passthrough: [],
    });
    expect(parseArgs(["start", "--", "--grep", "@smoke"])).toEqual({
      mode: "start",
      projects: [],
      passthrough: ["--grep", "@smoke"],
    });
  });

  it("refuses a shard plan Playwright would only reject half an hour in", () => {
    expect(() => parseArgs(["start", "--shard", "2"])).toThrow(/1-based/);
    expect(() => parseArgs(["start", "--shard", "3/2"])).toThrow(/exceeds total/);
    expect(() => validateShard("0/2")).toThrow(/1-based/);
  });

  it("refuses an unknown start option rather than passing it on", () => {
    expect(() => parseArgs(["start", "--headed"])).toThrow(/pass Playwright flags after --/);
  });

  it("defaults the wait slice and reads the overrides", () => {
    expect(parseArgs(["wait", "/run/dir"])).toEqual({
      mode: "wait",
      directory: "/run/dir",
      sliceSeconds: DEFAULT_SLICE_SECONDS,
      tailLines: 40,
    });
    expect(parseArgs(["wait", "/run/dir", "--slice", "300", "--tail", "80"])).toMatchObject({
      sliceSeconds: 300,
      tailLines: 80,
    });
    expect(() => parseArgs(["wait"])).toThrow(/requires the run directory/);
    expect(() => parseArgs(["wait", "/run/dir", "--slice", "0"])).toThrow(/positive integer/);
  });

  it("requires every protocol file and a command for the detached side", () => {
    expect(() => parseArgs(["supervise", "--log", "/l", "--", "true"])).toThrow(
      /requires --heartbeat/,
    );
    expect(() =>
      parseArgs(["supervise", "--log", "/l", "--heartbeat", "/h", "--", "true"]),
    ).toThrow(/requires --pid/);
    expect(() =>
      parseArgs(["supervise", "--log", "/l", "--pid", "/p", "--rc", "/r", "--heartbeat", "/h"]),
    ).toThrow(/requires a command/);
    expect(
      parseArgs([
        "supervise",
        "--log",
        "/l",
        "--pid",
        "/p",
        "--rc",
        "/r",
        "--heartbeat",
        "/h",
        "--release-port",
        "17200",
        "--release-port",
        "17240",
        "--",
        "true",
      ]),
    ).toMatchObject({ releasePorts: [17200, 17240] });
  });

  it("names the modes rather than guessing one", () => {
    expect(() => parseArgs([])).toThrow(/expected a mode/);
    expect(() => parseArgs(["run"])).toThrow(/unknown mode/);
  });
});

describe("playwrightCommand", () => {
  it("runs the same suite verify:browser runs", () => {
    expect(playwrightCommand()).toEqual(["pnpm", "exec", "playwright", "test"]);
  });

  it("spells --project with an equals sign, because Playwright's --project is variadic", () => {
    // The space form swallows the next argument as a second project name and fails with
    // "Project(s) ... not found" (issue #890). Four lanes hit that in one week.
    expect(playwrightCommand({ projects: ["admin-chromium"], shard: "1/2" })).toEqual([
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--project=admin-chromium",
      "--shard=1/2",
    ]);
  });

  it("stays the command package.json's verify:browser runs", () => {
    // The detached form and the CI form must be the same suite. If `verify:browser` ever
    // grows a flag, this is where the drift shows up rather than in a green that proved
    // something else.
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["verify:browser"]).toBe("playwright test");
    expect(playwrightCommand().slice(2).join(" ")).toBe(manifest.scripts["verify:browser"]);
  });
});

describe("the rc file protocol", () => {
  it("reads nothing while the run has not finished", () => {
    const directory = temporaryDirectory();
    expect(readRc(join(directory, RUN_FILES.rc))).toBeUndefined();
  });

  it("reads a finished run's code", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(path, "EXIT=1\nelapsed_seconds=1900\n");
    expect(readRc(path)).toEqual({ code: 1, signalled: false });
  });

  it("separates a killed run from a red one, which is the whole point", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(path, "EXIT=143\nkilled=SIGTERM\nelapsed_seconds=1500\n");
    expect(readRc(path)).toEqual({ code: 143, signalled: true });
  });

  it("treats an unparseable file as unfinished rather than as a verdict", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeFileSync(path, "EXI", "utf8");
    expect(readRc(path)).toBeUndefined();
  });

  it("leaves no temporary file behind, so a reader cannot catch a torn write", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(path, "EXIT=0\n");
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("reads the runner pid past the comment lines that tell an operator what to do", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.pid);
    writeAtomic(path, "4321\n# runner pid\n# Stop the run with: kill 4321\n");
    expect(readPid(path)).toBe(4321);
    expect(readPid(join(directory, "absent"))).toBeUndefined();
    expect(isAlive(0)).toBe(false);
    expect(isAlive(process.pid)).toBe(true);
  });

  it("tails a log, and says so rather than throwing when there is none", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.log);
    writeFileSync(path, "one\ntwo\nthree\n", "utf8");
    expect(tailLines(path, 2)).toEqual(["two", "three"]);
    expect(tailLines(join(directory, "absent"), 2)[0]).toMatch(/no log at/);
  });
});

describe("supervise", () => {
  it("records a finished run's code and its own pid", async () => {
    const directory = temporaryDirectory();
    supervise(directory, exiter(3));
    await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);
    expect(readRc(join(directory, RUN_FILES.rc))).toEqual({ code: 3, signalled: false });
    const pid = readPid(join(directory, RUN_FILES.pid));
    expect(pid).toBeGreaterThan(0);
    expect(readFileSync(join(directory, RUN_FILES.log), "utf8")).toContain("fake suite line 2");
  });

  it("records a SIGTERM as a kill and not as a verdict, and stops the suite with it", async () => {
    const directory = temporaryDirectory();
    supervise(directory, SLEEPER);
    await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
    const runner = readPid(join(directory, RUN_FILES.pid));
    await until(() => readFileSync(join(directory, RUN_FILES.log), "utf8").includes("fake suite"));

    killPid(runner, "SIGTERM");
    await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);

    const rc = readRc(join(directory, RUN_FILES.rc));
    expect(rc?.signalled).toBe(true);
    const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
    expect(recorded).toMatch(/killed=SIGTERM/);
    expect(recorded).toMatch(/not a test verdict/);
    // The seat release: the suite's process group goes down with the runner rather than
    // surviving reparented to pid 1 and holding this seat's harness ports (issue #295).
    await until(() => !isAlive(runner ?? 0));
  });
});

describe("releasing the seat", () => {
  it("kills a separately-sessioned grandchild holding a port, which the group signal cannot reach", async () => {
    // This is the defect the first head of this branch shipped. Playwright starts each
    // `webServer` in a session of ITS own, so the two `next dev` servers are not in the
    // suite's process group and `kill(-pgid)` structurally cannot reach them: measured
    // twice on a real seat, both `next-server` processes were still bound to their ports
    // 25 s after the runner was SIGTERMed, while the rc file claimed "Seat released".
    // The fixture reproduces that shape exactly - a child that puts its listener in
    // another session - and a fake child with no such grandchild is why the old test was
    // green.
    const directory = temporaryDirectory();
    const port = await reserveFreePort();
    writeFileSync(
      join(directory, "server.mjs"),
      [
        'import { createServer } from "node:net";',
        "createServer().listen(Number(process.argv[2]), '127.0.0.1', () => {",
        "  process.stdout.write(`grandchild ${String(process.pid)} listening\\n`);",
        "});",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(directory, "suite.mjs"),
      [
        'import { spawn } from "node:child_process";',
        // `setsid`, which is what Playwright's webServer does and what puts the listener
        // outside this process's group.
        'spawn("setsid", [process.execPath, process.argv[2], process.argv[3]], {',
        '  stdio: "inherit",',
        "});",
        "process.stdout.write('fake suite running\\n');",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "utf8",
    );

    const runnerPid = supervise(
      directory,
      [process.execPath, join(directory, "suite.mjs"), join(directory, "server.mjs"), String(port)],
      ["--release-port", String(port)],
    );
    await until(() => listenersOnPorts([port]).length === 1, 20_000);
    const grandchild = listenersOnPorts([port])[0]?.pid;
    expect(grandchild).toBeGreaterThan(1);
    // It really is in a session of its own, so the group kill below cannot reach it.
    expect(readFileSync(`/proc/${String(grandchild ?? 0)}/stat`, "utf8").split(" ")[5]).toBe(
      String(grandchild),
    );

    killPid(runnerPid, "SIGTERM");
    await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined, 30_000);

    expect(listenersOnPorts([port])).toEqual([]);
    expect(isAlive(grandchild ?? 0)).toBe(false);
    const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
    expect(recorded).toMatch(/killed=SIGTERM/);
    expect(recorded).toMatch(/Seat released/);
    expect(recorded).not.toMatch(/seat_survivors=/);
  }, 60_000);

  it("says nothing was released when it was given no ports to release", async () => {
    const directory = temporaryDirectory();
    const runnerPid = supervise(directory, SLEEPER);
    await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
    killPid(runnerPid, "SIGTERM");
    await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);
    const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
    expect(recorded).toMatch(/No seat ports were given, so nothing was released/);
    expect(recorded).not.toMatch(/Seat released/);
  });

  it("finds a listener by port, which is how the seat is cleared by port and not by ancestry", async () => {
    const port = await reserveFreePort();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      expect(listenersOnPorts([port])).toEqual([{ port, pid: process.pid }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(listenersOnPorts([port])).toEqual([]);
    expect(listenersOnPorts([])).toEqual([]);
  });

  it("writes the seat's state from the port check, never from the attempt", () => {
    expect(releaseLines([], []).join("\n")).toMatch(/No seat ports were given/);
    expect(releaseLines([17200, 17240], []).join("\n")).toMatch(
      /Seat released: nothing is listening on 17200, 17240/,
    );
    const survived = releaseLines([17200, 17240], [{ port: 17200, pid: 4242 }]).join("\n");
    expect(survived).toMatch(/seat_survivors=17200:4242/);
    expect(survived).toMatch(/THE SEAT WAS NOT RELEASED/);
    expect(survived).not.toMatch(/Seat released:/);
  });
});

describe("waitForRun", () => {
  it("exits with the suite's own code when the run finishes", async () => {
    const directory = temporaryDirectory();
    supervise(directory, exiter(0));
    await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);
    const lines: string[] = [];
    const code = await waitForRun({
      directory,
      sliceSeconds: 5,
      pollMs: 25,
      out: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("EXIT=0");
    expect(lines.join("\n")).toContain("fake suite line 2");
  });

  it("exits 75 with the tail when the slice ends and the suite is still running", async () => {
    const directory = temporaryDirectory();
    supervise(directory, SLEEPER);
    await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
    const lines: string[] = [];
    const code = await waitForRun({
      directory,
      sliceSeconds: 1,
      pollMs: 25,
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_STILL_RUNNING);
    const printed = lines.join("\n");
    expect(printed).toContain("still running after 1s");
    expect(printed).toContain("re-invoke");
    expect(printed).toContain("fake suite running");
    // Still alive, which is the difference between this and every other exit here.
    expect(isAlive(readPid(join(directory, RUN_FILES.pid)) ?? 0)).toBe(true);
  });

  it("exits 77 for a killed runner, so a caller never reads it as a red suite", async () => {
    const directory = temporaryDirectory();
    supervise(directory, SLEEPER);
    await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
    killPid(readPid(join(directory, RUN_FILES.pid)), "SIGTERM");
    await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);
    const lines: string[] = [];
    const code = await waitForRun({
      directory,
      sliceSeconds: 5,
      pollMs: 25,
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_RUNNER_KILLED);
    expect(lines.join("\n")).toContain("SIGNALLED, not judged");
  });

  it("exits 76 when the runner is gone and recorded nothing", async () => {
    const directory = temporaryDirectory();
    // A pid that cannot be alive: the runner was SIGKILLed before it could write an rc.
    writeAtomic(join(directory, RUN_FILES.pid), "2147483646\n");
    writeFileSync(join(directory, RUN_FILES.log), "half a suite\n", "utf8");
    const lines: string[] = [];
    const code = await waitForRun({
      directory,
      sliceSeconds: 5,
      pollMs: 25,
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_RUNNER_VANISHED);
    expect(lines.join("\n")).toContain("SIGKILLed");
  });

  it("exits 64 when the directory holds no run at all", async () => {
    const directory = temporaryDirectory();
    const lines: string[] = [];
    const code = await waitForRun({
      directory,
      sliceSeconds: 5,
      pollMs: 25,
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines.join("\n")).toContain("no detached browser run recorded");
  });
});

describe("startDetached", () => {
  it("returns immediately with the paths, leaving the run in a session of its own", async () => {
    const root = temporaryDirectory();
    const environment = {
      ...process.env,
      QCMS_AGENT_LANE: "fix-846-start-detached",
      QCMS_AGENT_SCRATCH_ROOT: root,
      QCMS_PORT_SEAT: "3",
    };
    const lines: string[] = [];
    const started = await startDetached({
      command: SLEEPER,
      directory: REPO_ROOT,
      environment,
      out: (line) => lines.push(line),
    });

    expect(started.code).toBe(0);
    expect(started.pid).toBeGreaterThan(0);
    if (started.pid !== undefined) spawnedPids.push(started.pid);
    expect(started.directory).toBe(join(root, "fix-846-start-detached"));
    expect(lines.join("\n")).toContain("pnpm verify:browser:wait");
    expect(readPid(join(started.directory, RUN_FILES.pid))).toBe(started.pid);

    // The run is in its own session, which is what survives the harness killing the
    // shell that asked for it.
    const sid = readFileSync(`/proc/${String(started.pid)}/stat`, "utf8").split(" ")[5];
    expect(sid).toBe(String(started.pid));

    // A second start in the same lane is refused rather than clobbering the live run's
    // log: two browser suites at one seat collide on every harness port.
    const refusal: string[] = [];
    const second = await startDetached({
      command: SLEEPER,
      directory: REPO_ROOT,
      environment,
      out: (line) => refusal.push(line),
    });
    expect(second.code).toBe(EXIT_USAGE);
    expect(refusal.join("\n")).toContain("already live in this lane");

    killPid(started.pid, "SIGTERM");
    await until(() => readRc(join(started.directory, RUN_FILES.rc)) !== undefined);
    // 128ms measured, but this spawns three node processes and waits on the filesystem
    // for each, so the budget is set for a host already carrying three browser suites.
  }, 30_000);

  it("refuses a worktree run with no seat, before it spawns anything", async () => {
    // A REAL linked worktree, because that is the condition the refusal tests: it is
    // `.git` being a FILE rather than a directory (`scripts/ports.mjs`,
    // `isLinkedWorktree`). This checkout is a linked worktree on an agent lane and a
    // plain clone on CI, so asserting against the repo root would pass here and fail
    // there - which is exactly what happened at the first head of this branch.
    const root = temporaryDirectory();
    const primary = join(root, "primary");
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
    git("init", "--initial-branch", "main", "--quiet", primary);
    git("-C", primary, "config", "user.email", "test@example.invalid");
    git("-C", primary, "config", "user.name", "Test");
    writeFileSync(join(primary, "file.txt"), "content\n", "utf8");
    git("-C", primary, "add", "file.txt");
    git("-C", primary, "commit", "--quiet", "-m", "initial");
    const linked = join(root, "linked");
    git("-C", primary, "worktree", "add", "--quiet", "-b", "fix/846-seatless", linked);
    expect(statSync(join(linked, ".git")).isFile()).toBe(true);

    const scratch = temporaryDirectory();
    const environment = {
      ...process.env,
      QCMS_AGENT_LANE: "fix-846-no-seat",
      QCMS_AGENT_SCRATCH_ROOT: scratch,
      QCMS_PORT_SEAT: "",
    };
    await expect(
      startDetached({ command: SLEEPER, directory: linked, environment, repoRoot: linked }),
    ).rejects.toThrow(/QCMS_PORT_SEAT is not set/);

    // Nothing was spawned: the refusal is ahead of the child, so a seatless invocation
    // cannot leak a suite nobody is waiting on.
    expect(existsSync(join(scratch, "fix-846-no-seat", RUN_FILES.pid))).toBe(false);
  });
});
