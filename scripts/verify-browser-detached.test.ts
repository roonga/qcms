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
  EXIT_STOP_INCOMPLETE,
  EXIT_SUITE_SIGNALLED,
  EXIT_USAGE,
  RUN_FILES,
  checkoutRootOf,
  commandLineOf,
  describeForeignListener,
  describeListener,
  isAlive,
  isOtherSupervisor,
  listenersOnPorts,
  ownershipOf,
  parseArgs,
  playwrightCommand,
  readPid,
  readRc,
  readSuiteGroup,
  relayedSignal,
  SUPERVISOR_ARGV_MARK,
  releaseLines,
  stopRun,
  signalProvenance,
  startDetached,
  tailLines,
  validateShard,
  waitForRun,
  writeAtomic,
} from "./verify-browser-detached.mjs";

const SCRIPT = fileURLToPath(new URL("verify-browser-detached.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const temporaryDirectories: string[] = [];
const spawnedPids: number[] = [];

/** `process.kill(0, ...)` would signal the Vitest runner's own process group. */
function killPid(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined || !Number.isInteger(pid) || pid < 2) return;
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

/** A negative pid is a process group, and `kill(-0)` is this process's own. */
function killGroup(leader: number | undefined, signal: NodeJS.Signals): void {
  if (leader === undefined || !Number.isInteger(leader) || leader < 2) return;
  try {
    process.kill(-leader, signal);
  } catch {
    // Already gone.
  }
}

afterAll(async () => {
  // SIGKILL cannot be trapped, so a supervisor killed outright orphans its suite.
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

const SLEEPER = [
  process.execPath,
  "-e",
  "process.stdout.write('fake suite running\\n'); setInterval(() => {}, 1000);",
];

function exiter(code: number): string[] {
  return [
    process.execPath,
    "-e",
    `process.stdout.write('fake suite line 1\\nfake suite line 2\\n'); process.exit(${String(code)});`,
  ];
}

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
 * Far above the measured 53-400 ms: under host contention a `node` spawn can take
 * seconds, and the inner `until` has to be what fails first.
 */
const SPAWN_BUDGET_MS = 30_000;

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("stopRun", () => {
  it(
    "signals the recorded runner, which releases the seat and records its rc",
    async () => {
      const directory = temporaryDirectory();
      supervise(directory, SLEEPER);
      await until(() => readPid(join(directory, RUN_FILES.pid)) !== undefined);
      const lines: string[] = [];
      const code = await stopRun({
        directory,
        pollMs: 25,
        timeoutMs: 20_000,
        out: (line) => lines.push(line),
      });
      expect(code).toBe(0);
      const printed = lines.join("\n");
      expect(printed).toContain("signalling the runner");
      expect(printed).toContain("The seat is released");
      expect(readRc(join(directory, RUN_FILES.rc))?.signalled).toBe(true);
    },
    SPAWN_BUDGET_MS,
  );

  it("reads the rc before the pid, so a recycled pid is never signalled", async () => {
    // A finished run leaves its pid file. If the kernel has handed that number to
    // somebody else, signalling it first and reading the old rc afterwards reports a
    // clean stop for a process this lane never owned.
    const directory = temporaryDirectory();
    writeFileSync(join(directory, RUN_FILES.pid), "4242' + esc + '", "utf8");
    writeFileSync(join(directory, RUN_FILES.rc), "EXIT=0' + esc + '", "utf8");
    const signalled: number[] = [];
    const code = await stopRun({
      directory,
      alive: () => true,
      kill: (pid) => signalled.push(pid),
      out: () => {},
    });
    expect(code).toBe(0);
    expect(signalled, "a live recycled pid must not be signalled").toEqual([]);
  });

  it("refuses a live pid whose argv is not this lane's runner", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, RUN_FILES.pid), "4242' + esc + '", "utf8");
    const lines: string[] = [];
    const signalled: number[] = [];
    const code = await stopRun({
      directory,
      alive: () => true,
      commandLine: () => "/usr/bin/postgres -D /var/lib/postgresql/data",
      kill: (pid) => signalled.push(pid),
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_STOP_INCOMPLETE);
    expect(signalled).toEqual([]);
    expect(lines.join("' + esc + '")).toContain("was not confirmed as this lane's detached runner");
    expect(lines.join("' + esc + '")).toContain("postgres");
  });

  it("refuses a live pid whose argv cannot be read at all", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, RUN_FILES.pid), "4242' + esc + '", "utf8");
    const signalled: number[] = [];
    const lines: string[] = [];
    const code = await stopRun({
      directory,
      alive: () => true,
      commandLine: () => undefined,
      kill: (pid) => signalled.push(pid),
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_STOP_INCOMPLETE);
    expect(signalled).toEqual([]);
    expect(lines.join("' + esc + '")).toContain("could not be read");
  });

  it("reports a finished run rather than signalling anything", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, RUN_FILES.rc), "EXIT=0\n", "utf8");
    const lines: string[] = [];
    const signalled: number[] = [];
    const code = await stopRun({
      directory,
      out: (line) => lines.push(line),
      kill: (pid) => signalled.push(pid),
    });
    expect(code).toBe(0);
    expect(signalled).toEqual([]);
    expect(lines.join("\n")).toContain("already finished");
  });

  it("refuses a directory holding no run", async () => {
    const lines: string[] = [];
    const code = await stopRun({
      directory: temporaryDirectory(),
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines.join("\n")).toContain("no detached browser run recorded");
  });

  it("signals the recorded suite group when the runner was SIGKILLed", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, RUN_FILES.pid), "4242\nsuite_group=4243\n", "utf8");
    const lines: string[] = [];
    const signalled: number[] = [];
    const code = await stopRun({
      directory,
      alive: () => false,
      kill: (pid) => signalled.push(pid),
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_STOP_INCOMPLETE);
    // The group, negated, and never the dead runner pid.
    expect(signalled).toEqual([-4243, -4243]);
    expect(lines.join("\n")).toContain("SIGKILLed");
  });

  it("gives up with a bounded message when the runner ignores the signal", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, RUN_FILES.pid), "4242\n", "utf8");
    const lines: string[] = [];
    const code = await stopRun({
      directory,
      alive: () => true,
      commandLine: () => `node /repo/scripts/${SUPERVISOR_ARGV_MARK} --log /x`,
      kill: () => {},
      pollMs: 5,
      timeoutMs: 40,
      out: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_STOP_INCOMPLETE);
    expect(lines.join("\n")).toContain("still up");
    expect(lines.join("\n")).toContain("never pkill");
  });
});

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

  it("takes a stop directory, and nothing else", () => {
    expect(parseArgs(["stop", "/run/dir"])).toEqual({ mode: "stop", directory: "/run/dir" });
    expect(() => parseArgs(["stop"])).toThrow(/requires the run directory/);
    expect(() => parseArgs(["stop", "/a", "/b"])).toThrow(/unexpected argument/);
    expect(() => parseArgs(["stop", "--force"])).toThrow(/unknown option for stop/);
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

  it("takes the seat and the repo root the seat release is confined to", () => {
    const base = ["supervise", "--log", "/l", "--pid", "/p", "--rc", "/r", "--heartbeat", "/h"];
    expect(parseArgs([...base, "--seat", "6", "--repo-root", "/repo", "--", "true"])).toMatchObject(
      {
        mode: "supervise",
        seat: "6",
        repoRoot: "/repo",
        command: ["true"],
      },
    );
    const without = parseArgs([...base, "--", "true"]);
    expect(without).not.toHaveProperty("seat");
    expect(without).not.toHaveProperty("repoRoot");
    expect(parseArgs([...base, "--seat", "0", "--", "true"])).toMatchObject({ seat: "0" });
    expect(() => parseArgs([...base, "--seat", "--", "true"])).toThrow(/--seat requires a value/);
    expect(() => parseArgs([...base, "--repo-root"])).toThrow(/--repo-root requires a value/);
    expect(() => parseArgs([...base, "--seet", "6", "--", "true"])).toThrow(/unknown option/);
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
    // The space form swallows the next argument as a second project name.
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
    // 77: something signalled this script. 78: Playwright died under an unsignalled runner.
    const directory = temporaryDirectory();
    const path = join(directory, RUN_FILES.rc);
    writeAtomic(path, "EXIT=137\nkilled=SIGKILL\nsignal_target=suite\nelapsed_seconds=900\n");
    expect(readRc(path)).toMatchObject({ code: 137, signalled: true, target: "suite" });
  });

  it("reads a kill with no recorded target as the runner, the conservative reading", () => {
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
      await until(() => !isAlive(runner ?? 0));
    },
    SPAWN_BUDGET_MS,
  );
});

describe("releasing the seat", () => {
  it(
    "kills a separately-sessioned grandchild holding a port, which the group signal cannot reach",
    async () => {
      // Playwright starts each `webServer` in a session of its own, so `kill(-pgid)` cannot
      // reach the servers it spawns.
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
    },
    2 * SPAWN_BUDGET_MS,
  );

  it(
    "leaves a bystander on a release port alone when it belongs to another checkout",
    async () => {
      const directory = temporaryDirectory();
      const port = await reserveFreePort();

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
      const bystander = spawn(process.execPath, [join(neighbour, "bystander.mjs"), String(port)], {
        cwd: join(neighbour, "apps", "portal"),
        detached: true,
        stdio: "ignore",
      });
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

      expect(isAlive(bystanderPid ?? 0)).toBe(true);
      expect(listenersOnPorts([port])[0]?.pid).toBe(bystanderPid);

      const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
      expect(recorded).toMatch(new RegExp(`seat_foreign=${String(port)}:${String(bystanderPid)}:`));
      expect(recorded).toMatch(/foreign-tree/);
      expect(recorded).toMatch(/Do not kill it\. Take a free seat instead\./);
      expect(recorded).not.toMatch(/seat_survivors=/);
      expect(recorded).not.toMatch(/THE SEAT WAS NOT RELEASED/);
      expect(readFileSync(join(directory, RUN_FILES.log), "utf8")).toMatch(
        /NOT signalling it, it is not this run's process/,
      );

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
      expect(printed).toMatch(/--- end of rc ---/);

      killPid(bystanderPid, "SIGKILL");
    },
    3 * SPAWN_BUDGET_MS,
  );

  it(
    "says nothing was released when it was given no ports to release",
    async () => {
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
    expect(describeListener({ port: 17230, pid: undefined })).toBe("17230:unknown");
    expect(survived).toMatch(/THE SEAT WAS NOT RELEASED/);
    expect(survived).not.toMatch(/Seat released:/);
  });

  it("reports a holder it refused to signal under its own field, with opposite advice", () => {
    const foreign = releaseLines(
      [17300, 17310],
      [
        { port: 17300, pid: 4242, ownership: "foreign-tree" },
        { port: 17310, pid: undefined, ownership: "unattributable" },
      ],
    ).join("\n");
    expect(foreign).toMatch(/seat_foreign=17300:4242:foreign-tree,17310:unknown:unattributable/);
    expect(foreign).toMatch(/foreign-tree: another checkout's process/);
    expect(foreign).toMatch(/Do not kill it\. Take a free seat instead\./);
    expect(foreign).toMatch(/unattributable: the holder could not be identified/);
    expect(foreign).toMatch(/It may be this lane's own/);
    expect(foreign).toMatch(/Every port this run owned was released/);
    expect(foreign).not.toMatch(/seat_survivors=/);
    expect(foreign).not.toMatch(/THE SEAT WAS NOT RELEASED/);

    const both = releaseLines(
      [17300, 17310],
      [
        { port: 17300, pid: 11, ownership: "same-tree" },
        { port: 17310, pid: 22, ownership: "foreign-tree" },
      ],
    ).join("\n");
    expect(both).toMatch(/seat_survivors=17300:11/);
    expect(both).toMatch(/seat_foreign=17310:22:foreign-tree/);
    expect(both).toMatch(/foreign-tree: another checkout's process/);
    expect(both).not.toMatch(/unattributable: the holder could not be identified/);
    expect(describeForeignListener({ port: 17300, pid: 4242 })).toBe("17300:4242:unattributable");
  });
});

describe("ownershipOf", () => {
  function tree(parents: Record<number, number>, directories: Record<number, string>) {
    return {
      parent: (pid: number) => parents[pid],
      workingDirectory: (pid: number) => directories[pid],
    };
  }

  it("accepts a descendant however deep, which is the normal dev-server case", () => {
    const { parent, workingDirectory } = tree(
      { 100: 200, 200: 300, 300: 400, 400: 450, 450: 500, 500: 600 },
      {},
    );
    expect(ownershipOf(100, { ancestors: new Set([600, 500]), parent, workingDirectory })).toBe(
      "descendant",
    );
    expect(ownershipOf(500, { ancestors: new Set([500]), parent, workingDirectory })).toBe(
      "descendant",
    );
  });

  it("ends a parent chain that loops rather than spinning on it", () => {
    // A `/proc` read racing a reparent can produce a cycle, and an unbounded walk over it
    // would hang the cleanup that releases the seat.
    const { parent } = tree({ 10: 11, 11: 10 }, {});
    expect(
      ownershipOf(10, { ancestors: new Set([999]), parent, workingDirectory: () => undefined }),
    ).toBe("unattributable");
  });

  it("refuses a pid whose working directory cannot be read at all", () => {
    expect(ownershipOf(10, { parent: () => undefined, workingDirectory: () => undefined })).toBe(
      "unattributable",
    );
  });

  it("refuses the values that mean something else entirely to kill", () => {
    // 0 is the caller's own process group and 1 is init, so neither may ever count as ours.
    for (const pid of [undefined, 0, 1, -1, 1.5]) {
      expect(ownershipOf(pid, { ancestors: new Set([0, 1]) })).toBe("unattributable");
    }
  });

  it("accepts this checkout and refuses a lane worktree nested inside it", () => {
    // Agent lanes nest inside the primary checkout, so a path-prefix test would let a
    // runner there call a nested lane's dev server its own.
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

    expect(ownershipOf(10, { ...at(join(primary, "apps", "portal")), repoRoot: primary })).toBe(
      "same-tree",
    );
    expect(ownershipOf(10, { ...at(join(nested, "apps", "portal")), repoRoot: primary })).toBe(
      "foreign-tree",
    );
    expect(ownershipOf(10, { ...at(join(primary, "apps", "portal")), repoRoot: nested })).toBe(
      "foreign-tree",
    );
    expect(ownershipOf(10, { ...at(join(sibling, "apps", "portal")), repoRoot: nested })).toBe(
      "foreign-tree",
    );
    expect(checkoutRootOf(join(nested, "apps", "portal"))).toBe(nested);
    expect(checkoutRootOf(root)).toBeUndefined();
  });

  it("falls back to a containment test when neither side is a checkout", () => {
    const root = temporaryDirectory();
    const options = { parent: () => undefined };
    expect(ownershipOf(10, { ...options, workingDirectory: () => root, repoRoot: root })).toBe(
      "same-tree",
    );
    expect(
      ownershipOf(10, {
        ...options,
        workingDirectory: () => join(root, "apps", "portal"),
        repoRoot: root,
      }),
    ).toBe("same-tree");
    expect(ownershipOf(10, { ...options, workingDirectory: () => tmpdir(), repoRoot: root })).toBe(
      "unattributable",
    );
    expect(
      ownershipOf(10, { ...options, workingDirectory: () => `${root}-other`, repoRoot: root }),
    ).toBe("unattributable");
    expect(
      ownershipOf(10, {
        ...options,
        workingDirectory: () => join(root, "apps", "portal"),
        repoRoot: root,
        checkoutRoot: (directory) => (directory === root ? root : undefined),
      }),
    ).toBe("unattributable");
  });

  it("refuses a holder descended from a DIFFERENT detached runner, whatever its cwd says", () => {
    const root = temporaryDirectory();
    const inMyTree = { workingDirectory: () => root, repoRoot: root };
    const chain = (pid: number) => ({ 10: 11, 11: 12 })[pid];
    expect(
      ownershipOf(10, { ...inMyTree, parent: chain, isForeignSupervisor: (pid) => pid === 12 }),
    ).toBe("other-run");

    expect(
      ownershipOf(10, {
        ...inMyTree,
        parent: chain,
        ancestors: new Set([10]),
        isForeignSupervisor: () => true,
      }),
    ).toBe("descendant");
  });

  it("recognises another supervisor by its argv, past the length the rc file records", () => {
    const nul = String.fromCodePoint(0);
    const deep = "/very/deep".repeat(20);
    // Uncapped: the marker sits past two paths, and the rc file's 200-character bound
    // would hide it in a deeply nested worktree.
    expect(
      isOtherSupervisor(
        12_345,
        () =>
          `/p/node${nul}${deep}/scripts/verify-browser-detached.mjs${nul}supervise${nul}--log${nul}x`,
      ),
    ).toBe(true);
    expect(isOtherSupervisor(12_345, () => `/p/node${nul}-e${nul}setInterval(()=>{},1)`)).toBe(
      false,
    );
    expect(isOtherSupervisor(process.pid)).toBe(false);
    expect(isOtherSupervisor(12_345, () => undefined)).toBe(false);
  });
});

describe("signalProvenance", () => {
  it("records what is knowable and says plainly that the sender is not", () => {
    // Node exposes neither an `SA_SIGINFO` handler nor `signalfd`, so `si_pid` is
    // unavailable and these fields are all the attribution a later reader gets.
    const lines = signalProvenance({
      signal: "SIGTERM",
      target: "runner",
      seat: "3",
      elapsedSeconds: 871,
      pid: 4242,
      parentPid: 1,
      runnerPid: 4242,
      host: () => ["loadavg=40.1 38.0 22.5", "mem_available_kb=512000"],
    });
    expect(lines).toContain("signal=SIGTERM");
    expect(lines).toContain("signal_target=runner");
    expect(lines).toContain("signal_at_elapsed_seconds=871");
    expect(lines).toContain("signalled_pid=4242");
    expect(lines).toContain("signalled_ppid=1");
    expect(lines).toContain("runner_pid=4242");
    expect(lines).toContain("seat=3");
    expect(lines).toContain("loadavg=40.1 38.0 22.5");
    expect(lines.join("\n")).toMatch(/No sender pid/);
    expect(signalProvenance({ signal: "SIGHUP", target: "suite", elapsedSeconds: 1 })).toContain(
      "seat=unrecorded",
    );
  });

  it("names the SUITE as the victim for a suite kill, not the runner", () => {
    const lines = signalProvenance({
      signal: "SIGKILL",
      target: "suite",
      seat: "6",
      elapsedSeconds: 900,
      pid: 5150,
      parentPid: 5140,
      runnerPid: 5140,
      command: ["pnpm", "exec", "playwright", "test"],
      host: () => ["loadavg=1 1 1", "mem_available_kb=1"],
    });
    expect(lines).toContain("signal_target=suite");
    expect(lines).toContain("signalled_pid=5150");
    expect(lines).toContain("signalled_ppid=5140");
    expect(lines).toContain("runner_pid=5140");
    expect(lines).toContain("signalled_command=pnpm exec playwright test");
    expect(
      signalProvenance({ signal: "SIGTERM", target: "runner", elapsedSeconds: 1 }).join("\n"),
    ).not.toMatch(/signalled_command=/);
  });

  it("keeps a parent command line to one line and a bounded length", () => {
    // A newline in somebody else's argv would split an rc file field in half.
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
      const directory = temporaryDirectory();
      supervise(directory, [
        process.execPath,
        "-e",
        "process.stdout.write('fake suite running\\n'); process.kill(process.pid, 'SIGKILL');",
      ]);
      await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined, 20_000);

      const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
      expect(recorded).toMatch(/signal_target=suite/);
      expect(recorded).toMatch(/killed=SIGKILL/);
      expect(recorded).toMatch(/signal_at_elapsed_seconds=\d+/);
      expect(recorded).toMatch(/loadavg=/);
      expect(recorded).toMatch(/mem_available_kb=/);
      expect(recorded).toMatch(/look at the host/);
      const suitePid = readSuiteGroup(join(directory, RUN_FILES.pid));
      const runnerPid = readPid(join(directory, RUN_FILES.pid));
      expect(suitePid).toBeGreaterThan(1);
      expect(suitePid).not.toBe(runnerPid);
      expect(recorded).toMatch(new RegExp(`signalled_pid=${String(suitePid)}$`, "m"));
      expect(recorded).toMatch(new RegExp(`signalled_ppid=${String(runnerPid)}$`, "m"));
      expect(recorded).toMatch(new RegExp(`runner_pid=${String(runnerPid)}$`, "m"));
      expect(recorded).toMatch(/signalled_command=.*-e /);

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
      expect(printed).toMatch(/--- end of rc ---/);
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "exits 78 for a signal the suite's wrapper swallowed and reported as exit 1",
    async () => {
      const directory = temporaryDirectory();
      supervise(directory, [
        process.execPath,
        "-e",
        "process.stdout.write('fake suite running\\n');" +
          "process.stdout.write('ELIFECYCLE Command failed.\\n');" +
          "process.stdout.write('[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command was killed with SIGTERM\\n');" +
          "process.exit(1);",
      ]);
      await until(() => readRc(join(directory, RUN_FILES.rc)) !== undefined, 20_000);

      const recorded = readFileSync(join(directory, RUN_FILES.rc), "utf8");
      expect(recorded).toMatch(/^EXIT=1$/m);
      expect(recorded).toMatch(/killed=SIGTERM/);
      expect(recorded).toMatch(/signal_target=suite/);
      expect(recorded).toMatch(/signal_relay=suite-wrapper/);
      expect(recorded).toMatch(/did not reach this runner's own child/);

      const lines: string[] = [];
      const code = await waitForRun({
        directory,
        sliceSeconds: 5,
        pollMs: 25,
        out: (line) => lines.push(line),
      });
      expect(code).toBe(EXIT_SUITE_SIGNALLED);
      expect(lines.join("\n")).toMatch(/the SUITE was killed by SIGTERM/);
    },
    SPAWN_BUDGET_MS,
  );

  it("reads a wrapper's killed-with line without trusting a bare signal name", () => {
    expect(
      relayedSignal("x", () => ["[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] killed with SIGKILL"]),
    ).toBe("SIGKILL");
    expect(relayedSignal("x", () => ["  Command was killed with SIGTERM"])).toBe("SIGTERM");
    expect(
      relayedSignal("x", () => [
        "1 failed",
        "expects SIGTERM handling",
        "a test named kill with SIGTERM semantics",
      ]),
    ).toBeUndefined();
    expect(relayedSignal("x", () => [])).toBeUndefined();
  });

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
      const runner = String(readPid(join(directory, RUN_FILES.pid)) ?? 0);
      expect(recorded).toMatch(new RegExp(`signalled_pid=${runner}$`, "m"));
      expect(recorded).toMatch(new RegExp(`runner_pid=${runner}$`, "m"));
      expect(recorded).toMatch(/signalled_ppid=\d+/);
      expect(recorded).toMatch(/No sender pid/);
      expect(readFileSync(join(directory, RUN_FILES.log), "utf8")).toMatch(/signal_target=runner/);
    },
    SPAWN_BUDGET_MS,
  );

  it("exits 76 when the runner is gone and recorded nothing", async () => {
    const directory = temporaryDirectory();
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
        // A seat this test does not own, left as it is: the point is that the value cannot
        // matter, and avoiding the collision would stop proving that.
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

      const sid = readFileSync(`/proc/${String(started.pid)}/stat`, "utf8").split(" ")[5];
      expect(sid).toBe(String(started.pid));

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
      // 128 ms measured; the budget allows for a host already carrying three browser suites.
    },
    SPAWN_BUDGET_MS,
  );

  it("refuses a native Windows start and names where the gate does run", async () => {
    const lines: string[] = [];
    const refused = await startDetached({
      command: SLEEPER,
      directory: REPO_ROOT,
      environment: { ...process.env },
      out: (line) => lines.push(line),
      platform: "win32",
    });

    expect(refused.code).toBe(EXIT_USAGE);
    expect(refused.pid).toBeUndefined();
    const message = lines.join("\n");
    expect(message).toContain("does not run on native Windows");
    expect(message).toContain("WSL");
    expect(message).toContain("docs/DEVELOPER_GUIDE.md");
  });

  it("refuses a worktree run with no seat, before it spawns anything", async () => {
    // A real linked worktree: the refusal turns on `.git` being a file, and this checkout
    // is a linked worktree on a lane but a plain clone on CI.
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

    expect(existsSync(join(scratch, "fix-846-no-seat", RUN_FILES.pid))).toBe(false);
  });
});
