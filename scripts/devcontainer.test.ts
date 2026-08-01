import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Only the argument handling is covered here. Everything past it talks to a
// Docker daemon, which belongs to a live environment rather than the unit gate.
//
// That comment used to be aspirational: the `stop` case invoked the real thing,
// so running this suite inside the dev container stopped the container it was
// running in (issues #244, #260). Every case below now refuses before reaching
// a daemon, and the destructive ones are driven through the guard on purpose.
const SCRIPT = fileURLToPath(new URL("devcontainer.sh", import.meta.url));

// Tells the script it is executing inside the container it targets. Setting it
// is what makes the destructive cases safe to run anywhere, including on a host
// where the container really is up.
const INSIDE = { QCMS_DEVCONTAINER: "qcms-dev-container" };

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("devcontainer.sh", () => {
  it("refuses an unknown command and lists the real ones", () => {
    const res = run(["bogus"]);

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("unknown command: bogus");
    for (const cmd of ["up", "rebuild", "shell", "run", "status", "stop", "down"]) {
      expect(res.stderr).toContain(cmd);
    }
  });

  // The container mounts the host Docker socket (ADR-29), so a process inside it
  // can stop the container it lives in and take every session with it. These
  // three cases are the guard that makes that impossible rather than forbidden.
  it.each([
    ["stop", "stop"],
    ["down", "stop"],
    ["rebuild", "rebuild"],
  ])("refuses %s from inside the container it targets", (command, verb) => {
    const res = run([command], INSIDE);

    expect(res.status).toBe(2);
    expect(res.stderr).toContain(`refusing to ${verb} qcms-dev-container from inside`);
    // Proof it never reached the daemon: the success paths announce themselves.
    expect(res.stdout).not.toContain("stopped qcms-dev-container");
    expect(res.stdout).not.toContain("removed existing");
  });

  it("refuses down through the same guard as stop, so the alias cannot bypass it", () => {
    // `stop` is a backwards-compatible alias for `down`. Asserting both refuse
    // with the identical message is what proves they still share one code path,
    // which the old test proved by actually stopping the container.
    const viaStop = run(["stop"], INSIDE);
    const viaDown = run(["down"], INSIDE);

    expect(viaStop.stderr).toBe(viaDown.stderr);
    expect(viaStop.status).toBe(viaDown.status);
  });

  it("names the marker in the refusal, so the guard is diagnosable when it is wrong", () => {
    const res = run(["stop"], INSIDE);

    expect(res.stderr).toContain("QCMS_DEVCONTAINER");
    expect(res.stderr).toContain("Run it from the");
  });

  it("refuses to run with no command rather than defaulting to one", () => {
    // Defaulting to `up` here would start a container someone did not ask for.
    const res = run([]);

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("no command given");
  });

  it("requires a command string for run", () => {
    const res = run(["run"]);

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("run needs a command");
  });

  it("prints usage for --help without touching Docker", () => {
    const res = run(["--help"]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("devcontainer.sh");
    expect(res.stdout).toContain("rebuild");
  });
});
