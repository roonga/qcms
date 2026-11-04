import type { AgentPlanStep, AgentProposal } from "../forms/assist-stream.ts";
import { t } from "../i18n/en.ts";

import { settleStep, startStep, type AgentCardView, type AgentStepResult } from "./plan-state.ts";

/** Run client steps through their ordinary screen actions so each retains its own authorization. Stop on failure or approval hold; never retry implicitly. */

export interface RunStepRequest {
  readonly step: AgentPlanStep;
  readonly index: number;

  readonly args: Readonly<Record<string, unknown>>;

  readonly agentProposal: string | undefined;
  /** Token indices exclude local and hand-off steps, so they can differ from card indices. */
  readonly tokenStep: number;

  readonly currentEnvironment: string;
}

export type RunStep = (request: RunStepRequest) => Promise<AgentStepResult>;

export interface RunPlanInput {
  readonly proposal: AgentProposal;
  readonly card: AgentCardView;
  readonly runStep: RunStep;

  readonly onHandOff?: (
    step: AgentPlanStep,
    index: number,
    args: Readonly<Record<string, unknown>>,
  ) => void;

  readonly onChange?: (card: AgentCardView) => void;
  readonly now: () => Date;
  /** Check the monotonic waiting window before sending step zero; the API separately checks token expiry. */
  readonly windowLeftMs: () => number;
}

function isReference(value: unknown): value is { fromStep: number; field: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    typeof candidate.fromStep === "number" &&
    typeof candidate.field === "string"
  );
}

/** Resolve references from actual earlier results; the API must still compare them with recorded detail before authorizing. */
export function resolveArgs(
  step: AgentPlanStep,
  card: AgentCardView,
): Readonly<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(step.args)) {
    if (!isReference(value)) {
      resolved[name] = value;
      continue;
    }
    resolved[name] = card.steps[value.fromStep]?.result?.[value.field];
  }
  return resolved;
}

export function hasUnresolvedReference(args: Readonly<Record<string, unknown>>): boolean {
  return Object.values(args).some((value) => value === undefined);
}

function carriesToken(step: AgentPlanStep): boolean {
  return !step.handOff && !step.local;
}

function stillPending(card: AgentCardView, index: number): boolean {
  const state = card.steps[index]?.state;
  return card.state === "running" && (state === "proposed" || state === "running");
}

function unsendable(
  input: RunPlanInput,
  args: Readonly<Record<string, unknown>>,
  index: number,
): string | undefined {
  if (hasUnresolvedReference(args)) return t(UNRESOLVED_REFERENCE);
  if (index === 0 && input.windowLeftMs() <= 0) return t(STALE);
  return undefined;
}

export async function runPlan(input: RunPlanInput): Promise<AgentCardView> {
  let card = input.card;
  let tokenStep = 0;
  const emit = (next: AgentCardView): AgentCardView => {
    card = next;
    input.onChange?.(card);
    return card;
  };

  for (const [index, step] of input.proposal.steps.entries()) {
    if (!stillPending(card, index)) break;

    if (step.handOff) {
      emit(startStep(card, index));
      input.onHandOff?.(step, index, resolveArgs(step, card));
      return card;
    }

    const bound = tokenStep;
    if (carriesToken(step)) tokenStep += 1;

    emit(startStep(card, index));
    const args = resolveArgs(step, card);
    const at = input.now();

    const refusal = unsendable(input, args, index);
    if (refusal !== undefined) {
      emit(
        settleStep(card, index, step, { outcome: "failed", message: refusal }, at.toISOString()),
      );
      return card;
    }

    let result: AgentStepResult;
    try {
      result = await input.runStep({
        step,
        index,
        args,
        agentProposal: carriesToken(step) ? input.proposal.token : undefined,
        tokenStep: bound,
        currentEnvironment: input.proposal.currentEnvironment,
      });
    } catch {
      result = { outcome: "failed", message: t(UNREACHABLE) };
    }
    emit(settleStep(card, index, step, result, input.now().toISOString()));
  }
  return card;
}

const UNRESOLVED_REFERENCE = "agent.card.note.unresolvedReference" as const;
const UNREACHABLE = "agent.card.note.unreachable" as const;
const STALE = "agent.card.note.stale" as const;
