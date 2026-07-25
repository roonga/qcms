import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const SUPERVISOR = fileURLToPath(new URL("agent-loop.sh", import.meta.url));
const workspaces: string[] = [];

afterAll(() => {
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

  const stub = join(root, "bin", "claude");
  writeFileSync(stub, `#!/usr/bin/env bash\ncat <<'OUT'\n${stubOutput}\nOUT\n`);
  chmodSync(stub, 0o755);

  return spawnSync("bash", [copied, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
  });
}

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

  it("stops at a human gate rather than continuing to the next task", () => {
    const res = runWithStubbedClaude("NEXT-TASK: AWAITING-HUMAN 030", "-m", "5");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("human gate reached");
    expect(res.stdout).not.toContain("iteration 2");
  });
});
