/**
 * Must spawn a real `turbo run`: Vitest sits beyond the boundary strict env mode strips. The list is
 * the union of `turbo.json` and the documented knobs, with an excluded control so it cannot pass if
 * strict mode were simply off.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ARRIVAL_PREFIX,
  CONTROL_VARIABLE,
  readGlobalPassThroughEnv,
} from "./print-passthrough-env.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const TURBO_BIN = fileURLToPath(new URL("../node_modules/.bin/turbo", import.meta.url));
const TURBO_JSON = fileURLToPath(new URL("../turbo.json", import.meta.url));

const DOCUMENTED_HARNESS_KNOBS = [
  "QCMS_PORT_SEAT",
  "QCMS_TEST_POSTGRES_IMAGE",
  "TESTCONTAINERS_RYUK_DISABLED",
  "RYUK_CONTAINER_IMAGE",
  "TESTCONTAINERS_HOST_OVERRIDE",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_AUTH_CONFIG",
] as const;

function namesUnderTest(): readonly string[] {
  return [...new Set([...DOCUMENTED_HARNESS_KNOBS, ...readGlobalPassThroughEnv()])];
}

const TURBO_RUN_TIMEOUT_MS = 120_000;

function sentinel(name: string): string {
  return `qcms-arrival-probe-${name.toLowerCase().replaceAll("_", "-")}`;
}

function runProbe(): { arrived: Map<string, string>; stdout: string } {
  const names: string[] = [...namesUnderTest(), CONTROL_VARIABLE];
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const name of names) env[name] = sentinel(name);

  const res = spawnSync(TURBO_BIN, ["run", "env-arrival"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
    timeout: TURBO_RUN_TIMEOUT_MS,
  });
  const stdout = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  expect(res.status, `turbo run env-arrival failed:\n${stdout}`).toBe(0);

  const arrived = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const match = new RegExp(`${ARRIVAL_PREFIX} ([A-Z0-9_]+)=(.*)$`).exec(line);
    if (match?.[1] !== undefined) arrived.set(match[1], match[2] ?? "");
  }
  return { arrived, stdout };
}

describe("turbo globalPassThroughEnv arrival", () => {
  const declared: readonly string[] = readGlobalPassThroughEnv();
  const { arrived, stdout } = runProbe();

  it("declares every documented knob", () => {
    for (const name of DOCUMENTED_HARNESS_KNOBS) expect(declared).toContain(name);
  });

  it("has a turbo binary and a probe task to drive", () => {
    expect(existsSync(TURBO_BIN), `no turbo binary at ${TURBO_BIN}`).toBe(true);
    expect(stdout, "the probe printed nothing at all").toContain(ARRIVAL_PREFIX);
  });

  it.each(namesUnderTest())("%s reaches the process turbo spawned", (name: string) => {
    expect(
      arrived.get(name),
      `${name} did not arrive at the task turbo ran. Either it is missing from` +
        ` turbo.json's globalPassThroughEnv, in which case turbo's strict env mode` +
        ` stripped it, or the probe task did not run:\n${stdout}`,
    ).toBe(sentinel(name));
  });

  it("strips a variable that is not declared, so strict mode is really on", () => {
    expect(
      arrived.get(CONTROL_VARIABLE),
      `${CONTROL_VARIABLE} arrived. It is in no declaration, so either strict env mode` +
        " is off or something is passing the whole environment through - and the" +
        " assertions above would then pass without testing anything.",
    ).toBe("<unset>");
  });

  it("keeps the global declaration the only one, so this list is the whole story", () => {
    // A task-level `passThroughEnv` would carry knobs this test never sees. Nothing
    const config = readFileSync(TURBO_JSON, "utf8");
    expect(config).not.toContain('"passThroughEnv"');
  });
});
