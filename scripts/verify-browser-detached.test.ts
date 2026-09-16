import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  EXIT_SUITE_SIGNALLED,
  EXIT_USAGE,
  RUN_FILES,
  checkoutRootOf,
  commandLineOf,
  describeForeignListener,
  describeListener,
  isAlive,
  listenersOnPorts,
  ownershipOf,
  parseArgs,
  playwrightCommand,
  readPid,
  readRc,
  readSuiteGroup,
  releaseLines,
  signalProvenance,
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

/**
 * Stop a process GROUP by its leader, which is how a supervisor's suite is reached.
 *
 * The guard is the same one `killPid` carries and for the same reason: a negative pid is
 * a group, and `kill(-0)` is this process's own.
 */
function killGroup(leader: number | undefined, signal: NodeJS.Signals): void {
  if (leader === undefined || !Number.isInteger(leader) || leader < 2) return;
  try {
    process.kill(-leader, signal);
  } catch {
    // Already gone, which is the point.
  }
}

afterAll(async () => {
  // SIGTERM first and SIGKILL only as a fallback, because SIGKILL cannot be trapped: a
  // supervisor killed outright never runs its own cleanup, and its suite - which is in a
  // process group of its own by design - is then orphaned. That leak is not theoretical.
  // This teardown used to SIGKILL straight away, and one `ps` after a day of runs found
  // 38 fake suites still running, from exactly the test that leaves its runner alive on
  // purpose. Killing the recorded suite group as well covers the case where the
  // supervisor has already exited and nothing is left to pass the signal on.
  for (const pid of spawnedPids) killPid(pid, "SIGTERM");
  for (const directory of temporaryDirectories) {
    killGroup(readSuiteGroup(join(directory, RUN_FILES.pid)), "SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const pid of spawnedPids) killPid(pid, "SIGKILL");
  for (const directory of temporaryDirectories) {
    killGroup(readSuiteGroup(join(directory, RUN_FILES.pid)), "SIGKILL");
  }
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

/**
 * The per-test budget for anything that spawns a supervisor, far above the measured
 * times (53-400 ms) on purpose.
 *
 * Vitest's 5 s default is tighter than `until`'s own bound below, and under host
 * contention (three lanes, load average 40) a `node` spawn can take seconds: the test
 * then dies on the runner's cap instead of on its own assertion, which reads as a broken
 * test rather than a slow machine. It flaked exactly that way once in three runs. With
 * this budget the inner `until` is always what fails first, and it says what it was
 * waiting for.
 */
const SPAWN_BUDGET_MS = 30_000;

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
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
    expect(readRc(path)).toEqual({ code: 1, signalled: false, target: "runner" });
  });

  it("separates a killed run from a red one, which is the whole point", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(path, "EXIT=143\nkilled=SIGTERM\nsignal_target=runner\nelapsed_seconds=1500\n");
    expect(readRc(path)).toEqual({
      code: 143,
      signalled: true,
      target: "runner",
      signal: "SIGTERM",
    });
  });

  it("separates a signalled SUITE from a signalled runner, because the causes differ", () => {
    // 77 means something signalled this script: a per-command cap, an operator, another
    // lane. 78 means Playwright died underneath a runner nobody touched, which is the
    // host. Issue #902's two reports had `EXIT=143` and no failing test, and no way to
    // tell those apart without reading the log by eye.
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(path, "EXIT=137\nkilled=SIGKILL\nsignal_target=suite\nelapsed_seconds=900\n");
    expect(readRc(path)).toMatchObject({ code: 137, signalled: true, target: "suite" });
  });

  it("reads a kill with no recorded target as the runner, the conservative reading", () => {
    // The only shape any previous version of this script wrote. Read as `suite` it would
    // send a reader looking at the host for a kill that came from the harness.
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(path, "EXIT=143\nkilled=SIGTERM\nelapsed_seconds=1500\n");
    expect(readRc(path)?.target).toBe("runner");
  });

  it("reads the foreign-holder field separately from the survivors field", () => {
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(
      path,
      [
        "EXIT=143",
        "killed=SIGTERM",
        "signal_target=runner",
        "seat_survivors=17300:4242",
        "seat_foreign=17310:4343:foreign-tree",
        "elapsed_seconds=1500",
        "",
      ].join("\n"),
    );
    expect(readRc(path)).toMatchObject({
      survivors: "17300:4242",
      foreign: "17310:4343:foreign-tree",
    });
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
    expect(readSuiteGroup(path)).toBeUndefined();
    writeAtomic(path, "4321\nsuite_group=4330\n# The first line is the runner pid\n");
    expect(readPid(path)).toBe(4321);
    // What is left to kill when the runner itself was SIGKILLed and ran no cleanup.
    expect(readSuiteGroup(path)).toBe(4330);
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
  it(
    "records a finished run's code and its own pid",
    async () => {
      const directory = temporaryDirectory();
      supervise(directory, exiter(3));
      await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);
      expect(readRc(join(directory, RUN_FILES.rc))).toEqual({
        code: 3,
        signalled: false,
        target: "runner",
      });
      const pid = readPid(join(directory, RUN_FILES.pid));
      expect(pid).toBeGreaterThan(0);
      expect(readFileSync(join(directory, RUN_FILES.log), "utf8")).toContain("fake suite line 2");
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "records a SIGTERM as a kill and not as a verdict, and stops the suite with it",
    async () => {
      const directory = temporaryDirectory();
      supervise(directory, SLEEPER);
      await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
      const runner = readPid(join(directory, RUN_FILES.pid));
      await until(() =>
        readFileSync(join(directory, RUN_FILES.log), "utf8").includes("fake suite"),
      );

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
    },
    SPAWN_BUDGET_MS,
  );
});

describe("releasing the seat", () => {
  it(
    "kills a separately-sessioned grandchild holding a port, which the group signal cannot reach",
    async () => {
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
        [
          process.execPath,
          join(directory, "suite.mjs"),
          join(directory, "server.mjs"),
          String(port),
        ],
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
      // Twice SPAWN_BUDGET_MS: this one spawns a supervisor, a suite and a grandchild, and
      // then waits out a SIGTERM and a port sweep.
    },
    2 * SPAWN_BUDGET_MS,
  );

  it(
    "leaves a bystander on a release port alone when it belongs to another checkout",
    async () => {
      // The regression test for issue #902, and the shape it actually took. A runner's
      // release ports come from `QCMS_PORT_SEAT`, and this file's own `startDetached` test
      // starts a supervisor at a hard-coded seat and then signals it - so every
      // `pnpm verify` on this host used to sweep a seat no part of it was using and
      // SIGTERM then SIGKILL whatever held those four ports. Twice that was a neighbouring
      // lane's live browser gate: `EXIT=143`, no failing test, seat-3 dev servers orphaned.
      //
      // The bystander here is that neighbour, reduced to its essentials: it holds a port
      // the runner will try to release, it is not descended from the runner, and its
      // working directory is a different checkout. It must survive, and the rc file must
      // name it as somebody else's rather than as a survivor to go and kill.
      const directory = temporaryDirectory();
      const port = await reserveFreePort();

      // A checkout of its own, which is what makes it foreign: the ownership test resolves
      // a working directory to its nearest `.git` rather than testing a path prefix,
      // because lane worktrees nest inside the primary checkout.
      const neighbour = join(temporaryDirectory(), "other-lane");
      mkdirSync(join(neighbour, "apps", "portal"), { recursive: true });
      writeFileSync(join(neighbour, ".git"), "gitdir: /elsewhere\n", "utf8");
      writeFileSync(
        join(neighbour, "bystander.mjs"),
        [
          'import { createServer } from "node:net";',
          "createServer().listen(Number(process.argv[2]), '127.0.0.1', () => {",
          "  process.stdout.write(`bystander ${String(process.pid)} listening\\n`);",
          "});",
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
        "utf8",
      );
      const bystander = spawn(
        process.execPath,
        [join(neighbour, "bystander.mjs"), String(port)],
        // In the neighbour's app directory, exactly as `next dev` runs, and detached so it
        // is not in any process group the runner's own cleanup addresses.
        { cwd: join(neighbour, "apps", "portal"), detached: true, stdio: "ignore" },
      );
      bystander.unref();
      const bystanderPid = bystander.pid;
      expect(bystanderPid).toBeGreaterThan(1);
      if (bystanderPid !== undefined) spawnedPids.push(bystanderPid);
      await until(() => listenersOnPorts([port]).length === 1, 20_000);
      expect(listenersOnPorts([port])[0]?.pid).toBe(bystanderPid);

      const runnerPid = supervise(directory, SLEEPER, ["--release-port", String(port)]);
      await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
      killPid(runnerPid, "SIGTERM");
      await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined, 30_000);

      // The whole point. Before the confinement this process was dead and its port free.
      expect(isAlive(bystanderPid ?? 0)).toBe(true);
      expect(listenersOnPorts([port])[0]?.pid).toBe(bystanderPid);

      const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
      expect(recorded).toMatch(new RegExp(`seat_foreign=${String(port)}:${String(bystanderPid)}:`));
      expect(recorded).toMatch(/foreign-tree/);
      expect(recorded).toMatch(/Do not kill it\. Take a free seat instead\./);
      // Never filed as a survivor: that field tells the reader to kill what it names.
      expect(recorded).not.toMatch(/seat_survivors=/);
      expect(recorded).not.toMatch(/THE SEAT WAS NOT RELEASED/);
      // The refusal is in the log too, with the grounds, so a run that hit one can say so.
      expect(readFileSync(join(directory, RUN_FILES.log), "utf8")).toMatch(
        /NOT signalling it, it is not this run's process/,
      );

      // And `wait` passes the distinction on rather than printing a kill instruction.
      const lines: string[] = [];
      const code = await waitForRun({
        directory,
        sliceSeconds: 5,
        pollMs: 25,
        out: (line) => lines.push(line),
      });
      expect(code).toBe(EXIT_RUNNER_KILLED);
      const printed = lines.join("\n");
      expect(printed).toMatch(/could not claim, and it was left alone/);
      expect(printed).toMatch(/another checkout's process is not yours to kill/);
      // The rc file is reprinted underneath, which is where the per-grounds advice lives.
      expect(printed).toMatch(/--- end of rc ---/);

      killPid(bystanderPid, "SIGKILL");
    },
    3 * SPAWN_BUDGET_MS,
  );

  it(
    "says nothing was released when it was given no ports to release",
    async () => {
      // This also pins the handler ordering inside `supervise`: it signals the instant
      // the pid file appears, which is the narrowest window after the runner advertises
      // the pid a caller may kill. While the handlers were installed after that file,
      // this failed one run in three - the runner took Node's default action and wrote no
      // rc at all, which is the unreadable outcome the whole script exists to prevent.
      const directory = temporaryDirectory();
      const runnerPid = supervise(directory, SLEEPER);
      await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
      killPid(runnerPid, "SIGTERM");
      await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);
      const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
      expect(recorded).toMatch(/No seat ports were given, so nothing was released/);
      expect(recorded).not.toMatch(/Seat released/);
    },
    SPAWN_BUDGET_MS,
  );

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
    const survived = releaseLines(
      [17200, 17240],
      [{ port: 17200, pid: 4242, ownership: "descendant" }],
    ).join("\n");
    expect(survived).toMatch(/seat_survivors=17200:4242/);
    // Never "17200:0": 0 is a real argument to `kill` meaning the caller's own process
    // group, so an unattributable holder is spelled out instead of being printed as a
    // pid somebody could copy into a kill command.
    expect(describeListener({ port: 17230, pid: undefined })).toBe("17230:unknown");
    expect(survived).toMatch(/THE SEAT WAS NOT RELEASED/);
    expect(survived).not.toMatch(/Seat released:/);
  });

  it("reports a holder it refused to signal under its own field, with opposite advice", () => {
    // `seat_survivors` is an instruction: those pids are yours, kill them. Pointing that
    // instruction at a neighbouring lane's live gate is the whole defect of issue #902, so
    // a holder this runner deliberately left alone must never be filed under it. An
    // unattributable holder counts as foreign for the same reason the seat preflight
    // refuses to adopt one: "cannot tell whose it is" is not "it is mine".
    const foreign = releaseLines(
      [17300, 17310],
      [
        { port: 17300, pid: 4242, ownership: "foreign-tree" },
        { port: 17310, pid: undefined, ownership: "unattributable" },
      ],
    ).join("\n");
    expect(foreign).toMatch(/seat_foreign=17300:4242:foreign-tree,17310:unknown:unattributable/);
    // The two grounds get opposite advice. Measured on a real seat: a sweep saw the API
    // port held by an unattributable pid (its own dying Playwright runner, whose fd was
    // closing mid-scan), and "do not kill it" would be the wrong thing to tell an operator
    // about their own orphan.
    expect(foreign).toMatch(/foreign-tree: another checkout's process/);
    expect(foreign).toMatch(/Do not kill it\. Take a free seat instead\./);
    expect(foreign).toMatch(/unattributable: the holder could not be identified/);
    expect(foreign).toMatch(/It may be this lane's own/);
    expect(foreign).toMatch(/Every port this run owned was released/);
    expect(foreign).not.toMatch(/seat_survivors=/);
    expect(foreign).not.toMatch(/THE SEAT WAS NOT RELEASED/);

    // Both kinds at once stay in their own fields.
    const both = releaseLines(
      [17300, 17310],
      [
        { port: 17300, pid: 11, ownership: "same-tree" },
        { port: 17310, pid: 22, ownership: "foreign-tree" },
      ],
    ).join("\n");
    expect(both).toMatch(/seat_survivors=17300:11/);
    expect(both).toMatch(/seat_foreign=17310:22:foreign-tree/);
    // Only the grounds that actually occurred get their paragraph.
    expect(both).toMatch(/foreign-tree: another checkout's process/);
    expect(both).not.toMatch(/unattributable: the holder could not be identified/);
    expect(describeForeignListener({ port: 17300, pid: 4242 })).toBe("17300:4242:unattributable");
  });
});

describe("ownershipOf", () => {
  /** A fake process tree, so the rule is tested without arranging real processes. */
  function tree(parents: Record<number, number>, directories: Record<number, string>) {
    return {
      parent: (pid: number) => parents[pid],
      workingDirectory: (pid: number) => directories[pid],
    };
  }

  it("accepts a descendant however deep, which is the normal dev-server case", () => {
    // next-server <- next dev <- pnpm <- sh -c <- wrapper <- playwright <- suite(500).
    // `setsid` puts the servers in another session but does not reparent them, so the
    // chain still reaches the suite pid the runner spawned.
    const { parent, workingDirectory } = tree(
      { 100: 200, 200: 300, 300: 400, 400: 450, 450: 500, 500: 600 },
      {},
    );
    expect(ownershipOf(100, { ancestors: new Set([600, 500]), parent, workingDirectory })).toBe(
      "descendant",
    );
    // The suite pid itself, which is the group leader the first cleanup step signals.
    expect(ownershipOf(500, { ancestors: new Set([500]), parent, workingDirectory })).toBe(
      "descendant",
    );
  });

  it("ends a parent chain that loops rather than spinning on it", () => {
    // A `/proc` read racing a reparent can produce one, and an unbounded walk over it
    // would hang the cleanup that is meant to release the seat.
    const { parent } = tree({ 10: 11, 11: 10 }, {});
    expect(
      ownershipOf(10, { ancestors: new Set([999]), parent, workingDirectory: () => undefined }),
    ).toBe("unattributable");
  });

  it("refuses a pid whose working directory cannot be read at all", () => {
    // Another user's process, or another PID namespace. "Cannot tell" is not "mine".
    expect(ownershipOf(10, { parent: () => undefined, workingDirectory: () => undefined })).toBe(
      "unattributable",
    );
  });

  it("refuses the values that mean something else entirely to kill", () => {
    // 0 is the caller's own process group and 1 is init. `pid ?? 0` upstream is exactly
    // how 0 arrives here, so neither may ever be classified as ours.
    for (const pid of [undefined, 0, 1, -1, 1.5]) {
      expect(ownershipOf(pid, { ancestors: new Set([0, 1]) })).toBe("unattributable");
    }
  });

  it("accepts this checkout and refuses a lane worktree nested inside it", () => {
    // The reason the test is by nearest `.git` and not by path prefix. Agent lanes live
    // under the primary checkout (`.worktrees/`, `.claude/worktrees/`) as well as beside
    // it, so a prefix test would let a runner in the primary tree call a nested lane's dev
    // server "mine" and kill it. That is issue #902 by a second route.
    const root = temporaryDirectory();
    const primary = join(root, "primary");
    const nested = join(primary, ".worktrees", "lane");
    const sibling = join(root, "qcms-worktrees", "lane");
    for (const checkout of [primary, nested, sibling]) {
      mkdirSync(join(checkout, "apps", "portal"), { recursive: true });
      writeFileSync(join(checkout, ".git"), "gitdir: /elsewhere\n", "utf8");
    }
    const options = { parent: () => undefined, ancestors: new Set<number>() };
    const at = (directory: string) => ({ ...options, workingDirectory: () => directory });

    // A dev server in the primary checkout's own app directory is the primary's.
    expect(ownershipOf(10, { ...at(join(primary, "apps", "portal")), repoRoot: primary })).toBe(
      "same-tree",
    );
    // The nested lane's is NOT, even though its path sits under the primary checkout.
    expect(ownershipOf(10, { ...at(join(nested, "apps", "portal")), repoRoot: primary })).toBe(
      "foreign-tree",
    );
    // And the relationship is not symmetric-blind: from inside the lane, the primary's is
    // foreign too, and so is the sibling layout.
    expect(ownershipOf(10, { ...at(join(primary, "apps", "portal")), repoRoot: nested })).toBe(
      "foreign-tree",
    );
    expect(ownershipOf(10, { ...at(join(sibling, "apps", "portal")), repoRoot: nested })).toBe(
      "foreign-tree",
    );
    expect(checkoutRootOf(join(nested, "apps", "portal"))).toBe(nested);
    expect(checkoutRootOf(root)).toBeUndefined();
  });

  it("falls back to a literal path test when neither side is a checkout", () => {
    // A fixture directory under the system temporary directory has no `.git` above it.
    // Refusing outright would break the cleanup for a runner started outside a repository,
    // so the fallback is the narrowest thing that is still honest.
    const root = temporaryDirectory();
    const options = { parent: () => undefined };
    expect(ownershipOf(10, { ...options, workingDirectory: () => root, repoRoot: root })).toBe(
      "same-tree",
    );
    expect(ownershipOf(10, { ...options, workingDirectory: () => tmpdir(), repoRoot: root })).toBe(
      "unattributable",
    );
  });
});

describe("signalProvenance", () => {
  it("records what is knowable and says plainly that the sender is not", () => {
    // Linux carries `si_pid` only to an `SA_SIGINFO` handler or a `signalfd` reader, and
    // Node exposes neither. So the fields are everything that makes the NEXT sighting
    // attributable without a live process to inspect, which is what issue #902's two
    // reports had no way to produce.
    const lines = signalProvenance({
      signal: "SIGTERM",
      target: "runner",
      seat: "3",
      elapsedSeconds: 871,
      pid: 4242,
      parentPid: 1,
      host: () => ["loadavg=40.1 38.0 22.5", "mem_available_kb=512000"],
    });
    expect(lines).toContain("signal=SIGTERM");
    expect(lines).toContain("signal_target=runner");
    // The elapsed time is how the #902 reports were written at all ("175 s, 198 s, 289 s").
    expect(lines).toContain("signal_at_elapsed_seconds=871");
    expect(lines).toContain("runner_pid=4242");
    expect(lines).toContain("runner_ppid=1");
    expect(lines).toContain("seat=3");
    expect(lines).toContain("loadavg=40.1 38.0 22.5");
    expect(lines.join("\n")).toMatch(/No sender pid/);
    // Never a blank value: "seat=" would read as a seat whose name is the empty string.
    expect(signalProvenance({ signal: "SIGHUP", target: "suite", elapsedSeconds: 1 })).toContain(
      "seat=unrecorded",
    );
  });

  it("keeps a parent command line to one line and a bounded length", () => {
    // It lands in a file whose contract is that a reader parses it a line at a time, so a
    // newline in somebody else's argv would split a field in half.
    const nul = String.fromCodePoint(0);
    const newline = String.fromCodePoint(10);
    expect(commandLineOf(9, () => `node${nul}--flag${newline}value${nul}`)).toBe(
      "node --flag value",
    );
    expect(commandLineOf(9, () => nul.repeat(3))).toBeUndefined();
    expect(commandLineOf(9, () => "x".repeat(500))).toMatch(/\.\.\.\(truncated\)$/);
    expect((commandLineOf(9, () => "x".repeat(500)) ?? "").length).toBeLessThan(230);
    expect(commandLineOf(0, () => "init")).toBeUndefined();
  });
});

describe("waitForRun", () => {
  it(
    "exits with the suite's own code when the run finishes",
    async () => {
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
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "exits 75 with the tail when the slice ends and the suite is still running",
    async () => {
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
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "exits 77 for a killed runner, so a caller never reads it as a red suite",
    async () => {
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
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "exits 78 when the SUITE died on a signal the runner never saw",
    async () => {
      // The distinction issue #902 asked for. 77 says something signalled this script: a
      // per-command cap, an operator, another lane. 78 says Playwright was killed
      // underneath a runner nobody touched, which points at the host - the OOM killer, a
      // cgroup limit, or a group signal aimed at the suite's own session. Both used to
      // arrive as 77 over an `EXIT=143` that read like a red suite.
      const directory = temporaryDirectory();
      supervise(directory, [
        process.execPath,
        "-e",
        // Kills itself the way the OOM killer would, so the runner sees a signalled child
        // while never being signalled itself.
        "process.stdout.write('fake suite running\\n'); process.kill(process.pid, 'SIGKILL');",
      ]);
      await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined, 20_000);

      const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
      expect(recorded).toMatch(/signal_target=suite/);
      expect(recorded).toMatch(/killed=SIGKILL/);
      // The provenance that makes the next sighting attributable without a live process.
      expect(recorded).toMatch(/signal_at_elapsed_seconds=\d+/);
      expect(recorded).toMatch(/loadavg=/);
      expect(recorded).toMatch(/mem_available_kb=/);
      expect(recorded).toMatch(/look at the host/);

      const lines: string[] = [];
      const code = await waitForRun({
        directory,
        sliceSeconds: 5,
        pollMs: 25,
        out: (line) => lines.push(line),
      });
      expect(code).toBe(EXIT_SUITE_SIGNALLED);
      const printed = lines.join("\n");
      expect(printed).toMatch(/the SUITE was killed by SIGKILL/);
      expect(printed).toMatch(/OOM killer/);
      // The rc file is reprinted, so the evidence is not something a reader has to know to
      // go and open.
      expect(printed).toMatch(/--- end of rc ---/);
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "records where a signal to the RUNNER arrived, since the sender cannot be known",
    async () => {
      const directory = temporaryDirectory();
      const runnerPid = supervise(directory, SLEEPER, ["--seat", "7"]);
      await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
      killPid(runnerPid, "SIGTERM");
      await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined);

      const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
      expect(recorded).toMatch(/signal_target=runner/);
      expect(recorded).toMatch(/seat=7/);
      expect(recorded).toMatch(
        new RegExp(`runner_pid=${String(readPid(join(directory, RUN_FILES.pid)) ?? 0)}`),
      );
      expect(recorded).toMatch(/runner_ppid=\d+/);
      expect(recorded).toMatch(/No sender pid/);
      // The same lines reach the log, where a reader of a truncated run finds them.
      expect(readFileSync(join(directory, RUN_FILES.log), "utf8")).toMatch(/signal_target=runner/);
    },
    SPAWN_BUDGET_MS,
  );

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
  it(
    "returns immediately with the paths, leaving the run in a session of its own",
    async () => {
      const root = temporaryDirectory();
      const environment = {
        ...process.env,
        QCMS_AGENT_LANE: "fix-846-start-detached",
        QCMS_AGENT_SCRATCH_ROOT: root,
        // A seat this test does not own, and the reason the ownership confinement exists
        // (issue #902). `startDetached` derives the runner's release ports from this value,
        // so the SIGTERM at the end of this test drives a real seat release over seat 3's
        // four harness ports - on a host where another lane may be running its browser gate
        // there. It killed one twice before every holder had to be shown to be this run's.
        // The seat number is deliberately left as it was: the fix is that the value cannot
        // matter, and a test that avoided the collision would stop proving that.
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
      // 128ms measured; the budget is set for a host already carrying three browser suites.
    },
    SPAWN_BUDGET_MS,
  );

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
