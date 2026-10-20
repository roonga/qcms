import type { MessageKey } from "../i18n/en.ts";

import type { AssistEvent } from "./assist-stream.ts";

/**
 * One assistant turn as the panel shows it: prose and tool steps, interleaved in the
 * order they arrived.
 *
 * The wire carries `text` deltas, `status` events and `tool-outcome` events. Folding
 * them here, rather than in the component, keeps the timeline rules in one testable
 * place.
 *
 * ## A step is done only on evidence
 *
 * A `tool` status opens a running step under the ordinal the API gave it, and only the
 * `tool-outcome` naming that ordinal settles it: `done` when the call worked, `failed`
 * when it did not. Nothing else is read as success - not a later status (a model calls
 * the next tool after a failed one as readily as after a good one), and not the end of
 * the stream. A step still running when the turn ends, however it ends (a terminal
 * error, a dropped connection, a read failure, or an API that sent no outcome), is
 * `interrupted`: the panel says it did not finish rather than guessing.
 *
 * The tool's identifier never reaches the screen; it is mapped to a plain-language
 * catalog label, and a name this build does not know reads as a generic step.
 */

export type StepState = "running" | "done" | "failed" | "interrupted";

export interface TurnStep {
  readonly label: MessageKey;
  readonly state: StepState;
  /** The API's per-turn ordinal, which a `tool-outcome` names. */
  readonly step: number | undefined;
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

function mapSteps(
  turn: AssistantTurnView,
  update: (step: TurnStep) => TurnStep,
): AssistantTurnView {
  let changed = false;
  const segments = turn.segments.map((segment): TurnSegment => {
    if (segment.kind !== "steps") return segment;
    const steps = segment.steps.map((step) => {
      const next = update(step);
      if (next !== step) changed = true;
      return next;
    });
    return { kind: "steps", steps };
  });
  return changed ? { segments } : turn;
}

function appendText(turn: AssistantTurnView, delta: string): AssistantTurnView {
  if (delta === "") return turn;
  const last = turn.segments.at(-1);
  if (last?.kind === "text") {
    return { segments: [...turn.segments.slice(0, -1), { kind: "text", text: last.text + delta }] };
  }
  return { segments: [...turn.segments, { kind: "text", text: delta }] };
}

function appendStep(turn: AssistantTurnView, step: TurnStep): AssistantTurnView {
  const last = turn.segments.at(-1);
  if (last?.kind === "steps") {
    return {
      segments: [...turn.segments.slice(0, -1), { kind: "steps", steps: [...last.steps, step] }],
    };
  }
  return { segments: [...turn.segments, { kind: "steps", steps: [step] }] };
}

/** Apply one stream event to the turn. Events that carry nothing visible return it unchanged. */
export function applyTurnEvent(turn: AssistantTurnView, event: AssistEvent): AssistantTurnView {
  switch (event.type) {
    case "text":
      return appendText(turn, event.delta);
    case "status":
      return event.phase === "tool"
        ? appendStep(turn, { label: toolStepLabel(event.tool), state: "running", step: event.step })
        : turn;
    case "tool-outcome":
      return mapSteps(turn, (step) =>
        step.step === event.step && step.state === "running"
          ? { ...step, state: event.outcome }
          : step,
      );
    default:
      return turn;
  }
}

/**
 * The turn once its stream has ended, for whatever reason. Settled steps keep their
 * outcome; a step with no outcome is `interrupted`, never `done`.
 */
export function finishTurn(turn: AssistantTurnView): AssistantTurnView {
  return mapSteps(turn, (step) =>
    step.state === "running" ? { ...step, state: "interrupted" } : step,
  );
}

/** Every prose segment, joined: what the turn said, for the conversation history. */
export function turnText(turn: AssistantTurnView): string {
  return turn.segments
    .flatMap((segment) => (segment.kind === "text" ? [segment.text] : []))
    .join("");
}

/** The most recently started step still running, if any: what the status line names. */
export function runningStep(turn: AssistantTurnView): TurnStep | undefined {
  const steps = turn.segments.flatMap((segment) => (segment.kind === "steps" ? segment.steps : []));
  return steps.findLast((step) => step.state === "running");
}
