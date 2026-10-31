/**
 * The propose tools' own logic (section 6.1). It executes nothing: it validates every
 * step, checks it against the caller's grants, applies the caps and the hand-off and
 * ADR-41 rules, and mints the token Confirm carries. A refusal goes to the model.
 */

import { z } from "zod";

import { actionKind } from "../actions/registry.js";
import type { ActionKindDef } from "../actions/types.js";
import { offeredEnvironments, type OfferedActionKind } from "../grant-filter.js";
import {
  argumentsDigest,
  isStepReference,
  PROPOSAL_MAX_STEPS,
  signProposalToken,
  type ProposalStepBinding,
} from "../proposal-token.js";
import { argsSchemaWithReferences } from "./args-schema.js";

/** P1: a turn ends with at most one card or one plan. */
export const PROPOSALS_PER_TURN = 1;

/** P2: a payload bound in the spirit of the conversation cap, not a permission rule. */
export const MAX_PLAN_STEPS = PROPOSAL_MAX_STEPS;

export const ProposedStep = z.strictObject({
  kind: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
});

export type ProposedStep = z.infer<typeof ProposedStep>;

/** One step as the card will display it, with its arguments resolved only symbolically. */
export interface PlanStep {
  readonly kind: string;
  readonly screen: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly environment: string;
  readonly handOff: boolean;
  readonly card: ActionKindDef["card"];
  /**
   * The non-secret result fields the next turn may learn (section 7.6). It travels with
   * the step so the card filters its report against the kind's own list rather than a
   * second copy of it.
   */
  readonly resultAllowlist: readonly string[];
}

export interface Proposal {
  readonly proposalId: string;
  readonly token: string | undefined;
  readonly steps: readonly PlanStep[];
  readonly proposedAt: string;
  readonly expiresAt: string;
  readonly formId: string | undefined;
  /**
   * The environment the switcher named for this turn. A step whose kind acts in its own
   * argument's environment still runs through the screen's action, which confirms the tab
   * against the selection, so the card needs the selection as well as the destination.
   */
  readonly currentEnvironment: string;
}

export type ProposeOutcome =
  | { readonly ok: true; readonly proposal: Proposal }
  | { readonly ok: false; readonly reason: string };

export interface ProposeInput {
  readonly steps: readonly ProposedStep[];
  /** The principal the token is issued to. */
  readonly subject: string;
  readonly appKey: string;
  /** The environment the switcher named for this turn. */
  readonly current: string;
  readonly offered: readonly OfferedActionKind[];
  /** The workspace's ADR-41 switch, which refuses a publish-then-release-to-prod plan. */
  readonly requireSecondApprover: boolean;
  /** The environment name a production act runs in, from the deployment's own mount. */
  readonly productionEnvironment: string;
  readonly formId?: string | undefined;
  readonly issuedAt: Date;
  /** Already proposed in this turn, which P1 bounds at one. */
  readonly proposalsThisTurn: number;
}

function refuse(reason: string): ProposeOutcome {
  return { ok: false, reason };
}

/** A reference points at an earlier step and names the one field that step records. */
function referenceRefusal(
  value: unknown,
  index: number,
  steps: readonly ProposedStep[],
): string | undefined {
  if (!isStepReference(value)) return undefined;
  if (value.fromStep >= index) {
    return `Step ${String(index + 1)} references step ${String(value.fromStep + 1)}, which does not run before it. A reference may only name an earlier step.`;
  }
  const earlier = actionKind(steps[value.fromStep]?.kind ?? "");
  if (earlier === undefined || earlier.references[0] !== value.field) {
    return `Step ${String(value.fromStep + 1)} does not return a field named "${value.field}".`;
  }
  return undefined;
}

function referencedMembers(args: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  return new Set(
    Object.entries(args)
      .filter(([, value]) => isStepReference(value))
      .map(([name]) => name),
  );
}

function environmentOf(
  def: ActionKindDef,
  args: Readonly<Record<string, unknown>>,
  current: string,
): string | undefined {
  if (def.environmentFrom === "switcher") return current;
  const named = args[def.environmentArgument ?? "environment"];
  return typeof named === "string" && named !== "" ? named : undefined;
}

function stepRefusal(
  input: ProposeInput,
  step: ProposedStep,
  index: number,
): { readonly reason: string } | { readonly step: PlanStep; readonly def: ActionKindDef } {
  const def = actionKind(step.kind);
  if (def === undefined) {
    return { reason: `There is no action kind named "${step.kind}".` };
  }

  const allowed = offeredEnvironments(input.offered, step.kind);
  if (allowed.length === 0) {
    return {
      reason: `This user does not hold the permission "${def.cell.resource}: ${def.cell.action}", so ${step.kind} cannot be proposed. Explain and navigate instead.`,
    };
  }

  for (const value of Object.values(step.args)) {
    const refusal = referenceRefusal(value, index, input.steps);
    if (refusal !== undefined) return { reason: refusal };
  }

  // The provenance check substitutes one reference at a time, so a step with two could
  // never be verified. Refusing here keeps an unrunnable card off the screen.
  const referenced = referencedMembers(step.args);
  if (referenced.size > 1) {
    return {
      reason: `Step ${String(index + 1)} refers to an earlier step's result in more than one argument, which this deployment cannot verify. Name one reference per step and state the other argument's value.`,
    };
  }

  const parsed = argsSchemaWithReferences(def, referenced).safeParse(step.args);
  if (!parsed.success) {
    return { reason: `Step ${String(index + 1)}'s arguments are invalid: ${parsed.error.message}` };
  }

  const environment = environmentOf(def, step.args, input.current);
  if (environment === undefined) {
    return {
      reason: `Step ${String(index + 1)} names no environment, and ${step.kind} acts in one.`,
    };
  }
  if (!allowed.includes(environment)) {
    return {
      reason: `This user does not hold "${def.cell.resource}: ${def.cell.action}" in ${environment}. The environments available are: ${allowed.join(", ")}.`,
    };
  }

  return {
    step: {
      kind: step.kind,
      screen: def.screen,
      args: step.args,
      environment,
      handOff: def.handOff === true,
      card: def.card,
      resultAllowlist: def.resultAllowlist,
    },
    def,
  };
}

/**
 * ADR-41 refuses a release by the account that published the version, so a publish and a
 * production release by one account can never complete, in one step or in two. Refusing
 * here tells the model why rather than failing the user halfway through a confirmed run.
 */
function secondApproverRefusal(
  input: ProposeInput,
  steps: readonly PlanStep[],
): string | undefined {
  if (!input.requireSecondApprover) return undefined;
  const publishedAt = steps.findIndex((step) => step.kind === "form.publish");
  if (publishedAt < 0) return undefined;
  const sameAct = steps[publishedAt]?.environment === input.productionEnvironment;
  const release = steps.findIndex(
    (step, index) =>
      index > publishedAt &&
      step.kind === "form.release" &&
      step.environment === input.productionEnvironment,
  );
  if (!sameAct && release < 0) return undefined;
  return (
    "This workspace requires a second approver for a production release, and ADR-41 refuses " +
    "a release by the account that published the version. Propose the publish into a " +
    "non-production environment; another account releases it to production."
  );
}

/**
 * Builds a proposal, or returns the reason it is refused. A hand-off step carries no
 * token, so a plan whose last step is a hand-off mints a token for the steps before it.
 */
export async function buildProposal(input: ProposeInput): Promise<ProposeOutcome> {
  if (input.proposalsThisTurn >= PROPOSALS_PER_TURN) {
    return refuse("One proposal per turn; put the steps in one plan.");
  }
  if (input.steps.length === 0) return refuse("A proposal carries at least one step.");
  if (input.steps.length > MAX_PLAN_STEPS) {
    return refuse(
      `A plan carries at most ${String(MAX_PLAN_STEPS)} steps. Propose a shorter plan.`,
    );
  }

  const steps: PlanStep[] = [];
  for (const [index, step] of input.steps.entries()) {
    const checked = stepRefusal(input, step, index);
    if ("reason" in checked) return refuse(checked.reason);
    steps.push(checked.step);
  }

  const handOffAt = steps.findIndex((step) => step.handOff);
  if (handOffAt >= 0 && handOffAt !== steps.length - 1) {
    return refuse(
      `Step ${String(handOffAt + 1)} needs a secret the user types on the screen itself, so it may only be the last step of a plan.`,
    );
  }

  const adr41 = secondApproverRefusal(input, steps);
  if (adr41 !== undefined) return refuse(adr41);

  const proposalId = `prp_${crypto.randomUUID().replaceAll("-", "")}`;
  const tokenSteps: ProposalStepBinding[] = [];
  for (const step of steps) {
    if (step.handOff) continue;
    tokenSteps.push({
      kind: step.kind,
      argsDigest: await argumentsDigest(step.args),
      environment: step.environment,
    });
  }

  const token =
    tokenSteps.length === 0
      ? undefined
      : await signProposalToken(input.appKey, {
          sub: input.subject,
          pid: proposalId,
          steps: tokenSteps,
          formId: input.formId,
          issuedAt: input.issuedAt,
        });

  return {
    ok: true,
    proposal: {
      proposalId,
      token,
      steps,
      proposedAt: input.issuedAt.toISOString(),
      expiresAt: new Date(input.issuedAt.getTime() + 10 * 60 * 1000).toISOString(),
      formId: input.formId,
      currentEnvironment: input.current,
    },
  };
}
