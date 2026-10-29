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

function fold(
  events: readonly AssistEvent[],
  from: AssistantTurnView = EMPTY_TURN,
  more: readonly AssistEvent[] = [],
): AssistantTurnView {
  return [...events, ...more].reduce(applyTurnEvent, from);
}

/** Every step's state, in order. */
function states(turn: AssistantTurnView): string[] {
  return turn.segments.flatMap((segment) =>
    segment.kind === "steps" ? segment.steps.map((step) => step.state) : [],
  );
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

  it("marks a step done only on its own outcome, never because the next status arrived", () => {
    const turn = fold([
      { type: "status", phase: "thinking" },
      { type: "text", delta: "I will search " },
      { type: "text", delta: "first." },
      { type: "status", phase: "tool", tool: "search_question_library", step: 1 },
      { type: "status", phase: "thinking" },
      { type: "status", phase: "tool", tool: "propose_draft", step: 2 },
    ]);
    expect(turn.segments).toEqual([
      { kind: "text", text: "I will search first." },
      {
        kind: "steps",
        steps: [
          { label: "forms.assist.step.search_question_library", state: "running", step: 1 },
          { label: "forms.assist.step.propose_draft", state: "running", step: 2 },
        ],
      },
    ]);
    const settled = fold([], turn, [{ type: "tool-outcome", step: 1, outcome: "done" }]);
    expect(states(settled)).toEqual(["done", "running"]);
    expect(runningStep(settled)?.label).toBe("forms.assist.step.propose_draft");
  });

  it("settles a normal successful sequence as done", () => {
    const turn = finishTurn(
      fold([
        { type: "status", phase: "tool", tool: "search_question_library", step: 1 },
        { type: "tool-outcome", step: 1, outcome: "done" },
        { type: "status", phase: "tool", tool: "propose_draft", step: 2 },
        { type: "tool-outcome", step: 2, outcome: "done" },
        { type: "status", phase: "tool", tool: "validate_draft", step: 3 },
        { type: "tool-outcome", step: 3, outcome: "done" },
        { type: "text", delta: "Done." },
      ]),
    );
    expect(states(turn)).toEqual(["done", "done", "done"]);
    expect(turn.segments.map((segment) => segment.kind)).toEqual(["steps", "text"]);
    expect(runningStep(turn)).toBeUndefined();
    expect(turnText(turn)).toBe("Done.");
  });

  it("keeps a failed call failed when the model retries on a new step", () => {
    const turn = finishTurn(
      fold([
        { type: "status", phase: "tool", tool: "propose_draft", step: 1 },
        { type: "tool-outcome", step: 1, outcome: "failed" },
        { type: "status", phase: "thinking" },
        { type: "status", phase: "tool", tool: "propose_draft", step: 2 },
        { type: "tool-outcome", step: 2, outcome: "done" },
      ]),
    );
    expect(states(turn)).toEqual(["failed", "done"]);
  });

  it("marks a step interrupted, not done, when a terminal error ends the turn", () => {
    const turn = finishTurn(
      fold([
        { type: "status", phase: "tool", tool: "validate_draft", step: 1 },
        { type: "error", code: "PROVIDER_ERROR", message: "unavailable" },
      ]),
    );
    expect(states(turn)).toEqual(["interrupted"]);
  });

  it("marks a step interrupted when the stream simply stops, with no outcome", () => {
    // A dropped connection or a read failure ends the fold exactly here.
    const turn = finishTurn(
      fold([{ type: "status", phase: "tool", tool: "propose_draft", step: 1 }]),
    );
    expect(states(turn)).toEqual(["interrupted"]);
  });

  it("cannot settle a step that carries no ordinal, so it ends interrupted", () => {
    const turn = finishTurn(
      fold([
        { type: "status", phase: "tool", tool: "propose_draft" },
        { type: "tool-outcome", step: 1, outcome: "done" },
      ]),
    );
    expect(states(turn)).toEqual(["interrupted"]);
  });

  it("does not let an outcome reopen or overwrite a settled step", () => {
    const turn = fold([
      { type: "status", phase: "tool", tool: "propose_draft", step: 1 },
      { type: "tool-outcome", step: 1, outcome: "failed" },
      { type: "tool-outcome", step: 1, outcome: "done" },
    ]);
    expect(states(turn)).toEqual(["failed"]);
  });

  it("ignores events with nothing to show", () => {
    const turn = fold([
      { type: "usage", inputTokens: 1, outputTokens: 2, steps: 1 },
      { type: "text", delta: "" },
      { type: "status", phase: "thinking" },
    ]);
    expect(turn).toEqual(EMPTY_TURN);
  });
});

describe("the segment column", () => {
  function shape(turn: AssistantTurnView): string[] {
    return turn.segments.map((segment) =>
      segment.kind === "text" ? `text:${segment.id ?? "?"}:${segment.text}` : "steps",
    );
  }

  it("joins deltas that share a segment id and splits where it changes", () => {
    const turn = fold([
      { type: "text", delta: "Look", segment: "t0" },
      { type: "text", delta: "ing up", segment: "t0" },
      { type: "status", phase: "tool", tool: "search_question_library", step: 1 },
      { type: "tool-outcome", step: 1, outcome: "done" },
      { type: "text", delta: "Found it", segment: "t1" },
    ]);
    expect(shape(turn)).toEqual(["text:t0:Looking up", "steps", "text:t1:Found it"]);
  });

  it("starts a new segment when a provider reuses an id after a step", () => {
    const turn = fold([
      { type: "text", delta: "Searching", segment: "t0" },
      { type: "status", phase: "tool", tool: "search_question_library", step: 1 },
      { type: "text", delta: "Drafting", segment: "t0" },
    ]);
    expect(shape(turn)).toEqual(["text:t0:Searching", "steps", "text:t0:Drafting"]);
  });

  it("folds deltas with no id into one segment, as a stream without them always did", () => {
    const turn = fold([
      { type: "text", delta: "one " },
      { type: "text", delta: "block" },
    ]);
    expect(shape(turn)).toEqual(["text:?:one block"]);
    expect(turnText(turn)).toBe("one block");
  });

  it("keeps the thinking disclosure in arrival order, as its own segment", () => {
    const turn = [
      { type: "reasoning", delta: "first thought" } as const,
      { type: "reasoning-end" } as const,
      { type: "status", phase: "tool", tool: "propose_draft", step: 1 } as const,
      { type: "reasoning", delta: "second thought" } as const,
      { type: "text", delta: "Done.", segment: "t1" } as const,
    ].reduce<AssistantTurnView>((view, event) => applyTurnEvent(view, event, 1_000), EMPTY_TURN);

    expect(turn.segments.map((segment) => segment.kind)).toEqual([
      "thinking",
      "steps",
      "thinking",
      "text",
    ]);
  });

  it("keeps every segment in the history the API is sent", () => {
    const turn = fold([
      { type: "text", delta: "First. ", segment: "t0" },
      { type: "status", phase: "tool", tool: "propose_draft", step: 1 },
      { type: "text", delta: "Second.", segment: "t1" },
    ]);
    expect(turnText(turn)).toBe("First. Second.");
  });
});

describe("the thinking segment", () => {
  function thinkingOf(turn: AssistantTurnView) {
    return turn.segments.flatMap((segment) => (segment.kind === "thinking" ? [segment] : []));
  }

  it("joins deltas while the summary is still open and reports no duration", () => {
    const turn = [
      { type: "reasoning", delta: "weighing " } as const,
      { type: "reasoning", delta: "it up" } as const,
    ].reduce<AssistantTurnView>((view, event) => applyTurnEvent(view, event, 1_000), EMPTY_TURN);

    expect(thinkingOf(turn)).toEqual([
      { kind: "thinking", text: "weighing it up", startedAt: 1_000, endedAt: undefined },
    ]);
  });

  it("settles on reasoning-end, so a duration can be computed", () => {
    let turn = applyTurnEvent(EMPTY_TURN, { type: "reasoning", delta: "hmm" }, 1_000);
    turn = applyTurnEvent(turn, { type: "reasoning-end" }, 4_400);
    expect(thinkingOf(turn)[0]).toMatchObject({ startedAt: 1_000, endedAt: 4_400 });
  });

  it("settles an unclosed summary when the turn ends, rather than thinking for ever", () => {
    // An open disclosure still reports a (slightly short) duration instead of running forever.
    const open = applyTurnEvent(EMPTY_TURN, { type: "reasoning", delta: "hmm" }, 1_000);
    const finished = finishTurn(open, 2_500);
    expect(thinkingOf(finished)[0]).toMatchObject({ endedAt: 2_500 });
  });

  /** SEC-8, from the admin's side: reasoning never joins the replayed history. */
  it("keeps reasoning out of the text the API is sent back", () => {
    const turn = [
      { type: "reasoning", delta: "SENTINEL" } as const,
      { type: "reasoning-end" } as const,
      { type: "text", delta: "Here is the draft.", segment: "t0" } as const,
    ].reduce<AssistantTurnView>((view, event) => applyTurnEvent(view, event, 1_000), EMPTY_TURN);

    expect(turnText(turn)).toBe("Here is the draft.");
    expect(turnText(turn)).not.toContain("SENTINEL");
  });
});
