import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Only the argument handling is covered here. Everything past it talks to a
// Docker daemon, which belongs to a live environment rather than the unit gate.
const SCRIPT = fileURLToPath(new URL("devcontainer.sh", import.meta.url));

function run(...args: string[]) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

describe("devcontainer.sh", () => {
  it("refuses an unknown command and lists the real ones", () => {
    const res = run("bogus");

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("unknown command: bogus");
    for (const cmd of ["up", "rebuild", "shell", "run", "status", "stop"]) {
      expect(res.stderr).toContain(cmd);
    }
  });

  it("refuses to run with no command rather than defaulting to one", () => {
    // Defaulting to `up` here would start a container someone did not ask for.
    const res = run();

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("no command given");
  });

  it("requires a command string for run", () => {
    const res = run("run");

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("run needs a command");
  });

  it("prints usage for --help without touching Docker", () => {
    const res = run("--help");

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("devcontainer.sh");
    expect(res.stdout).toContain("rebuild");
  });
});
