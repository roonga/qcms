import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { t } from "../i18n/en.ts";

import type { AssistEvent } from "./assist-stream.ts";
import {
  applyTurnEvent,
  EMPTY_TURN,
  finishTurn,
  runningStep,
  TOOL_STEP_LABELS,
  toolStepLabel,
  turnText,
  type AssistantTurnView,
} from "./assist-turn.ts";

function fold(events: readonly AssistEvent[]): AssistantTurnView {
  return events.reduce(applyTurnEvent, EMPTY_TURN);
}

const API_TOOLS = fileURLToPath(
  new URL("../../../api/src/features/forms/assist/tools.ts", import.meta.url),
);

/** The API's `ASSIST_TOOL_NAMES`, read as text (R2: no value import across the app boundary). */
function apiToolNames(): string[] {
  const source = readFileSync(API_TOOLS, "utf8");
  const start = source.indexOf("export const ASSIST_TOOL_NAMES = [");
  expect(start, "the API no longer declares ASSIST_TOOL_NAMES as an array").toBeGreaterThan(-1);
  const body = source.slice(source.indexOf("[", start) + 1, source.indexOf("]", start));
  return [...body.matchAll(/"([a-z_]+)"/gu)].map((match) => match[1] ?? "");
}

describe("the assistant turn timeline", () => {
  it("has a plain-language label for exactly the API's tools", () => {
    expect(Object.keys(TOOL_STEP_LABELS).sort()).toEqual(apiToolNames().sort());
    const labels = Object.values(TOOL_STEP_LABELS).map((key) => t(key));
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).not.toMatch(/_/u);
  });

  it("names an unknown tool generically, never by its identifier", () => {
    expect(t(toolStepLabel("publish_form"))).toBe(t("forms.assist.step.other"));
    expect(t(toolStepLabel(undefined))).not.toContain("publish_form");
  });

  it("marks a step done when the next status arrives, and keeps arrival order", () => {
    const turn = fold([
      { type: "status", phase: "thinking" },
      { type: "text", delta: "I will search " },
      { type: "text", delta: "first." },
      { type: "status", phase: "tool", tool: "search_question_library" },
      { type: "status", phase: "thinking" },
      { type: "status", phase: "tool", tool: "propose_draft" },
    ]);
    expect(turn.segments).toEqual([
      { kind: "text", text: "I will search first." },
      {
        kind: "steps",
        steps: [
          { label: "forms.assist.step.search_question_library", state: "done" },
          { label: "forms.assist.step.propose_draft", state: "running" },
        ],
      },
    ]);
    expect(runningStep(turn)?.label).toBe("forms.assist.step.propose_draft");
  });

  it("interleaves prose after steps as its own segment, and finishes every step at the end", () => {
    const turn = finishTurn(
      fold([
        { type: "status", phase: "tool", tool: "validate_draft" },
        { type: "text", delta: "Done." },
      ]),
    );
    expect(turn.segments.map((segment) => segment.kind)).toEqual(["steps", "text"]);
    expect(runningStep(turn)).toBeUndefined();
    expect(turnText(turn)).toBe("Done.");
  });

  it("ignores events with nothing to show", () => {
    const turn = fold([
      { type: "usage", inputTokens: 1, outputTokens: 2, steps: 1 },
      { type: "text", delta: "" },
    ]);
    expect(turn).toEqual(EMPTY_TURN);
  });
});
