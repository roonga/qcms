import type { MessageKey } from "../i18n/en.ts";

import type { AgentPlanStep, AgentProposal } from "../forms/assist-stream.ts";

/**
 * The action card's state, as a fold (SEC-17 section 4.10). It lives apart from the
 * component because what a card shows, when Confirm is enabled and what the next turn is
 * told are controls rather than styling, and none of them may depend on model text.
 */

export type AgentStepState =
  | "proposed"
  | "running"
  | "done"
  | "failed"
  | "pending-approval"
  | "not-run"
  | "cancelled"
  | "expired";

/** The card's own state, which its heading chip says once. */
export type AgentCardState =
  "proposed" | "running" | "done" | "stopped" | "pending-approval" | "cancelled" | "expired";

/** A step reports scalars only: an object or an array is content in a metadata channel. */
export type ScalarField = string | number | boolean;

export type StepResultFields = Readonly<Record<string, ScalarField>>;

/** What each step reported, keyed by its index, which is what resolves a reference. */
export type ReportedResults = Readonly<Record<number, StepResultFields>>;

export interface AgentStepView {
  readonly state: AgentStepState;
  /** The screen action's own message, quoted under a failed or held step. */
  readonly message?: string;
  /** The allowlisted fields this step reported, which the next turn learns. */
  readonly result?: StepResultFields;
}

export interface AgentCardView {
  readonly proposalId: string;
  readonly steps: readonly AgentStepView[];
  readonly state: AgentCardState;
  /** The step the runner is waiting on, while one is running. */
  readonly runningIndex: number | undefined;
  /** Set once Stop is pressed: the running step finishes and no further step is sent. */
  readonly stopping: boolean;
  /** When the user settled the card, for the result line. */
  readonly settledAt: string | undefined;
}

/** What one step's own server action answered. */
export interface AgentStepResult {
  readonly outcome: "done" | "failed" | "pending-approval";
  readonly message?: string;
  /** Whatever the action returned; filtered to the kind's allowlist before it travels. */
  readonly result?: Readonly<Record<string, unknown>>;
}

/** The states every step of a card shares, where the heading chip says it once. */
const SHARED_CARD_STATES: readonly AgentCardState[] = ["proposed", "cancelled", "expired"];

export function showsStepChips(card: AgentCardView): boolean {
  return !SHARED_CARD_STATES.includes(card.state);
}

export function isExpired(proposal: AgentProposal, now: number): boolean {
  const expires = Date.parse(proposal.expiresAt);
  return Number.isFinite(expires) && now >= expires;
}

export function initialCard(proposal: AgentProposal, now: number): AgentCardView {
  const expired = isExpired(proposal, now);
  return {
    proposalId: proposal.proposalId,
    steps: proposal.steps.map(() => ({ state: expired ? "expired" : "proposed" })),
    state: expired ? "expired" : "proposed",
    runningIndex: undefined,
    stopping: false,
    settledAt: undefined,
  };
}

/** Confirm is offered only while the card is waiting and has not expired. */
export function canConfirm(card: AgentCardView): boolean {
  return card.state === "proposed";
}

/** The marker sits on the mirrored control only while the card waits. */
export function showsMarker(card: AgentCardView): boolean {
  return card.state === "proposed";
}

/** The first step that has not run, which is the step the marker's control mirrors. */
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

/** Every step after `index` that has not run becomes Not run, and is never sent. */
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

/**
 * Settle the step the runner was waiting on. A failure and a hold are both terminal for
 * the plan: every later step shows Not run, is never sent and is never retried.
 */
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

/** Stop lets the running step finish and sends no further step. */
export function requestStop(card: AgentCardView): AgentCardView {
  return card.state === "running" ? { ...card, stopping: true } : card;
}

/** Cancel is local: nothing was sent, and the next turn is told so. */
export function cancelCard(card: AgentCardView, now: string): AgentCardView {
  if (card.state !== "proposed") return card;
  return withSteps(
    card,
    card.steps.map(() => ({ state: "cancelled" as const })),
    { state: "cancelled", runningIndex: undefined, settledAt: now },
  );
}

/** Ten minutes without a Confirm. The API refuses the stale token independently. */
export function expireCard(card: AgentCardView): AgentCardView {
  if (card.state !== "proposed") return card;
  return withSteps(
    card,
    card.steps.map(() => ({ state: "expired" as const })),
    { state: "expired" },
  );
}

/** The index of the last step that ran, which the stopped and held lines name. */
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

/** The heading chip, which says the card's state once. */
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

/** One step's own state word, which is both its chip and its visually hidden text. */
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

/** The one line that stays in the conversation as the record, and takes focus. */
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

/** What the panel's polite live region says, which is progress in words. */
export function liveLine(card: AgentCardView): CatalogLine | undefined {
  if (card.state === "running" && card.runningIndex !== undefined) {
    return {
      key: "agent.card.live.running",
      params: { step: card.runningIndex + 1, count: card.steps.length },
    };
  }
  return resultLine(card);
}

/**
 * The `action-result` turn the next turn reads (section 5.3). It is written from the
 * card's own fold and the kind's allowlist, so no model text and no content re-enters the
 * conversation.
 */
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
      // A step still marked `proposed` when the card settled never ran.
      outcome: step.state === "proposed" ? "not-run" : step.state,
      ...(step.result === undefined ? {} : { result: step.result }),
    })),
  };
}
