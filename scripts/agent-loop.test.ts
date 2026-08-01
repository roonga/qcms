import { spawnSync } from "node:child_process";
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
const workspaces: string[] = [];
// Anything a session-stub test spawns, so a failing assertion cannot leak a
// long-lived process onto the machine running the suite.
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

// Argument validation runs before the script changes directory or touches the
// repo, so the invalid cases are safe to drive against the real file.
function runArgs(...args: string[]) {
  return spawnSync("bash", [SUPERVISOR, ...args], { encoding: "utf8" });
}

// The valid-argument case actually enters the supervisor loop, so it gets a
// throwaway workspace and a stub `claude` on PATH. Without the stub this would
// launch a real session and claim a ledger task.
function runWithStubbedClaude(stubOutput: string, ...args: string[]) {
  const root = mkdtempSync(join(tmpdir(), "agent-loop-"));
  workspaces.push(root);

  // The script resolves its workspace as `dirname $0/..`, so a copy under
  // <root>/scripts keeps its log and cwd inside the throwaway directory.
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  const copied = join(root, "scripts", "agent-loop.sh");
  copyFileSync(SUPERVISOR, copied);

  // The stub records the argv it was launched with, one argument per line, so a
  // test can assert what the supervisor actually passes to `claude`.
  const stub = join(root, "bin", "claude");
  const argvLog = join(root, "claude-argv.txt");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >>'${argvLog}'\ncat <<'OUT'\n${stubOutput}\nOUT\n`,
  );
  chmodSync(stub, 0o755);

  const res = spawnSync("bash", [copied, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
  });

  const claudeArgv = existsSync(argvLog)
    ? readFileSync(argvLog, "utf8").split("\n").filter(Boolean)
    : [];
  return { ...res, claudeArgv };
}

// A regression leaves the supervisor blocked on the session's descendants
// forever, so every run below is capped rather than allowed to hang the suite.
// The cap doubles as the interrupt trigger for the signal test, which is why it
// is a parameter.
const SUPERVISOR_KILL_MS = 60_000;
const INTERRUPT_AFTER_MS = 3_000;

// Whatever this returns is pushed to spawnedPids and later handed to
// process.kill(), so a value that is not a live pid is not a cosmetic problem:
// Number("") is 0, and signalling pid 0 hits the caller's entire process group,
// which here is the Vitest runner - a test helper capable of killing its own
// runner. Number("garbage") is NaN, no better. Everything that is not a positive
// integer is therefore rejected right where it is parsed, naming what was read,
// so a malformed stub write surfaces as a clear failure rather than a mystery
// runner death.
function readBackgroundPid(pidFile: string): number {
  const raw = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : "";
  if (raw === "") throw new Error("the session stub never recorded a background pid");
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`the session stub recorded a background pid that is not a pid: '${raw}'`);
  }
  return Number(raw);
}

// Holds the supervisor's launch window open: the stretch between forking the
// session and knowing the process group id to reap. A signal landing in there is
// the case fix-2 is about, and it is far too narrow to aim at, so the test
// widens it. `set +m` is the anchor because it sits INSIDE that window in the
// shape being guarded against (group id assigned after it) and outside it in the
// current shape (assigned before it, signals deferred across it) - so the same
// injected delay puts the signal in the window for the old shape and proves the
// new one survives it. Asserting the match count keeps a future rename from
// turning this into a test that passes without exercising anything.
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

// Same throwaway workspace as above, but the caller writes the whole stub body:
// these tests need a `claude` that spawns background work of its own, which is
// the thing the supervisor has to clean up. `--mailbox` is always overridden to
// a lane-specific name so a run can never read or ack a real seat-mail inbox.
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

  const res = spawnSync("bash", [copied, "-m", "1", "-M", "test240"], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
  });

  const backgroundPid = readBackgroundPid(pidFile);
  spawnedPids.push(backgroundPid);
  return { ...res, backgroundPid };
}

// A single observation, deliberately: the supervisor's reap does not return
// until the group is gone, so "did it survive?" needs no polling and no
// deadline. That keeps this assertion out of the flake class issue #165
// describes, where the same question was asked with a wall-clock budget and went
// marginal under load. `/proc` rather than `kill(pid, 0)` because a SIGKILLed
// process lingers as a zombie its parent has not collected yet, and a zombie
// still answers signal 0 - the exact trap #165 calls out.
//
// That makes these tests Linux-only. Absent /proc, isRunning() would report
// every pid as dead and the assertions would pass without proving anything, so
// the suite skips explicitly rather than going vacuously green (the canonical
// environment is the Ubuntu dev container, ADR-29, and CI runs on ubuntu).
const HAS_PROCFS = existsSync("/proc/self/stat");

function isRunning(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return false;
  }
  // The comm field is parenthesised and may itself contain spaces, so state is
  // the first field after the final ')'.
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

  // "0" is the dangerous one and the reason this guard exists: process.kill(0)
  // signals the caller's process group, so a stub that wrote a zero would have
  // this suite kill the Vitest runner it is running inside.
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
  // The regression that motivated this: the numeric flags reach arithmetic
  // contexts, where a non-numeric value does not error, it evaluates to 0. So
  // `-m abc` ran zero iterations and exited looking like a clean run.
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
    // The bare `set -u` failure this replaced named neither flag nor script.
    expect(res.stderr).not.toContain("unbound variable");
  });

  it("rejects a non-numeric --stop-after-task before the run starts", () => {
    // It is only used at sentinel-match time, inside $((10#...)), so an invalid
    // value used to throw a bash arithmetic error mid-run and the stop check
    // then silently never fired.
    const res = runArgs("-s", "abc");

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--stop-after-task");
  });

  it("still accepts a zero-padded task id, which is the documented form", () => {
    const res = runWithStubbedClaude("NEXT-TASK: NOTHING", "-s", "010", "-m", "1");

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
    // NOTHING is the ledger-exhausted sentinel, so the loop stops after one
    // pass rather than spinning for the full --max-iterations.
    const res = runWithStubbedClaude("NEXT-TASK: NOTHING", "-p", "2", "-r", "5", "-m", "3");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("iteration 1");
    expect(res.stdout).toContain("ledger exhausted");
    // Proves validation did not reject the parallel value on the way through.
    expect(res.stdout).toContain("/next-task 2");
  });

  it("pins the model, so an unattended run cannot drift with the CLI default", () => {
    const res = runWithStubbedClaude("NEXT-TASK: NOTHING", "-m", "1");

    expect(res.status).toBe(0);
    // Adjacency, not mere presence: `--model` has to actually carry the id.
    expect(res.claudeArgv[res.claudeArgv.indexOf("--model") + 1]).toBe("claude-opus-5");
  });

  it("stops at a human gate rather than continuing to the next task", () => {
    const res = runWithStubbedClaude("NEXT-TASK: AWAITING-HUMAN 030", "-m", "5");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("human gate reached");
    expect(res.stdout).not.toContain("iteration 2");
  });
});

// Issue #240: an iteration's session spawns background work of its own, and
// whatever ends the session - a normal exit, a crash, the CLI terminating its
// own background tasks - leaves those descendants reparented to init and still
// running. One that keeps draining ../seat-mail/<mailbox>/ can eat a steer meant
// for the LIVE iteration, and the bus is at-most-once per file, so the message
// is simply lost. Every test here fails against the pre-fix supervisor.
describe.skipIf(!HAS_PROCFS)("agent-loop.sh session process groups (issue #240)", () => {
  it("terminates background work the session left behind", () => {
    // Models a background task that writes somewhere other than the session's
    // stdout, which is what the CLI's own background tasks do.
    const res = runWithSessionStub(
      ["sleep 600 >/dev/null 2>&1 &", 'echo "$!" >"$PID_FILE"', 'echo "NEXT-TASK: NOTHING"'].join(
        "\n",
      ),
    );

    expect(res.status).toBe(0);
    // Pre-fix this is still running: the supervisor waited on the session
    // process only and never touched its tree.
    expect(isRunning(res.backgroundPid)).toBe(false);
    expect(res.stdout).toContain("terminating its process group");
  });

  it("does not wait on a descendant that inherited the session's output", () => {
    // Same orphan, different symptom. The output used to be captured with a
    // command substitution, which does not return until every process holding
    // the write end of the pipe has exited - so this shape hung the supervisor
    // indefinitely instead of letting it reap and move on.
    const res = runWithSessionStub(
      ["sleep 600 &", 'echo "$!" >"$PID_FILE"', 'echo "NEXT-TASK: NOTHING"'].join("\n"),
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("ledger exhausted");
    expect(isRunning(res.backgroundPid)).toBe(false);
  });

  it(
    "takes a still-running session and its children down when the supervisor is signalled",
    () => {
      // The session now runs in its own process group, so a terminal Ctrl+C no
      // longer reaches it on its own. Forwarding the signal is what keeps the
      // documented "Ctrl+C anytime" true, and this is the shape a container
      // stopping itself mid-run produces - where one of the observed orphans
      // came from. spawnSync's timeout sends SIGTERM to the supervisor, which is
      // that interrupt path exactly.
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
      // Pre-fix both this and the session itself outlived the supervisor.
      expect(isRunning(res.backgroundPid)).toBe(false);
    },
    // Derived from the interrupt it has to outlive rather than written out, so
    // the two cannot drift (the convention issue #165 asks for).
    INTERRUPT_AFTER_MS * 4,
  );

  it(
    "still reaps when the signal lands before the group id is known",
    () => {
      // The launch window, held open (see holdLaunchWindowOpen) so the signal
      // can be aimed into it. With the group id assigned after `set +m` the
      // handler finds nothing to reap and this orphan outlives the supervisor,
      // which is the whole "on every path out" claim failing on the one path
      // that matters most. The interrupt lands ~1.5s into a ~5s window, so
      // nothing here depends on hitting a narrow moment.
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
    // The held window plus the interrupt it has to outlive, with headroom -
    // derived, not a written-out number, so the two cannot drift.
    (LAUNCH_WINDOW_HOLD_SEC * 1000 + LAUNCH_WINDOW_INTERRUPT_MS) * 3,
  );
});
