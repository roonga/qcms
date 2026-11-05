import type { MessageKey } from "../i18n/en.ts";

import type { AgentPlanStep, AgentProposal } from "../forms/assist-stream.ts";

/** Confirmation, execution and replay decisions must not depend on model prose. */

export type AgentStepState =
  | "proposed"
  | "running"
  | "done"
  | "failed"
  | "pending-approval"
  | "not-run"
  | "cancelled"
  | "expired";

export type AgentCardState =
  "proposed" | "running" | "done" | "stopped" | "pending-approval" | "cancelled" | "expired";

/** Allow scalar results only; arrays and objects can smuggle content through a metadata channel. */
export type ScalarField = string | number | boolean;

export type StepResultFields = Readonly<Record<string, ScalarField>>;

export type ReportedResults = Readonly<Record<number, StepResultFields>>;

export interface AgentStepView {
  readonly state: AgentStepState;

  readonly message?: string;

  readonly result?: StepResultFields;
  /** One-time secrets stay on the card and never enter action-result history. */
  readonly revealed?: string;
}

export interface AgentCardView {
  readonly proposalId: string;
  readonly steps: readonly AgentStepView[];
  readonly state: AgentCardState;

  readonly runningIndex: number | undefined;

  readonly stopping: boolean;

  readonly settledAt: string | undefined;
}

export interface AgentStepResult {
  readonly outcome: "done" | "failed" | "pending-approval";
  readonly message?: string;

  readonly result?: Readonly<Record<string, unknown>>;
  /** A one-time reveal for the card alone, never for the next turn. */
  readonly revealed?: string;
}

const SHARED_CARD_STATES: readonly AgentCardState[] = ["proposed", "cancelled", "expired"];

export function showsStepChips(card: AgentCardView): boolean {
  return !SHARED_CARD_STATES.includes(card.state);
}

/** Count the server duration from browser arrival; absolute timestamps would let clock skew expire a new card. */
export function proposalWindowMs(proposal: AgentProposal): number {
  const issued = Date.parse(proposal.proposedAt);
  const expires = Date.parse(proposal.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return 0;
  return Math.max(0, expires - issued);
}

export function initialCard(proposal: AgentProposal): AgentCardView {
  const expired = proposalWindowMs(proposal) <= 0;
  return {
    proposalId: proposal.proposalId,
    steps: proposal.steps.map(() => ({ state: expired ? "expired" : "proposed" })),
    state: expired ? "expired" : "proposed",
    runningIndex: undefined,
    stopping: false,
    settledAt: undefined,
  };
}

export function canConfirm(card: AgentCardView): boolean {
  return card.state === "proposed";
}

export function showsMarker(card: AgentCardView): boolean {
  return card.state === "proposed";
}

export function firstPendingStep(card: AgentCardView): number | undefined {
  const index = card.steps.findIndex((step) => step.state === "proposed");
  return index < 0 ? undefined : index;
}

function withSteps(
  card: AgentCardView,
  steps: readonly AgentStepView[],
  rest: Partial<AgentCardView>,
): AgentCardView {
  return { ...card, steps, ...rest };
}

function replace(
  steps: readonly AgentStepView[],
  index: number,
  view: AgentStepView,
): AgentStepView[] {
  return steps.map((step, at) => (at === index ? view : step));
}

function strandAfter(steps: readonly AgentStepView[], index: number): AgentStepView[] {
  return steps.map((step, at) =>
    at > index && step.state === "proposed" ? { state: "not-run" } : step,
  );
}

export function startRun(card: AgentCardView): AgentCardView {
  if (card.state !== "proposed") return card;
  return withSteps(card, replace(card.steps, 0, { state: "running" }), {
    state: "running",
    runningIndex: 0,
  });
}

export function startStep(card: AgentCardView, index: number): AgentCardView {
  if (card.state !== "running") return card;
  return withSteps(card, replace(card.steps, index, { state: "running" }), {
    runningIndex: index,
  });
}

function scalarsOnly(
  result: Readonly<Record<string, unknown>> | undefined,
  allowlist: readonly string[],
): StepResultFields | undefined {
  if (result === undefined) return undefined;
  const kept: Record<string, ScalarField> = {};
  for (const field of allowlist) {
    const value = result[field];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      kept[field] = value;
    }
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/** Failure and approval hold are terminal: do not send or retry later steps. */
export function settleStep(
  card: AgentCardView,
  index: number,
  step: AgentPlanStep,
  result: AgentStepResult,
  now: string,
): AgentCardView {
  const kept = scalarsOnly(result.result, step.resultAllowlist);
  const settled: AgentStepView = {
    state: result.outcome,
    ...(result.message === undefined ? {} : { message: result.message }),
    ...(kept === undefined ? {} : { result: kept }),
    ...(result.revealed === undefined ? {} : { revealed: result.revealed }),
  };
  const steps = replace(card.steps, index, settled);

  if (result.outcome !== "done") {
    return withSteps(card, strandAfter(steps, index), {
      state: result.outcome === "failed" ? "stopped" : "pending-approval",
      runningIndex: undefined,
      settledAt: now,
    });
  }
  const last = index === card.steps.length - 1;
  if (last) {
    return withSteps(card, steps, { state: "done", runningIndex: undefined, settledAt: now });
  }
  if (card.stopping) {
    return withSteps(card, strandAfter(steps, index), {
      state: "stopped",
      runningIndex: undefined,
      settledAt: now,
    });
  }
  return withSteps(card, steps, { runningIndex: undefined });
}

export function requestStop(card: AgentCardView): AgentCardView {
  return card.state === "running" ? { ...card, stopping: true } : card;
}

export function cancelCard(card: AgentCardView, now: string): AgentCardView {
  if (card.state !== "proposed") return card;
  return withSteps(
    card,
    card.steps.map(() => ({ state: "cancelled" as const })),
    { state: "cancelled", runningIndex: undefined, settledAt: now },
  );
}

export function expireCard(card: AgentCardView): AgentCardView {
  if (card.state !== "proposed") return card;
  return withSteps(
    card,
    card.steps.map(() => ({ state: "expired" as const })),
    { state: "expired" },
  );
}

export function ranCount(card: AgentCardView): number {
  return card.steps.filter((step) => step.state === "done").length;
}

export function stoppedAt(card: AgentCardView): number | undefined {
  const index = card.steps.findIndex(
    (step) => step.state === "failed" || step.state === "pending-approval",
  );
  return index < 0 ? undefined : index;
}

export interface CatalogLine {
  readonly key: MessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
}

export function headingChip(card: AgentCardView): CatalogLine {
  switch (card.state) {
    case "running": {
      const at = (card.runningIndex ?? 0) + 1;
      return {
        key: "agent.card.chip.running",
        params: { step: at, count: card.steps.length },
      };
    }
    case "stopped": {
      const at = stoppedAt(card);
      return at === undefined
        ? { key: "agent.card.chip.stoppedByYou" }
        : { key: "agent.card.chip.stopped", params: { step: at + 1 } };
    }
    case "done":
      return { key: "agent.card.chip.done" };
    case "pending-approval":
      return { key: "agent.card.chip.pending" };
    case "cancelled":
      return { key: "agent.card.chip.cancelled" };
    case "expired":
      return { key: "agent.card.chip.expired" };
    default:
      return { key: "agent.card.chip.proposed" };
  }
}

export const STEP_STATE_WORDS: Readonly<Record<AgentStepState, MessageKey>> = {
  proposed: "agent.card.state.proposed",
  running: "agent.card.state.running",
  done: "agent.card.state.done",
  failed: "agent.card.state.failed",
  "pending-approval": "agent.card.state.pendingApproval",
  "not-run": "agent.card.state.notRun",
  cancelled: "agent.card.state.cancelled",
  expired: "agent.card.state.expired",
};

export function resultLine(card: AgentCardView): CatalogLine | undefined {
  const ran = ranCount(card);
  const count = card.steps.length;
  switch (card.state) {
    case "done":
      return { key: "agent.card.result.done", params: { count } };
    case "stopped": {
      const at = stoppedAt(card);
      return at === undefined
        ? { key: "agent.card.result.stoppedByYou", params: { ran, count } }
        : { key: "agent.card.result.stopped", params: { step: at + 1, ran, count } };
    }
    case "pending-approval": {
      const at = stoppedAt(card);
      return {
        key: "agent.card.result.held",
        params: { step: (at ?? 0) + 1, ran, count },
      };
    }
    case "cancelled":
      return { key: "agent.card.result.cancelled" };
    case "expired":
      return { key: "agent.card.result.expired" };
    default:
      return undefined;
  }
}

/* The announcement for a card still running. A settled card is announced by its own result line, which
   takes focus, so a live region repeating it would read the outcome twice. */
export function runningLine(card: AgentCardView): CatalogLine | undefined {
  if (card.state !== "running" || card.runningIndex === undefined) return undefined;
  return {
    key: "agent.card.live.running",
    params: { step: card.runningIndex + 1, count: card.steps.length },
  };
}

export function liveLine(card: AgentCardView): CatalogLine | undefined {
  return runningLine(card) ?? resultLine(card);
}

/** Build replay only from registered result allowlists and the card fold, never model text or content. */
export interface ActionResultTurn {
  readonly role: "action-result";
  readonly proposalId: string;
  readonly steps: readonly {
    readonly kind: string;
    readonly outcome: AgentStepState;
    readonly result?: StepResultFields;
  }[];
}

export function actionResultTurn(
  proposal: AgentProposal,
  card: AgentCardView,
): ActionResultTurn | undefined {
  if (card.state === "proposed" || card.state === "running") return undefined;
  return {
    role: "action-result",
    proposalId: proposal.proposalId,
    steps: card.steps.map((step, index) => ({
      kind: proposal.steps[index]?.kind ?? "",

      outcome: step.state === "proposed" ? "not-run" : step.state,
      ...(step.result === undefined ? {} : { result: step.result }),
    })),
  };
}
