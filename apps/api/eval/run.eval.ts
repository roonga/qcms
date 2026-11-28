import { env } from "node:process";

import { CONTAINER_BOOT_TIMEOUT_MS } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SYSTEM_PROMPT_VERSION } from "../src/features/agent/system-prompt.js";
import { NO_USAGE, capReached, charge, newBudget, type Budget } from "./budget.js";
import { evalConfig } from "./config.js";
import { failures, gradeTrace } from "./graders.js";
import { ScenarioRunError, startHarness, type BudgetGate, type EvalHarness } from "./harness.js";
import { readApiKey } from "./key.js";
import {
  buildResults,
  emptyResults,
  notRun,
  openStatus,
  repState,
  statusNote,
  withRep,
  writeResults,
  writeTrace,
  type ScenarioResult,
} from "./results.js";
import { loadScenarios, scenarioIds, selectScenarios } from "./scenarios.js";
import { onlyId, usageOfTrace, type ScenarioTrace } from "./trace.js";

/** A real turn waits on a real model, and a scenario can run several of them. */
const TURN_TIMEOUT_MS = 600_000;

const CAP_NOTE = "the run reached its token cap";

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
  key,
);

let harness: EvalHarness | undefined;
let budget: Budget = newBudget(config.maxTokens);
let results: ScenarioResult[] = emptyResults(selected);
const reportedIds: string[] = [];

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
        models: {
          requested: config.model,
          reported: onlyId(reportedIds),
          grader: config.graderModel,
        },
        thinking: config.thinking,
        budget,
      },
      results,
    ),
    key,
  );
  await harness?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function startedHarness(): EvalHarness {
  if (harness === undefined) throw new Error("the harness did not start");
  return harness;
}

function keepReported(trace: ScenarioTrace | null): void {
  if (trace !== null && trace.models.reported !== null) reportedIds.push(trace.models.reported);
}

/** A repetition that threw is a failure of record: its turns, its usage and its trace are kept. */
function recordFailure(id: string, rep: number, error: unknown, now: string): void {
  const partial = error instanceof ScenarioRunError ? error.trace : null;
  const text = error instanceof Error ? error.message : String(error);
  keepReported(partial);
  results = withRep(results, id, {
    rep,
    state: "failed",
    findings: [{ check: "run", severity: "fail", text, evidence: "" }],
    usage: partial === null ? NO_USAGE : usageOfTrace(partial),
    trace: partial === null ? null : writeTrace(directory, partial, key),
  });
  status.set(
    id,
    {
      state: "checked",
      turns: partial?.turns.length ?? 0,
      checks: { exit: 1, findings: [{ id: "run", severity: "fail", text: statusNote(text) }] },
    },
    now,
  );
}

describe.each(selected)("$id $title", (scenario) => {
  for (let rep = 1; rep <= config.reps; rep += 1) {
    it(
      `repetition ${String(rep)}`,
      async (ctx) => {
        const now = (): string => new Date().toISOString();
        if (capReached(budget)) {
          results = withRep(results, scenario.id, notRun(rep));
          status.set(scenario.id, { state: "not-run", note: CAP_NOTE }, now());
          // Skipped, never passed: `pnpm agent:eval` reads the count back and stops non-zero.
          ctx.skip(CAP_NOTE);
        }
        status.set(scenario.id, { state: "running" }, now());

        const gate: BudgetGate = {
          allow: () => !capReached(budget),
          charge: (usage) => {
            budget = charge(budget, usage);
          },
        };

        let trace: ScenarioTrace;
        try {
          trace = await startedHarness().runScenario(
            scenario,
            rep,
            { runId, gitSha, graderModel: config.graderModel },
            gate,
          );
        } catch (error) {
          recordFailure(scenario.id, rep, error, now());
          throw error;
        }

        const path = writeTrace(directory, trace, key);
        const findings = gradeTrace(trace);
        const failed = failures(findings);
        const state = repState(trace.turns.length === scenario.messages.length, failed.length);
        keepReported(trace);

        results = withRep(results, scenario.id, {
          rep,
          state,
          findings,
          usage: usageOfTrace(trace),
          trace: path,
        });
        status.set(
          scenario.id,
          {
            state: state === "not-run" ? "not-run" : "checked",
            turns: trace.turns.length,
            checks: {
              exit: failed.length === 0 ? 0 : 1,
              findings: failed.map((finding) => ({
                id: finding.check,
                severity: finding.severity,
                text: statusNote(finding.text),
              })),
            },
          },
          now(),
        );

        expect(failed).toEqual([]);
        expect(state).not.toBe("not-run");
      },
      TURN_TIMEOUT_MS,
    );
  }
});
