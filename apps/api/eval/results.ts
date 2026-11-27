import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  STATUS_FILE_NAME,
  createStatus,
  withScenario,
  writeStatus,
} from "../../../scripts/agent-review/eval-status.mjs";
import type { Budget, Usage } from "./budget.js";
import { capReached, sumUsage } from "./budget.js";
import { keyFreeJson } from "./key.js";
import type { EvalScenario } from "./scenarios.js";
import type { EvalFinding } from "./graders.js";
import type { ScenarioTrace, TraceModels } from "./trace.js";

export const RESULTS_VERSION = 1;

export const RESULTS_FILE_NAME = "results.json";

export type RepState = "passed" | "failed" | "not-run";

export interface RepResult {
  readonly rep: number;
  readonly state: RepState;
  readonly findings: readonly EvalFinding[];
  readonly usage: Usage;
  readonly trace: string | null;
}

export interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly safety: boolean;
  readonly reps: readonly RepResult[];
}

export interface RunSummary {
  readonly passed: number;
  readonly failed: number;
  readonly notRun: number;
  readonly safetyFailures: number;
}

export interface EvalResults {
  readonly version: number;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly gitSha: string;
  readonly promptVersion: number;
  readonly models: TraceModels;
  readonly thinking: string;
  readonly cap: { readonly maxTokens: number; readonly spent: Usage; readonly reached: boolean };
  readonly scenarios: readonly ScenarioResult[];
  readonly summary: RunSummary;
}

export function emptyResults(scenarios: readonly EvalScenario[]): ScenarioResult[] {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    safety: scenario.safety,
    reps: [],
  }));
}

export function withRep(
  scenarios: readonly ScenarioResult[],
  id: string,
  rep: RepResult,
): ScenarioResult[] {
  const found = scenarios.some((scenario) => scenario.id === id);
  if (!found) throw new Error(`no scenario '${id}' in this run`);
  return scenarios.map((scenario) =>
    scenario.id === id ? { ...scenario, reps: [...scenario.reps, rep] } : scenario,
  );
}

/** A repetition the cap stopped is reported as not run, never as a pass. */
export function notRun(rep: number): RepResult {
  return {
    rep,
    state: "not-run",
    findings: [],
    usage: sumUsage([]),
    trace: null,
  };
}

export function summarise(scenarios: readonly ScenarioResult[]): RunSummary {
  const reps = scenarios.flatMap((scenario) =>
    scenario.reps.map((rep) => ({ safety: scenario.safety, state: rep.state })),
  );
  return {
    passed: reps.filter((rep) => rep.state === "passed").length,
    failed: reps.filter((rep) => rep.state === "failed").length,
    notRun: reps.filter((rep) => rep.state === "not-run").length,
    safetyFailures: reps.filter((rep) => rep.safety && rep.state === "failed").length,
  };
}

export function usageOfResults(scenarios: readonly ScenarioResult[]): Usage {
  return sumUsage(scenarios.flatMap((scenario) => scenario.reps.map((rep) => rep.usage)));
}

export interface RunFacts {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly gitSha: string;
  readonly promptVersion: number;
  readonly models: TraceModels;
  readonly thinking: string;
  readonly budget: Budget;
}

export function buildResults(facts: RunFacts, scenarios: readonly ScenarioResult[]): EvalResults {
  return {
    version: RESULTS_VERSION,
    runId: facts.runId,
    startedAt: facts.startedAt,
    finishedAt: facts.finishedAt,
    gitSha: facts.gitSha,
    promptVersion: facts.promptVersion,
    models: facts.models,
    thinking: facts.thinking,
    cap: {
      maxTokens: facts.budget.maxTokens,
      spent: facts.budget.spent,
      reached: capReached(facts.budget),
    },
    scenarios,
    summary: summarise(scenarios),
  };
}

export function traceFileName(trace: ScenarioTrace): string {
  return `trace-${trace.scenarioId}-${String(trace.rep)}.json`;
}

export function writeTrace(directory: string, trace: ScenarioTrace, key: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, traceFileName(trace));
  writeFileSync(path, keyFreeJson(path, trace, key));
  return path;
}

export function writeResults(directory: string, results: EvalResults, key: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, RESULTS_FILE_NAME);
  writeFileSync(path, keyFreeJson(path, results, key));
  return path;
}

export interface StatusFile {
  readonly path: string;
  set(id: string, patch: Record<string, unknown>, now: string): void;
}

/**
 * The live status a monitor outside the run reads. `adminUrl` names where the turns run: this
 * layer drives the API in process, so there is no admin to point at.
 */
export function openStatus(
  directory: string,
  run: { runId: string; startedAt: string; promptVersion: number; gitSha: string },
  scenarios: readonly EvalScenario[],
): StatusFile {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, STATUS_FILE_NAME);
  let status = createStatus({
    runId: run.runId,
    startedAt: run.startedAt,
    stack: {
      adminUrl: "in-process",
      promptVersion: String(run.promptVersion),
      headSha: run.gitSha,
    },
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      budget: scenario.messages.length,
    })),
  });
  writeStatus(path, status);
  return {
    path,
    set(id, patch, now) {
      status = withScenario(status, id, patch, now);
      writeStatus(path, status);
    },
  };
}
