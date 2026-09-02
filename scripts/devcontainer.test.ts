import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

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

/**
 * Issue #269: the probes tested whether `docker ps` produced OUTPUT, not whether it
 * SUCCEEDED, so on a WSL2 host with no Docker CLI the command_not_found handler's
 * message - written to stdout, so `2>/dev/null` does not touch it - was captured
 * and read as a container id. `status` printed `running: qcms-dev-container` on a
 * machine with no engine, no CLI and no container, and `shell`/`run` skipped the
 * clean "not running" diagnostic to fail inside `docker exec` instead.
 *
 * Both halves are driven here rather than reasoned about: a stub `docker` that
 * behaves exactly like that handler, and a PATH with no `docker` on it at all.
 */
describe("devcontainer.sh docker probes (issue #269)", () => {
  const stubs: string[] = [];

  afterAll(() => {
    for (const dir of stubs) rmSync(dir, { recursive: true, force: true });
  });

  /** A PATH whose only entry holds the given executables. */
  function pathWith(executables: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "devcontainer-stub-"));
    stubs.push(dir);
    for (const [name, body] of Object.entries(executables)) {
      const file = join(dir, name);
      writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(file, 0o755);
    }
    return dir;
  }

  /**
   * The two tools this script cannot run without: the interpreter it is spawned
   * with, and `dirname`, which its first line uses to find the repository. Linking
   * exactly those into an otherwise empty PATH is what makes "docker is absent"
   * literally true rather than approximately so.
   */
  function withShellTools(dir: string): string {
    for (const tool of ["bash", "dirname"]) {
      const real = spawnSync("/usr/bin/env", ["sh", "-c", `command -v ${tool}`], {
        encoding: "utf8",
      }).stdout.trim();
      symlinkSync(real, join(dir, tool));
    }
    return dir;
  }

  it("does not claim the container is running when docker errors onto stdout", () => {
    // The reproduction, byte for byte in shape: output on stdout, non-zero exit.
    const dir = pathWith({
      docker: `echo "The command 'docker' could not be found in this WSL 2 distro."\nexit 1`,
    });

    const res = run(["status"], { PATH: `${dir}:${process.env.PATH ?? ""}` });

    expect(res.stdout).not.toContain("running: qcms-dev-container");
    // It reports what it can actually see instead.
    expect(res.stdout).toContain("not created");
  });

  it("refuses shell with the diagnostic rather than falling through to docker exec", () => {
    const dir = pathWith({
      docker: `echo "The command 'docker' could not be found in this WSL 2 distro."\nexit 1`,
    });

    const res = run(["shell"], { PATH: `${dir}:${process.env.PATH ?? ""}` });

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("is not running");
  });

  it("dies naming Docker Desktop's WSL integration when the CLI is absent entirely", () => {
    const dir = withShellTools(pathWith({}));

    const res = run(["status"], { PATH: dir });

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("docker CLI was not found");
    expect(res.stderr).toContain("WSL integration");
    expect(res.stdout).not.toContain("running: qcms-dev-container");
  });

  it("still refuses a destructive verb from inside the container without a docker CLI", () => {
    // Order matters: the refusal must not become reachable only when Docker is
    // present, or the guard would evaporate in exactly the degraded environment
    // where a confused operator is most likely to try `stop`.
    const dir = withShellTools(pathWith({}));

    const res = run(["stop"], { ...INSIDE, PATH: dir });

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("refusing to stop qcms-dev-container from inside");
  });
});

/**
 * The blast-radius layer of issue #260 (Code Owner decision, 2026-09-02).
 *
 * The container mounts the host Docker socket, which is full daemon authority, and the
 * refusals above close only the path that goes through this script. A direct
 * `docker stop` from inside never reaches them.
 *
 * The restart policy narrows what an ending costs, and only for the **crash class**.
 * Measured on Docker 29.6.2: a crash exit restarts and `RestartCount` climbs, while a
 * `docker stop` or `docker kill` through the socket ends `status=exited` with
 * `RestartCount=0` and stays down - the restart manager treats every explicit stop as
 * manual, and the daemon cannot tell an API client inside the container from one
 * outside. So this does not cover the deliberate-stop path, and the comment beside the
 * argument says so rather than claiming the harm is gone.
 *
 * Asserted because it is one word in a JSON file that no other test would miss, and
 * because `up` silently ignores changed `runArgs` on a running container, so the way
 * this regresses is silent in both directions.
 */
describe("the dev container comes back from a crash (issue #260)", () => {
  it("declares a restart policy in runArgs", () => {
    const config = readFileSync(
      fileURLToPath(new URL("../.devcontainer/devcontainer.json", import.meta.url)),
      "utf8",
    );
    // Read as text rather than parsed: the file carries JSONC comments, and the comment
    // beside this argument is where the reasoning lives.
    expect(config).toContain('"--restart=unless-stopped"');
    // `unless-stopped` rather than `always`. The two behave identically for a stop
    // issued through the socket - both skip the policy - so the difference is a daemon
    // restart or host reboot, where `always` would revive a container an operator had
    // deliberately stopped from the host.
    expect(config).not.toContain('"--restart=always"');
  });
});
