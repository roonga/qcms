import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseTrace,
  refusedToolCallsOf,
  replyOf,
  reportedModelOf,
  stepsOf,
  stopReasonOf,
  toolCallsOf,
  traceProblems,
  usageOfTrace,
  usageOfTurn,
} from "./trace.js";

const FIXTURE = fileURLToPath(new URL("fixtures/trace-smoke.json", import.meta.url));

function smoke(): unknown {
  return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

function turnOne(): ReturnType<typeof parseTrace>["turns"][number] {
  const [turn] = parseTrace(smoke()).turns;
  if (turn === undefined) throw new Error("the fixture has no turn");
  return turn;
}

describe("the trace a run writes", () => {
  it("reads back the committed fixture", () => {
    expect(traceProblems(smoke())).toEqual([]);
    expect(parseTrace(smoke()).scenarioId).toBe("S00");
  });

  it("names every field a reader is missing", () => {
    const broken = { ...(smoke() as Record<string, unknown>), rep: 0, turns: "none" };

    expect(traceProblems(broken)).toEqual([
      expect.stringContaining("rep"),
      expect.stringContaining("turns"),
    ]);
  });

  it("refuses a trace of another version", () => {
    expect(() => parseTrace({ ...(smoke() as Record<string, unknown>), version: 2 })).toThrow();
  });
});

describe("what the trace settles about a turn", () => {
  it("counts one step per provider call and takes the last stop reason", () => {
    expect(stepsOf(turnOne())).toBe(2);
    expect(stopReasonOf(turnOne())).toBe("stop");
  });

  it("sums the turn's usage with the cache lines kept apart", () => {
    expect(usageOfTurn(turnOne())).toEqual({
      inputTokens: 520,
      outputTokens: 170,
      cacheReadTokens: 900,
      cacheWriteTokens: 900,
    });
    expect(usageOfTrace(parseTrace(smoke()))).toEqual(usageOfTurn(turnOne()));
  });

  it("joins the text deltas into the reply the person read", () => {
    expect(replyOf(turnOne())).toBe("Two steps: About you, and How we reach you.");
  });

  it("reads every tool call with its input and whether that step was offered it", () => {
    expect(toolCallsOf(parseTrace(smoke()))).toEqual([
      { turn: 1, step: 1, name: "read_form", input: { formId: "frm_eval_s00_1" }, offered: true },
      { turn: 1, step: 2, name: "open_publish_wizard", input: {}, offered: false },
    ]);
  });

  it("picks out the call that named a tool it was not offered", () => {
    expect(refusedToolCallsOf(parseTrace(smoke())).map((call) => call.name)).toEqual([
      "open_publish_wizard",
    ]);
  });
});

describe("the model id the provider answered with", () => {
  it("takes the one every call agreed on", () => {
    expect(reportedModelOf(parseTrace(smoke()).turns.flatMap((turn) => [...turn.calls]))).toBe(
      "claude-opus-5-5-20260601",
    );
  });

  it("reports none where there were no calls or the calls disagreed", () => {
    expect(reportedModelOf([])).toBeNull();
  });
});
