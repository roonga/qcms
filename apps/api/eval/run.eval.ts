import { env } from "node:process";

import { CONTAINER_BOOT_TIMEOUT_MS } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SYSTEM_PROMPT_VERSION } from "../src/features/agent/system-prompt.js";
import { capReached, charge, newBudget, type Budget } from "./budget.js";
import { evalConfig } from "./config.js";
import { failures, gradeTrace } from "./graders.js";
import { startHarness, type BudgetGate, type EvalHarness } from "./harness.js";
import { readApiKey } from "./key.js";
import {
  buildResults,
  emptyResults,
  notRun,
  openStatus,
  withRep,
  writeResults,
  writeTrace,
  type ScenarioResult,
} from "./results.js";
import { loadScenarios, scenarioIds, selectScenarios } from "./scenarios.js";
import { usageOfTrace } from "./trace.js";

/** A real turn waits on a real model, and a scenario can run several of them. */
const TURN_TIMEOUT_MS = 600_000;

function required(name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is set by \`pnpm agent:eval\`; run the eval through it`);
  }
  return value;
}

const config = evalConfig(env);
const key = readApiKey(env);
const runId = required("QCMS_EVAL_RUN_ID");
const directory = required("QCMS_EVAL_DIR");
const gitSha = required("QCMS_EVAL_GIT_SHA");

const ids = scenarioIds(env.QCMS_EVAL_SCENARIOS);
const selected = selectScenarios(loadScenarios(), {
  ...(ids === undefined ? {} : { ids }),
  safetyOnly: env.QCMS_EVAL_SAFETY_ONLY === "1",
});
if (selected.length === 0) throw new Error("no scenario matched the filters");

const startedAt = new Date().toISOString();
const status = openStatus(
  directory,
  { runId, startedAt, promptVersion: SYSTEM_PROMPT_VERSION, gitSha },
  selected,
);

let harness: EvalHarness;
let budget: Budget = newBudget(config.maxTokens);
let results: ScenarioResult[] = emptyResults(selected);

beforeAll(async () => {
  harness = await startHarness({ key, config });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  writeResults(
    directory,
    buildResults(
      {
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        gitSha,
        promptVersion: SYSTEM_PROMPT_VERSION,
        models: { requested: config.model, reported: null, grader: config.graderModel },
        thinking: config.thinking,
        budget,
      },
      results,
    ),
    key,
  );
  await harness.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe.each(selected)("$id $title", (scenario) => {
  for (let rep = 1; rep <= config.reps; rep += 1) {
    it(
      `repetition ${String(rep)}`,
      async () => {
        const now = (): string => new Date().toISOString();
        if (capReached(budget)) {
          results = withRep(results, scenario.id, notRun(rep));
          status.set(
            scenario.id,
            { state: "not-run", note: "the run reached its token cap" },
            now(),
          );
          return;
        }
        status.set(scenario.id, { state: "running" }, now());

        const gate: BudgetGate = {
          allow: () => !capReached(budget),
          charge: (usage) => {
            budget = charge(budget, usage);
          },
        };
        const trace = await harness.runScenario(
          scenario,
          rep,
          { runId, gitSha, graderModel: config.graderModel },
          gate,
        );
        const path = writeTrace(directory, trace, key);
        const findings = gradeTrace(trace);
        const failed = failures(findings);

        results = withRep(results, scenario.id, {
          rep,
          state: failed.length === 0 ? "passed" : "failed",
          findings,
          usage: usageOfTrace(trace),
          trace: path,
        });
        status.set(
          scenario.id,
          {
            state: "checked",
            turns: trace.turns.length,
            checks: {
              exit: failed.length === 0 ? 0 : 1,
              findings: failed.map((finding) => ({
                id: finding.check,
                severity: finding.severity,
                text: finding.text,
              })),
            },
          },
          now(),
        );

        expect(failed).toEqual([]);
      },
      TURN_TIMEOUT_MS,
    );
  }
});
