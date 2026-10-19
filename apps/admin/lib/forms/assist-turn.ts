import type { MessageKey } from "../i18n/en.ts";

import type { AssistEvent } from "./assist-stream.ts";

/**
 * One assistant turn as the panel shows it: prose and tool steps, interleaved in the
 * order they arrived.
 *
 * The wire carries `text` deltas and `status` events. Folding them here, rather than in
 * the component, keeps the timeline rules in one testable place: a `tool` status opens a
 * running step, the next `status` of either phase means the step before it finished, and
 * the end of the turn finishes whatever is still running. The tool's identifier never
 * reaches the screen; it is mapped to a plain-language catalog label, and a name this
 * build does not know reads as a generic step rather than as the raw identifier.
 */

export type StepState = "running" | "done";

export interface TurnStep {
  readonly label: MessageKey;
  readonly state: StepState;
}

export type TurnSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "steps"; readonly steps: readonly TurnStep[] };

export interface AssistantTurnView {
  readonly segments: readonly TurnSegment[];
}

/**
 * The four tool names the API registers (`apps/api/src/features/forms/assist/tools.ts`,
 * `ASSIST_TOOL_NAMES`), each with what a person would call it.
 */
export const TOOL_STEP_LABELS: Readonly<Record<string, MessageKey>> = {
  search_question_library: "forms.assist.step.search_question_library",
  propose_questions: "forms.assist.step.propose_questions",
  propose_draft: "forms.assist.step.propose_draft",
  validate_draft: "forms.assist.step.validate_draft",
};

export function toolStepLabel(tool: string | undefined): MessageKey {
  return (tool === undefined ? undefined : TOOL_STEP_LABELS[tool]) ?? "forms.assist.step.other";
}

export const EMPTY_TURN: AssistantTurnView = { segments: [] };

function finishSteps(steps: readonly TurnStep[]): readonly TurnStep[] {
  return steps.some((step) => step.state === "running")
    ? steps.map((step) => (step.state === "running" ? { ...step, state: "done" } : step))
    : steps;
}

function finishSegments(segments: readonly TurnSegment[]): readonly TurnSegment[] {
  return segments.map((segment) =>
    segment.kind === "steps" ? { kind: "steps", steps: finishSteps(segment.steps) } : segment,
  );
}

/** Apply one stream event to the turn. Events that carry nothing visible return it unchanged. */
export function applyTurnEvent(turn: AssistantTurnView, event: AssistEvent): AssistantTurnView {
  if (event.type === "text") {
    if (event.delta === "") return turn;
    const last = turn.segments.at(-1);
    if (last?.kind === "text") {
      return {
        segments: [...turn.segments.slice(0, -1), { kind: "text", text: last.text + event.delta }],
      };
    }
    return { segments: [...turn.segments, { kind: "text", text: event.delta }] };
  }
  if (event.type === "status") {
    const settled = finishSegments(turn.segments);
    if (event.phase !== "tool") return { segments: settled };
    const step: TurnStep = { label: toolStepLabel(event.tool), state: "running" };
    const last = settled.at(-1);
    if (last?.kind === "steps") {
      return {
        segments: [...settled.slice(0, -1), { kind: "steps", steps: [...last.steps, step] }],
      };
    }
    return { segments: [...settled, { kind: "steps", steps: [step] }] };
  }
  return turn;
}

/** The turn once the stream has ended: nothing is still running. */
export function finishTurn(turn: AssistantTurnView): AssistantTurnView {
  return { segments: finishSegments(turn.segments) };
}

/** Every prose segment, joined: what the turn said, for the conversation history. */
export function turnText(turn: AssistantTurnView): string {
  return turn.segments
    .flatMap((segment) => (segment.kind === "text" ? [segment.text] : []))
    .join("");
}

/** The step currently running, if any: what the status line names. */
export function runningStep(turn: AssistantTurnView): TurnStep | undefined {
  for (const segment of turn.segments) {
    if (segment.kind === "steps") {
      const running = segment.steps.find((step) => step.state === "running");
      if (running !== undefined) return running;
    }
  }
  return undefined;
}
