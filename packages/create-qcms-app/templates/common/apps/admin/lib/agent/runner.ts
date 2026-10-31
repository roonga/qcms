import type { AgentPlanStep, AgentProposal } from "../forms/assist-stream.ts";
import { t } from "../i18n/en.ts";

import {
  isExpired,
  settleStep,
  startStep,
  type AgentCardView,
  type AgentStepResult,
} from "./plan-state.ts";

/**
 * The sequential runner (083 D0, section 6.4).
 *
 * Client-driven on purpose: each step calls **that step's screen's own exported server
 * action**, with the step's arguments and one trailing `{ agentProposal, step }` that the
 * action forwards as the two headers. There is no server-side plan executor, so every
 * step keeps the screen's own `requireAdminSession()`, origin check, route,
 * authorisation and revalidation (R2).
 *
 * The runner waits for each result, stops at the first failure, never retries, and sends
 * no further step once a step is held for a second approver or Stop has been pressed.
 */

/** What the card hands one step's screen action. */
export interface RunStepRequest {
  readonly step: AgentPlanStep;
  readonly index: number;
  /** The step's arguments with every reference resolved from an earlier step's result. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Absent for a hand-off step, which carries no token. */
  readonly agentProposal: string | undefined;
}

export type RunStep = (request: RunStepRequest) => Promise<AgentStepResult>;

export interface RunPlanInput {
  readonly proposal: AgentProposal;
  readonly card: AgentCardView;
  readonly runStep: RunStep;
  /** Opens the screen's own control for a hand-off step; the user types the secret there. */
  readonly onHandOff?: (step: AgentPlanStep, index: number) => void;
  /** Called after every state change, so the card re-renders as the run proceeds. */
  readonly onChange?: (card: AgentCardView) => void;
  readonly now: () => Date;
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

export async function runPlan(input: RunPlanInput): Promise<AgentCardView> {
  let card = input.card;
  const emit = (next: AgentCardView): AgentCardView => {
    card = next;
    input.onChange?.(card);
    return card;
  };

  for (const [index, step] of input.proposal.steps.entries()) {
    if (card.state !== "running") break;
    if (card.steps[index]?.state !== "proposed" && card.steps[index]?.state !== "running") break;

    if (step.handOff) {
      // The one step that carries no token: it opens the screen's own control and the user
      // completes it there, so the runner sends nothing and waits.
      emit(startStep(card, index));
      input.onHandOff?.(step, index);
      return card;
    }

    emit(startStep(card, index));
    const args = resolveArgs(step, card);
    const at = input.now();

    if (hasUnresolvedReference(args)) {
      emit(
        settleStep(
          card,
          index,
          step,
          { outcome: "failed", message: t(UNRESOLVED_REFERENCE) },
          at.toISOString(),
        ),
      );
      return card;
    }
    if (isExpired(input.proposal, at.getTime()) && index === 0) {
      emit(
        settleStep(card, index, step, { outcome: "failed", message: t(STALE) }, at.toISOString()),
      );
      return card;
    }

    let result: AgentStepResult;
    try {
      result = await input.runStep({
        step,
        index,
        args,
        agentProposal: input.proposal.token,
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
