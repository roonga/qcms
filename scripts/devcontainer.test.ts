import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("devcontainer.sh", import.meta.url));

// Setting this is what makes the destructive cases safe to run anywhere, including on
// a host where the container really is up.
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

  // The container mounts the host Docker socket (ADR-29), so a process inside it can
  // stop the container it lives in and take every session with it.
  it.each([
    ["stop", "stop"],
    ["down", "stop"],
    ["rebuild", "rebuild"],
  ])("refuses %s from inside the container it targets", (command, verb) => {
    const res = run([command], INSIDE);

    expect(res.status).toBe(2);
    expect(res.stderr).toContain(`refusing to ${verb} qcms-dev-container from inside`);
    expect(res.stdout).not.toContain("stopped qcms-dev-container");
    expect(res.stdout).not.toContain("removed existing");
  });

  it("refuses down through the same guard as stop, so the alias cannot bypass it", () => {
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

describe("devcontainer.sh docker probes (issue #269)", () => {
  const stubs: string[] = [];

  afterAll(() => {
    for (const dir of stubs) rmSync(dir, { recursive: true, force: true });
  });

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

  /** Only the interpreter and `dirname`, so "docker is absent" is literally true. */
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
    const dir = pathWith({
      docker: `echo "The command 'docker' could not be found in this WSL 2 distro."\nexit 1`,
    });

    const res = run(["status"], { PATH: `${dir}:${process.env.PATH ?? ""}` });

    expect(res.stdout).not.toContain("running: qcms-dev-container");
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
    // Order matters: a refusal reachable only when Docker is present would evaporate in
    // the degraded environment where an operator is most likely to try it.
    const dir = withShellTools(pathWith({}));

    const res = run(["stop"], { ...INSIDE, PATH: dir });

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("refusing to stop qcms-dev-container from inside");
  });
});

/**
 * The restart policy narrows the crash class only: the daemon treats an explicit stop
 * through the socket as manual, so the deliberate-stop path stays open.
 */
describe("the dev container comes back from a crash (issue #260)", () => {
  it("declares a restart policy in runArgs", () => {
    const config = readFileSync(
      fileURLToPath(new URL("../.devcontainer/devcontainer.json", import.meta.url)),
      "utf8",
    );
    // Read as text rather than parsed: the file carries JSONC comments.
    expect(config).toContain('"--restart=unless-stopped"');
    // `unless-stopped`, not `always`: `always` would revive a container an operator had
    // deliberately stopped from the host.
    expect(config).not.toContain('"--restart=always"');
  });
});
