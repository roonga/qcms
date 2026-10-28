import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const SUPERVISOR = fileURLToPath(new URL("agent-loop.sh", import.meta.url));
const WAIT_FOR_LOG_MS = 10_000;
const workspaces: string[] = [];
const spawnedPids: number[] = [];

afterAll(() => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is the outcome these tests assert for.
    }
  }
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

// Validation runs before the script changes directory or touches the repo, so the
// invalid cases are safe to drive against the real file.
function runArgs(...args: string[]) {
  return spawnSync("bash", [SUPERVISOR, ...args], { encoding: "utf8" });
}

// This case enters the supervisor loop, so it needs a stub `claude`: without one it
// would launch a real session and claim a ledger task.
function runWithStubbedClaude(stubOutput: string, ...args: string[]) {
  return runSupervisorWithStub(stubOutput, args);
}

// Detached and killed by process GROUP: bash defers a trapped signal until the foreground command
// returns, so a timeout cannot end a run sitting in `sleep`. The log file is read, not the pipe.
async function runUntilLogged(pattern: RegExp, stubOutput: string, ...args: string[]) {
  const { root, copied, env } = supervisorWorkspace(stubOutput);
  const child = spawn("bash", [copied, ...args], { detached: true, stdio: "ignore", env });
  if (child.pid !== undefined) spawnedPids.push(-child.pid);

  const logFile = join(root, "agent-loop.log");
  const deadline = Date.now() + WAIT_FOR_LOG_MS;
  let log = "";
  while (Date.now() < deadline) {
    log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    if (pattern.test(log)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already exited; the caller's assertion reports that better than a teardown throw.
    }
  }
  return log;
}

function runSupervisorWithStub(stubOutput: string, args: string[], timeoutMs?: number) {
  const { root, copied, env } = supervisorWorkspace(stubOutput);

  const res = spawnSync("bash", [copied, ...args], { encoding: "utf8", timeout: timeoutMs, env });

  const argvLog = join(root, "claude-argv.txt");
  const seatLog = join(root, "claude-seat.txt");
  const claudeArgv = existsSync(argvLog)
    ? readFileSync(argvLog, "utf8").split("\n").filter(Boolean)
    : [];
  const seat = existsSync(seatLog) ? readFileSync(seatLog, "utf8") : "<no session>";
  return { ...res, claudeArgv, seat };
}

function supervisorWorkspace(stubOutput: string) {
  const root = mkdtempSync(join(tmpdir(), "agent-loop-"));
  workspaces.push(root);

  // The script resolves its workspace as `dirname $0/..`, so the copy lives under
  // <root>/scripts to keep its log and cwd inside the throwaway directory.
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  const copied = join(root, "scripts", "agent-loop.sh");
  copyFileSync(SUPERVISOR, copied);

  // The stub records `QCMS_PORT_SEAT` from its own environment, the only way to observe
  // that the supervisor exported the seat rather than merely computing it.
  const stub = join(root, "bin", "claude");
  const argvLog = join(root, "claude-argv.txt");
  const seatLog = join(root, "claude-seat.txt");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >>'${argvLog}'\n` +
      `printf '%s' "\${QCMS_PORT_SEAT-<unset>}" >'${seatLog}'\n` +
      `cat <<'OUT'\n${stubOutput}\nOUT\n`,
  );
  chmodSync(stub, 0o755);

  return {
    root,
    copied,
    // Cleared, so a seat leaking in from the developer's own shell cannot make a
    // derivation test pass for the wrong reason.
    env: {
      ...process.env,
      QCMS_PORT_SEAT: undefined,
      PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    },
  };
}

// Every run is capped so a regression cannot hang the suite. It is a parameter because
// the cap doubles as the interrupt trigger for the signal tests.
const SUPERVISOR_KILL_MS = 60_000;
const INTERRUPT_AFTER_MS = 3_000;

// Rejected at the parse site because the value reaches `process.kill()`:
// `Number("")` is 0, and signalling pid 0 would hit the Vitest runner's own group.
function readBackgroundPid(pidFile: string): number {
  const raw = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : "";
  if (raw === "") throw new Error("the session stub never recorded a background pid");
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`the session stub recorded a background pid that is not a pid: '${raw}'`);
  }
  return Number(raw);
}

// Widens the launch window between forking the session and learning its group id.
// `set +m` is the anchor because it sits inside that window only in the shape being
// guarded against, so one injected delay exercises the old and new shapes alike.
const LAUNCH_WINDOW_HOLD_SEC = 5;
const LAUNCH_WINDOW_INTERRUPT_MS = 1_500;

function holdLaunchWindowOpen(source: string): string {
  const anchor = "\n  set +m\n";
  const found = source.split(anchor).length - 1;
  if (found !== 1) {
    throw new Error(`expected exactly one '  set +m' line in the supervisor, found ${found}`);
  }
  return source.replace(anchor, `${anchor}  sleep ${LAUNCH_WINDOW_HOLD_SEC}\n`);
}

function runWithSessionStub(
  stubBody: string,
  timeoutMs = SUPERVISOR_KILL_MS,
  transformSource: (source: string) => string = (source) => source,
) {
  const root = mkdtempSync(join(tmpdir(), "agent-loop-240-"));
  workspaces.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  const copied = join(root, "scripts", "agent-loop.sh");
  writeFileSync(copied, transformSource(readFileSync(SUPERVISOR, "utf8")));

  const stub = join(root, "bin", "claude");
  const pidFile = join(root, "background.pid");
  writeFileSync(stub, `#!/usr/bin/env bash\nPID_FILE='${pidFile}'\n${stubBody}\n`);
  chmodSync(stub, 0o755);

  const res = spawnSync("bash", [copied, "-m", "1"], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
  });

  const backgroundPid = readBackgroundPid(pidFile);
  spawnedPids.push(backgroundPid);
  return { ...res, backgroundPid };
}

// `/proc` rather than `kill(pid, 0)`: a SIGKILLed process lingers as a zombie that
// still answers signal 0. Linux-only, so the suite skips explicitly rather than
// passing vacuously where /proc is absent.
const HAS_PROCFS = existsSync("/proc/self/stat");

function isRunning(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return false;
  }
  // The comm field is parenthesised and may contain spaces, so state is the first
  // field after the final ')'.
  const state = stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/)[0];
  return state !== "Z";
}

describe("session-stub background pid parsing", () => {
  function pidFileContaining(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "agent-loop-pid-"));
    workspaces.push(dir);
    const file = join(dir, "background.pid");
    writeFileSync(file, contents);
    return file;
  }

  it.each(["0", "-1", "12.5", "not-a-pid", ""])(
    "refuses to hand '%s' to process.kill",
    (written) => {
      expect(() => readBackgroundPid(pidFileContaining(`${written}\n`))).toThrow(/background pid/);
    },
  );

  it("names the offending value so a malformed stub write is diagnosable", () => {
    expect(() => readBackgroundPid(pidFileContaining("0\n"))).toThrow("'0'");
  });

  it("accepts a well-formed pid, trailing newline and all", () => {
    expect(readBackgroundPid(pidFileContaining("4321\n"))).toBe(4321);
  });
});

describe("agent-loop.sh argument validation", () => {
  it.each([
    ["--max-iterations", "-m", "abc"],
    ["--parallel", "-p", "abc"],
    ["--retry-minutes", "-r", "abc"],
  ])(
    "rejects a non-numeric %s instead of silently treating it as zero",
    (flagName, flag, value) => {
      const res = runArgs(flag, value);

      expect(res.status).toBe(2);
      expect(res.stderr).toContain(flagName);
      expect(res.stderr).toContain(value);
    },
  );

  it.each([
    ["-p", "0"],
    ["-m", "0"],
    ["-r", "-5"],
    ["-m", "1e3"],
  ])("rejects %s %s as not a positive integer", (flag, value) => {
    const res = runArgs(flag, value);

    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/needs a positive integer/);
  });

  it.each(["-p", "-r", "-m", "-s"])("reports which flag is missing its value for %s", (flag) => {
    const res = runArgs(flag);

    expect(res.status).toBe(2);
    expect(res.stderr).toContain(`${flag} requires a value`);
    expect(res.stderr).not.toContain("unbound variable");
  });

  it("rejects a non-numeric --stop-after-task before the run starts", () => {
    const res = runArgs("-s", "abc");

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--stop-after-task");
  });

  it("still accepts a zero-padded task id, which is the documented form", () => {
    const res = runWithStubbedClaude("NEXT-WORK: NOTHING", "-s", "010", "-m", "1");

    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("positive integer");
  });

  it("rejects an unknown option", () => {
    const res = runArgs("--bogus");

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("unknown option: --bogus");
  });

  it("prints usage for --help without running the loop", () => {
    const res = runArgs("--help");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("agent-loop.sh");
    expect(res.stdout).toContain("--max-iterations");
  });
});

describe("agent-loop.sh supervisor loop", () => {
  it("accepts valid arguments and runs an iteration", () => {
    // NOTHING is the ledger-exhausted sentinel, so the loop stops after one pass.
    const res = runWithStubbedClaude("NEXT-WORK: NOTHING", "-p", "2", "-r", "5", "-m", "3");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("iteration 1");
    expect(res.stdout).toContain("ledger exhausted");
    expect(res.stdout).toContain("/next-work 2");
  });

  it("pins the model, so an unattended run cannot drift with the CLI default", () => {
    const res = runWithStubbedClaude("NEXT-WORK: NOTHING", "-m", "1");

    expect(res.status).toBe(0);
    expect(res.claudeArgv[res.claudeArgv.indexOf("--model") + 1]).toBe("claude-opus-5");
  });

  it("stops at a human gate rather than continuing to the next task", () => {
    const res = runWithStubbedClaude("NEXT-WORK: AWAITING-HUMAN task 030", "-m", "5");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("human gate reached");
    expect(res.stdout).not.toContain("iteration 2");
  });

  it("stops after the requested numbered task lands", () => {
    const res = runWithStubbedClaude("NEXT-WORK: LANDED task 010", "-s", "010", "-m", "3");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("stop-after target reached");
    expect(res.stdout).not.toContain("iteration 2");
  });

  it("does not confuse an issue number with the stop-after task", () => {
    const res = runWithStubbedClaude("NEXT-WORK: LANDED issue #10", "-s", "010", "-m", "2");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("iteration 2");
    expect(res.stdout).not.toContain("stop-after target reached");
  });

  it("exits on the last iteration instead of paying the retry window first", () => {
    // `-r 30` makes the assertion unambiguous: a run that finishes in seconds cannot
    // have paid the retry window.
    const started = Date.now();
    const res = runWithStubbedClaude("no sentinel here", "-m", "1", "-r", "30");
    const elapsedSec = (Date.now() - started) / 1000;

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("max 1 iterations reached");
    expect(res.stdout).not.toContain("retrying in 30 minutes");
    expect(elapsedSec).toBeLessThan(60);
  }, 90_000);

  it("still waits out the retry window when another iteration is left to run", async () => {
    // Conditional rather than deleted: skipping the sleep whenever a session produced
    // no sentinel would turn the supervisor into a hot loop through its whole budget.
    const log = await runUntilLogged(
      /retrying in 30 minutes/,
      "no sentinel",
      "-m",
      "2",
      "-r",
      "30",
    );

    expect(log).toContain("retrying in 30 minutes");
    expect(log).not.toContain("max 2 iterations reached");
  }, 30_000);
});

describe.skipIf(!HAS_PROCFS)("agent-loop.sh session process groups", () => {
  it("terminates background work the session left behind", () => {
    const res = runWithSessionStub(
      ["sleep 600 >/dev/null 2>&1 &", 'echo "$!" >"$PID_FILE"', 'echo "NEXT-WORK: NOTHING"'].join(
        "\n",
      ),
    );

    expect(res.status).toBe(0);
    expect(isRunning(res.backgroundPid)).toBe(false);
    expect(res.stdout).toContain("terminating its process group");
  });

  it("does not wait on a descendant that inherited the session's output", () => {
    // A command substitution does not return until every process holding the write end
    // of the pipe has exited, so this shape hangs the supervisor instead of reaping.
    const res = runWithSessionStub(
      ["sleep 600 &", 'echo "$!" >"$PID_FILE"', 'echo "NEXT-WORK: NOTHING"'].join("\n"),
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("ledger exhausted");
    expect(isRunning(res.backgroundPid)).toBe(false);
  });

  it(
    "takes a still-running session and its children down when the supervisor is signalled",
    () => {
      // The session runs in its own process group, so a terminal Ctrl+C does not reach
      // it. spawnSync's timeout sends SIGTERM to the supervisor, which is that path.
      const res = runWithSessionStub(
        [
          "sleep 600 >/dev/null 2>&1 &",
          'echo "$!" >"$PID_FILE"',
          // Outlives the interrupt, so the session really is mid-flight.
          "sleep 600",
        ].join("\n"),
        INTERRUPT_AFTER_MS,
      );

      expect(res.signal).toBe("SIGTERM");
      expect(isRunning(res.backgroundPid)).toBe(false);
    },
    INTERRUPT_AFTER_MS * 4,
  );

  it(
    "still reaps when the signal lands before the group id is known",
    () => {
      // Aimed into the held launch window (see holdLaunchWindowOpen), where the group
      // id is not yet known.
      const res = runWithSessionStub(
        [
          "sleep 600 >/dev/null 2>&1 &",
          'echo "$!" >"$PID_FILE"',
          // Outlives the interrupt, so the session really is mid-flight.
          "sleep 600",
        ].join("\n"),
        LAUNCH_WINDOW_INTERRUPT_MS,
        holdLaunchWindowOpen,
      );

      expect(res.signal).toBe("SIGTERM");
      expect(isRunning(res.backgroundPid)).toBe(false);
    },
    (LAUNCH_WINDOW_HOLD_SEC * 1000 + LAUNCH_WINDOW_INTERRUPT_MS) * 3,
  );
});

describe.skipIf(!HAS_PROCFS)("agent-loop.sh second interrupt (issue #258)", () => {
  /** A descendant that ignores SIGTERM, which is what makes the grace observable. */
  const SIGTERM_IGNORING_DESCENDANT = [
    `bash -c 'trap "" TERM; while :; do sleep 1; done' >/dev/null 2>&1 &`,
    'echo "$!" >"$PID_FILE"',
    // Outlives the interrupts, so the session really is mid-flight.
    "sleep 600",
  ].join("\n");

  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + WAIT_FOR_LOG_MS;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  it(
    "escalates to SIGKILL instead of leaving a SIGTERM-ignoring descendant behind",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "agent-loop-258-"));
      workspaces.push(root);
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "bin"));
      const copied = join(root, "scripts", "agent-loop.sh");
      copyFileSync(SUPERVISOR, copied);

      const stub = join(root, "bin", "claude");
      const pidFile = join(root, "background.pid");
      writeFileSync(
        stub,
        `#!/usr/bin/env bash\nPID_FILE='${pidFile}'\n${SIGTERM_IGNORING_DESCENDANT}\n`,
      );
      chmodSync(stub, 0o755);

      const child = spawn("bash", [copied, "-m", "1"], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
      });
      const supervisorPid = child.pid;
      if (supervisorPid === undefined) throw new Error("the supervisor process did not start");
      spawnedPids.push(-supervisorPid);
      const ended = new Promise<void>((resolve) => child.on("exit", () => resolve()));

      const logFile = join(root, "agent-loop.log");
      const readLog = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");

      // The session must be up and its descendant recorded before the first signal, or
      // this becomes the launch-window case a sibling test covers.
      await waitFor(
        () => existsSync(pidFile) && /^[1-9]\d*$/.test(readFileSync(pidFile, "utf8").trim()),
        "the session stub to record its descendant",
      );
      const backgroundPid = readBackgroundPid(pidFile);
      spawnedPids.push(backgroundPid);

      process.kill(supervisorPid, "SIGTERM");
      // Aimed at the grace rather than at a moment: this line is printed immediately
      // before the SIGTERM to the group, and the grace that follows is five seconds.
      await waitFor(() => /terminating its process group/.test(readLog()), "the reap to start");
      process.kill(supervisorPid, "SIGTERM");

      await ended;

      expect(
        isRunning(backgroundPid),
        `descendant ${backgroundPid} survived a second interrupt`,
      ).toBe(false);
      expect(readLog()).toContain("escalating to SIGKILL");
    },
    WAIT_FOR_LOG_MS * 4,
  );

  it("forwards SIGQUIT, which Ctrl+backslash sends to the whole foreground group", () => {
    const source = readFileSync(SUPERVISOR, "utf8");

    expect(source).toContain("trap 'on_signal QUIT' QUIT");
    expect(source).toContain("trap 'deferred_signal=QUIT' QUIT");
  });
});

describe("agent-loop.sh port seat (R8)", () => {
  it("defaults the single conductor to seat zero", () => {
    const res = runWithStubbedClaude("done", "-m", "1");

    expect(res.seat).toBe("0");
  });

  it("lets --seat override the default", () => {
    const res = runWithStubbedClaude("done", "-m", "1", "-S", "7");

    expect(res.seat).toBe("7");
  });

  it("exports the seat rather than only computing it", () => {
    // Read from the stub's own environment, which is the property that matters:
    // every consumer downstream reads the environment.
    const res = runWithStubbedClaude("done", "-m", "1", "-S", "3");

    expect(res.seat).not.toBe("<unset>");
    expect(res.seat).toBe("3");
  });

  it.each(["12", "-1", "a", ""])("rejects --seat '%s' rather than binding nonsense", (value) => {
    const res = runArgs("-S", value, "-m", "1");

    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/seat|requires a value/);
  });
});
