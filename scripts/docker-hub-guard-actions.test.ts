/**
 * The no-Docker-Hub-pulls guard must fail on its own tooling failure (issue #171).
 *
 * The two composite actions under `.github/actions` are the evidence half of issue
 * #150: one baselines the runner's images, the other proves nothing new appeared
 * during the test run. Both ran under `set -uo pipefail`, without `-e`, and that is
 * the difference between a guard and a decoration:
 *
 * - a failed baseline `docker image ls` wrote an EMPTY snapshot and the step still
 *   exported it as the baseline;
 * - a failed `docker image ls` or `comm` in the assertion left `new_images` empty,
 *   which reads identically to "nothing was pulled", and the step printed
 *   "Zero registry calls, so zero Docker Hub calls" as its verdict.
 *
 * Both are the confident-wrong-evidence class the guard exists to prevent, applied
 * to the guard itself. The bite is proven here rather than inspected: each script is
 * extracted from the action and driven with a `docker` stub that fails the way a
 * broken daemon does - writing to stdout, exiting non-zero - which is also the
 * shape that fooled `scripts/devcontainer.sh` (issue #269).
 *
 * The scripts are read out of the YAML rather than copied, so a future edit to
 * either action is what these tests run.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const ACTIONS = fileURLToPath(new URL("../.github/actions/", import.meta.url));
const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/**
 * The `run: |` body of one step of a composite action, keyed by step name.
 *
 * A three-line reader rather than a YAML dependency: these files hold one block
 * scalar per step and the shape is checked below. The `${{` assertion guards the one
 * way this could go wrong: such an expression is filled in by the runner, not by
 * bash, so a script containing one cannot be driven from here and must not be
 * silently executed as if it could.
 */
function stepScript(action: string, stepName: string): string {
  const lines = readFileSync(join(ACTIONS, action, "action.yml"), "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  expect(start, `no step named ${JSON.stringify(stepName)} in ${action}`).toBeGreaterThan(-1);

  const runAt = lines.findIndex((line, index) => index > start && line.trim() === "run: |");
  expect(runAt, `no block-scalar run: in ${stepName}`).toBeGreaterThan(-1);

  const indent = (lines[runAt]?.length ?? 0) - (lines[runAt]?.trimStart().length ?? 0) + 2;
  const body: string[] = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== "" && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  const script = body.join("\n");
  expect(script, "the extracted script is empty").not.toBe("");
  expect(script, "a runner-substituted expression cannot be driven from bash").not.toContain("${{");
  return script;
}

/** A throwaway workspace with a `docker` stub of the caller's choosing on PATH. */
function workspaceWith(dockerStub: string) {
  const root = mkdtempSync(join(tmpdir(), "docker-hub-guard-"));
  workspaces.push(root);
  mkdirSync(join(root, "bin"));
  const stub = join(root, "bin", "docker");
  writeFileSync(stub, `#!/usr/bin/env bash\n${dockerStub}\n`);
  chmodSync(stub, 0o755);
  return { root, path: `${join(root, "bin")}:${process.env.PATH ?? ""}` };
}

function runScript(script: string, env: Record<string, string>, dockerStub: string) {
  const { root, path } = workspaceWith(dockerStub);
  const scriptPath = join(root, "step.sh");
  writeFileSync(scriptPath, script);
  const githubEnv = join(root, "github-env.txt");
  writeFileSync(githubEnv, "");
  const res = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, PATH: path, GITHUB_ENV: githubEnv, RUNNER_TEMP: root, ...env },
  });
  return { ...res, root, githubEnv: readFileSync(githubEnv, "utf8") };
}

/** A file holding a baseline snapshot, for the assertion step to read. */
function baselineFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "docker-hub-baseline-"));
  workspaces.push(dir);
  const file = join(dir, "baseline.txt");
  writeFileSync(file, contents);
  return file;
}

/**
 * A `docker` that fails the way a stopped daemon does: a message on **stdout**, a
 * non-zero exit. Output on stdout is what makes this the hard case - a caller that
 * tests for output rather than for success cannot tell it from a result.
 */
const BROKEN_DOCKER = `echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock."\nexit 1`;

/** A `docker` that answers `image ls` with a fixed, sorted list and nothing else. */
const WORKING_DOCKER = `if [ "$1" = "image" ]; then printf '%s\\n' 'ghcr.io/owner/qcms/postgres:16-alpine' 'node:24'; exit 0; fi\nexit 0`;

/** The same, but with a Docker Hub reference among the images: no registry host. */
const HUB_PULL_DOCKER = `if [ "$1" = "image" ]; then printf '%s\\n' 'node:24' 'postgres:16-alpine'; exit 0; fi\nexit 0`;

const ASSERT_STEP = "Assert no Docker Hub image pulls during the test run";
const SNAPSHOT_STEP = "Snapshot the runner's images (baseline for the no-Docker-Hub check)";

describe("assert-no-docker-hub-pulls", () => {
  const script = stepScript("assert-no-docker-hub-pulls", ASSERT_STEP);

  it("fails instead of reporting zero pulls when its own docker call fails", () => {
    const baseline = baselineFile("node:24\n");

    const res = runScript(script, { QCMS_DOCKER_IMAGE_SNAPSHOT: baseline }, BROKEN_DOCKER);

    expect(res.status).not.toBe(0);
    // The verdict it used to print on exactly this failure.
    expect(res.stdout).not.toContain("Zero registry calls");
    expect(res.stdout).not.toContain("Images pulled during the test run: none");
  });

  it("still reports a clean run when docker answers", () => {
    // The positive control: without it the assertion above would also pass against
    // a script that refuses everything, which would prove nothing about the guard.
    const baseline = baselineFile("ghcr.io/owner/qcms/postgres:16-alpine\nnode:24\n");

    const res = runScript(script, { QCMS_DOCKER_IMAGE_SNAPSHOT: baseline }, WORKING_DOCKER);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Images pulled during the test run: none");
  });

  it("still fails a real Docker Hub pull rather than only tooling failures", () => {
    // The property the guard exists for, driven through the same extraction: an
    // image that was not in the baseline and carries no registry host is a Hub pull.
    const baseline = baselineFile("node:24\n");

    const res = runScript(script, { QCMS_DOCKER_IMAGE_SNAPSHOT: baseline }, HUB_PULL_DOCKER);

    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("Docker Hub pull during the test run");
  });

  it("refuses to run at all without a baseline", () => {
    const res = runScript(script, { QCMS_DOCKER_IMAGE_SNAPSHOT: "" }, WORKING_DOCKER);

    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("No image baseline");
  });
});

describe("test-postgres-image baseline snapshot", () => {
  const script = stepScript("test-postgres-image", SNAPSHOT_STEP);

  it("fails instead of exporting an empty baseline when docker fails", () => {
    const res = runScript(script, {}, BROKEN_DOCKER);

    expect(res.status).not.toBe(0);
    // The damage the missing `-e` did: a baseline of nothing, exported as if it
    // were one, which the paired assertion then reports against.
    expect(res.githubEnv).not.toContain("QCMS_DOCKER_IMAGE_SNAPSHOT");
  });

  it("exports the baseline when docker answers", () => {
    const res = runScript(script, {}, WORKING_DOCKER);

    expect(res.status).toBe(0);
    expect(res.githubEnv).toContain("QCMS_DOCKER_IMAGE_SNAPSHOT=");
    expect(res.stdout).toContain("Baselined 2 image references");
  });
});
