import type { MessageKey } from "../i18n/en.ts";

import type { AssistEvent } from "./assist-stream.ts";

// Only the matching tool-outcome settles a step; later tools, prose and proposals are not success evidence.
// Map tool ids to catalog labels rather than exposing internal names.

export type StepState = "running" | "done" | "failed" | "interrupted";

export interface TurnStep {
  readonly label: MessageKey;
  readonly state: StepState;

  readonly step: number | undefined;
}

export type TurnSegment =
  | { readonly kind: "text"; readonly id: string | undefined; readonly text: string }
  | { readonly kind: "steps"; readonly steps: readonly TurnStep[] }
  | {
      readonly kind: "thinking";
      readonly text: string;
      readonly startedAt: number;
      readonly endedAt: number | undefined;
    };

export interface AssistantTurnView {
  readonly segments: readonly TurnSegment[];
}

export const TOOL_STEP_LABELS: Readonly<Record<string, MessageKey>> = {
  search_question_library: "forms.assist.step.search_question_library",
  propose_questions: "forms.assist.step.propose_questions",
  propose_draft: "forms.assist.step.propose_draft",
  validate_draft: "forms.assist.step.validate_draft",
  project_draft: "forms.assist.step.project_draft",
  test_rule: "forms.assist.step.test_rule",
  diff_form_versions: "forms.assist.step.diff_form_versions",
  count_links: "forms.assist.step.count_links",
  list_responses: "forms.assist.step.list_responses",
  count_responses: "forms.assist.step.count_responses",
  delivery_status: "forms.assist.step.delivery_status",
  count_dead_letters: "forms.assist.step.count_dead_letters",
  diff_question_versions: "forms.assist.step.diff_question_versions",
  search_forms: "forms.assist.step.search_forms",
  propose_action: "forms.assist.step.propose_action",
  propose_plan: "forms.assist.step.propose_plan",
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

function appendText(
  turn: AssistantTurnView,
  delta: string,
  id: string | undefined,
): AssistantTurnView {
  if (delta === "") return turn;
  const last = turn.segments.at(-1);
  if (last?.kind === "text" && last.id === id) {
    return {
      segments: [...turn.segments.slice(0, -1), { kind: "text", id, text: last.text + delta }],
    };
  }
  return { segments: [...turn.segments, { kind: "text", id, text: delta }] };
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

function appendThinking(turn: AssistantTurnView, delta: string, now: number): AssistantTurnView {
  if (delta === "") return turn;
  const last = turn.segments.at(-1);
  if (last?.kind === "thinking" && last.endedAt === undefined) {
    return {
      segments: [...turn.segments.slice(0, -1), { ...last, text: last.text + delta }],
    };
  }
  return {
    segments: [
      ...turn.segments,
      { kind: "thinking", text: delta, startedAt: now, endedAt: undefined },
    ],
  };
}

function endThinking(turn: AssistantTurnView, now: number): AssistantTurnView {
  let changed = false;
  const segments = turn.segments.map((segment): TurnSegment => {
    if (segment.kind !== "thinking" || segment.endedAt !== undefined) return segment;
    changed = true;
    return { ...segment, endedAt: now };
  });
  return changed ? { segments } : turn;
}

export function applyTurnEvent(
  turn: AssistantTurnView,
  event: AssistEvent,
  now: number = Date.now(),
): AssistantTurnView {
  switch (event.type) {
    case "text":
      return appendText(turn, event.delta, event.segment);
    case "reasoning":
      return appendThinking(turn, event.delta, now);
    case "reasoning-end":
      return endThinking(turn, now);
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

// An unfinished step is interrupted, never completed; close any unfinished reasoning segment.
export function finishTurn(turn: AssistantTurnView, now: number = Date.now()): AssistantTurnView {
  return endThinking(
    mapSteps(turn, (step) => (step.state === "running" ? { ...step, state: "interrupted" } : step)),
    now,
  );
}

export function turnText(turn: AssistantTurnView): string {
  return turn.segments
    .flatMap((segment) => (segment.kind === "text" ? [segment.text] : []))
    .join("");
}

export function lastTextSegment(turn: AssistantTurnView): string {
  return turn.segments.findLast((segment) => segment.kind === "text")?.text ?? "";
}

export function runningStep(turn: AssistantTurnView): TurnStep | undefined {
  const steps = turn.segments.flatMap((segment) => (segment.kind === "steps" ? segment.steps : []));
  return steps.findLast((step) => step.state === "running");
}
