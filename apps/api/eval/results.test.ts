import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_TEXT, validateStatus } from "../../../scripts/agent-review/eval-status.mjs";
import { NO_USAGE, charge, newBudget } from "./budget.js";
import {
  RESULTS_FILE_NAME,
  buildResults,
  emptyResults,
  notRun,
  openStatus,
  repState,
  statusNote,
  summarise,
  usageOfResults,
  withRep,
  writeResults,
  writeTrace,
} from "./results.js";
import type { EvalScenario } from "./scenarios.js";

const CLI = fileURLToPath(new URL("../../../scripts/agent-eval.mjs", import.meta.url));

const RUN = {
  runId: "r1",
  startedAt: "2026-07-20T00:00:00.000Z",
  promptVersion: 38,
  gitSha: "0".repeat(40),
};

const KEY = "synthetic-eval-key-6f21";

const SCENARIOS: EvalScenario[] = [
  {
    id: "S00",
    title: "Smoke",
    safety: false,
    screen: "/forms/[formId]/build",
    caller: { grants: ["forms.editor"], owner: false },
    messages: ["how many steps"],
    assistantMust: [],
  },
  {
    id: "B09",
    title: "Refusals",
    safety: true,
    screen: "/forms/[formId]/build",
    caller: { grants: ["forms.editor"], owner: false },
    messages: ["publish this"],
    assistantMust: [],
  },
];

const USAGE = { inputTokens: 400, outputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0 };

function directory(): string {
  return mkdtempSync(join(tmpdir(), "qcms-eval-results-"));
}

describe("what a run reports", () => {
  it("counts a repetition the cap stopped as not run, never as a pass", () => {
    let results = emptyResults(SCENARIOS);
    results = withRep(results, "S00", {
      rep: 1,
      state: "passed",
      findings: [],
      usage: USAGE,
      trace: "trace-S00-1.json",
    });
    results = withRep(results, "S00", notRun(2));
    results = withRep(results, "B09", {
      rep: 1,
      state: "failed",
      findings: [],
      usage: USAGE,
      trace: "trace-B09-1.json",
    });

    expect(summarise(results)).toEqual({
      passed: 1,
      failed: 1,
      notRun: 1,
      safetyFailures: 1,
    });
    expect(notRun(2).usage).toEqual(NO_USAGE);
    expect(usageOfResults(results)).toEqual({
      inputTokens: 800,
      outputTokens: 200,
      cacheReadTokens: 1800,
      cacheWriteTokens: 0,
    });
  });

  it("calls a repetition the cap cut short not run, never passed", () => {
    expect(repState(false, 0)).toBe("not-run");
    expect(repState(true, 0)).toBe("passed");
    expect(repState(true, 2)).toBe("failed");
  });

  it("refuses a repetition for a scenario this run never selected", () => {
    expect(() => withRep(emptyResults(SCENARIOS), "B11", notRun(1))).toThrow("B11");
  });

  it("says on the result whether the cap was reached", () => {
    const facts = {
      runId: "r1",
      startedAt: "2026-07-20T00:00:00.000Z",
      finishedAt: "2026-07-20T00:10:00.000Z",
      gitSha: "0".repeat(40),
      promptVersion: 38,
      models: { requested: "m", reported: null, grader: "g" },
      thinking: "off",
      budget: charge(newBudget(500), USAGE),
    };

    expect(buildResults(facts, emptyResults(SCENARIOS)).cap).toEqual({
      maxTokens: 500,
      spent: USAGE,
      reached: true,
    });
  });
});

describe("the files a run leaves behind", () => {
  it("reads a result for the key before it reaches the disk", () => {
    const facts = {
      runId: KEY,
      startedAt: "2026-07-20T00:00:00.000Z",
      finishedAt: "2026-07-20T00:10:00.000Z",
      gitSha: "0".repeat(40),
      promptVersion: 38,
      models: { requested: "m", reported: null, grader: "g" },
      thinking: "off",
      budget: newBudget(500),
    };

    expect(() => writeResults(directory(), buildResults(facts, []), KEY)).toThrow(
      "QCMS_AGENT_API_KEY",
    );
  });

  it("writes one trace per scenario and repetition", () => {
    const where = directory();
    const path = writeTrace(
      where,
      {
        version: 1,
        runId: "r1",
        scenarioId: "S00",
        rep: 2,
        safety: false,
        models: { requested: "m", reported: null, grader: "g" },
        thinking: "off",
        promptVersion: 38,
        gitSha: "0".repeat(40),
        startedAt: "2026-07-20T00:00:00.000Z",
        finishedAt: "2026-07-20T00:00:10.000Z",
        turns: [],
      },
      KEY,
    );

    expect(path).toBe(join(where, "trace-S00-2.json"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ scenarioId: "S00", rep: 2 });
  });

  it("keeps a live status file in the shape a monitor reads", () => {
    const status = openStatus(directory(), RUN, SCENARIOS, KEY);
    status.set("S00", { state: "checked", turns: 1 }, "2026-07-20T00:01:00.000Z");

    const written: unknown = JSON.parse(readFileSync(status.path, "utf8"));

    expect(validateStatus(written)).toEqual([]);
    expect(written).toMatchObject({
      scenarios: [
        { id: "S00", state: "checked", turns: 1 },
        { id: "B09", state: "queued" },
      ],
    });
  });

  it("reads the status for the key, on the first write and on every update", () => {
    expect(() => openStatus(directory(), { ...RUN, runId: KEY }, SCENARIOS, KEY)).toThrow(
      "QCMS_AGENT_API_KEY",
    );

    const status = openStatus(directory(), RUN, SCENARIOS, KEY);

    expect(() =>
      status.set("S00", { state: "checked", note: `saw ${KEY}` }, "2026-07-20T00:01:00.000Z"),
    ).toThrow("QCMS_AGENT_API_KEY");
  });

  it("names the result file the command line reads the not-run count back from", () => {
    expect(readFileSync(CLI, "utf8")).toContain(`RESULTS_FILE_NAME = "${RESULTS_FILE_NAME}"`);
  });
});

describe("the line a thrown message becomes in the status file", () => {
  it("flattens it and drops the address the status file holds none of", () => {
    expect(statusNote("the assist turn\n  answered 500 at https://assist.test/x")).toBe(
      "the assist turn answered 500 at https assist.test/x",
    );
  });

  it("cuts one longer than the status file allows", () => {
    const note = statusNote("the assist turn answered 500. ".repeat(40));

    expect(note).toHaveLength(MAX_TEXT);
    expect(note.endsWith("...")).toBe(true);
  });
});
