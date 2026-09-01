/**
 * Every documented harness knob is proven to REACH a task turbo ran (issue #154).
 *
 * ## The failure this exists to make impossible
 *
 * turbo 2.x runs tasks in strict env mode: a task sees only what `turbo.json`
 * declares, plus turbo's own defaults. A variable exported by a CI job or a
 * developer's shell is otherwise withheld, silently, with no warning anywhere.
 *
 * That is not theoretical. Issue #74's GHCR mirror had never applied to CI's
 * `verify` job at all - for weeks, while CI stayed green. The job environment
 * showed `QCMS_TEST_POSTGRES_IMAGE=ghcr.io/...`, the pre-pull succeeded, and the
 * harness nonetheless asked for its default `postgres:16-alpine` and went to
 * Docker Hub for it. `e2e` and `portal-e2e` honoured the mirror only because they
 * invoke Vitest and Playwright directly, with no turbo in front. "The variable is
 * set in the job" was accepted as evidence that it reached the process, and that
 * inference is what cost the weeks. Issue #150 fixed the instance by declaring
 * `globalPassThroughEnv`; nothing prevented the eighth knob from repeating it.
 *
 * ## Why it goes through a real `turbo run`
 *
 * Reading `process.env` inside a Vitest test proves nothing: Vitest is on the far
 * side of the boundary that strips the variable, and running the suite directly is
 * exactly the configuration that masked the bug for months. So this spawns turbo,
 * with a probe task whose only job is to print what arrived
 * (`scripts/print-passthrough-env.mjs`), and reads the output.
 *
 * ## Why it cannot go stale, in either direction
 *
 * The list under test is the union of `turbo.json`'s `globalPassThroughEnv` and the
 * documented knobs below, and each name gets its own sentinel value automatically.
 *
 * Reading the config alone would cover a knob the moment it is ADDED but would let a
 * knob's REMOVAL pass silently - the list would just get shorter, and #74 is exactly
 * a knob that stopped arriving. Listing the documented ones alone would go stale the
 * first time someone added a ninth. The union covers both: a new declaration is
 * proven on the commit that adds it, and dropping a documented one fails twice, once
 * on the declaration and once on the arrival.
 *
 * ## The control, which is what makes the rest mean anything
 *
 * A variable that is NOT in `globalPassThroughEnv` is set alongside the others and
 * asserted absent. Without it, every assertion here would also pass in a world where
 * strict mode had been turned off and everything flowed through - a green that says
 * nothing about the declaration under test.
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

/**
 * The knobs this repository documents for the Testcontainers harness (issue #154,
 * plus `QCMS_PORT_SEAT` from issue #255). They are asserted to ARRIVE and to be
 * DECLARED, which is what makes removing one from `turbo.json` red twice over:
 * the declaration assertion fails, and so does the arrival, because the variable is
 * then stripped exactly as it was for the weeks issue #74 was open.
 *
 * Anything else in `globalPassThroughEnv` is covered too - the run below tests the
 * union - so a knob added there is proven on the same commit that adds it.
 */
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

/** Documented knobs plus whatever else the config declares, without duplicates. */
function namesUnderTest(): readonly string[] {
  return [...new Set([...DOCUMENTED_HARNESS_KNOBS, ...readGlobalPassThroughEnv()])];
}

/** A run of the probe task is a process spawn plus turbo's own startup. */
const TURBO_RUN_TIMEOUT_MS = 120_000;

/** A value that could not have come from anywhere else, and names its variable. */
function sentinel(name: string): string {
  return `qcms-arrival-probe-${name.toLowerCase().replaceAll("_", "-")}`;
}

/** What the probe reported, as `name -> value` (`<unset>` when it did not arrive). */
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
    // The other half of the guard: deriving the arrival list from `turbo.json`
    // alone would make an entry's removal invisible rather than red, because the
    // list would simply get shorter.
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
    // uses one today; if that changes, the new list needs arrival coverage of its
    // own, and this is where that gets noticed.
    const config = readFileSync(TURBO_JSON, "utf8");
    expect(config).not.toContain('"passThroughEnv"');
  });
});
