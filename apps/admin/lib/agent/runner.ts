import type { AgentPlanStep, AgentProposal } from "../forms/assist-stream.ts";
import { t } from "../i18n/en.ts";

import { settleStep, startStep, type AgentCardView, type AgentStepResult } from "./plan-state.ts";

/**
 * The sequential runner. Client-driven so that each step goes through its own screen's
 * server action rather than a server-side plan executor (R2): it waits for each result,
 * stops at the first failure, never retries, and sends no further step once one is held
 * for a second approver or Stop has been pressed.
 */

/** What the card hands one step's screen action. */
export interface RunStepRequest {
  readonly step: AgentPlanStep;
  readonly index: number;
  /** The step's arguments with every reference resolved from an earlier step's result. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Absent for a hand-off or a local step, which carry no token. */
  readonly agentProposal: string | undefined;
  /**
   * This step's index in the token rather than in the card. The two differ once a plan
   * holds a step that reaches no route, because the token binds only the steps that do.
   */
  readonly tokenStep: number;
  /** The selection the turn ran under, which a screen action confirms its tab against. */
  readonly currentEnvironment: string;
}

export type RunStep = (request: RunStepRequest) => Promise<AgentStepResult>;

export interface RunPlanInput {
  readonly proposal: AgentProposal;
  readonly card: AgentCardView;
  readonly runStep: RunStep;
  /** Opens the screen's own control for a hand-off step; the user types the secret there. */
  readonly onHandOff?: (
    step: AgentPlanStep,
    index: number,
    args: Readonly<Record<string, unknown>>,
  ) => void;
  /** Called after every state change, so the card re-renders as the run proceeds. */
  readonly onChange?: (card: AgentCardView) => void;
  readonly now: () => Date;
  /**
   * What is left of the card's waiting window, on the monotonic clock it was counted on.
   * Step 0 is not sent once it reaches zero, which is the same bound the API enforces on
   * the token.
   */
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

/**
 * The step's arguments as they will run: a `{ fromStep, field }` reference is replaced by
 * the value that step actually reported, so the user sees the real value run and the API
 * compares it with the `detail` it recorded for that step. Resolving it here without the
 * server's check would lose the property; the server check is the point.
 */
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

/** Whether a step still names a reference nothing resolved, which cannot be sent. */
export function hasUnresolvedReference(args: Readonly<Record<string, unknown>>): boolean {
  return Object.values(args).some((value) => value === undefined);
}

/** Whether this step reaches a route of its own, which is what the token binds. */
function carriesToken(step: AgentPlanStep): boolean {
  return !step.handOff && !step.local;
}

/** Whether the runner may still send this step, or the card has moved past it. */
function stillPending(card: AgentCardView, index: number): boolean {
  const state = card.steps[index]?.state;
  return card.state === "running" && (state === "proposed" || state === "running");
}

/**
 * The reason this step cannot be sent at all, if there is one: a reference nothing
 * resolved, or a card already stale when Confirm reached its first step.
 */
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
      // It opens the screen's own control and the user completes it there, so the runner
      // sends nothing and waits.
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
      // A network error is a failure like any other: the plan stops and nothing is retried.
      result = { outcome: "failed", message: t(UNREACHABLE) };
    }
    emit(settleStep(card, index, step, result, input.now().toISOString()));
  }
  return card;
}

/**
 * The runner's own three failures. A step's `message` is normally the screen action's own
 * sentence, so these come from the catalog in the same shape rather than as literals
 * here (ADR-27).
 */
const UNRESOLVED_REFERENCE = "agent.card.note.unresolvedReference" as const;
const UNREACHABLE = "agent.card.note.unreachable" as const;
const STALE = "agent.card.note.stale" as const;
