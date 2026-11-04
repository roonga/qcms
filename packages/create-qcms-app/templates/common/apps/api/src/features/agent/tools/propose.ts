/**
 * The propose tools' own logic (section 6.1). It executes nothing: it validates every
 * step, checks it against the caller's grants, applies the caps and the hand-off and
 * ADR-41 rules, and mints the token Confirm carries. A refusal goes to the model.
 */

import { z } from "zod";

import type { FormDefinition, QuestionDefinition } from "@roonga/qcms-core";

import type { PublishIssue, PublishWarning } from "../../forms/handler.js";
import { actionKind } from "../actions/registry.js";
import type { ActionKindDef } from "../actions/types.js";
import type { PinnedQuestion, SavedDraftPins } from "../draft-pins.js";
import { offeredEnvironments, type OfferedActionKind } from "../grant-filter.js";
import type { ScreenId } from "../screens.js";
import {
  argumentsDigest,
  isStepReference,
  PROPOSAL_MAX_STEPS,
  signProposalToken,
  type ProposalStepBinding,
} from "../proposal-token.js";
import { argsSchemaWithReferences } from "./args-schema.js";

export const PROPOSALS_PER_TURN = 1;

/** P2: a payload bound in the spirit of the conversation cap, not a permission rule. */
export const MAX_PLAN_STEPS = PROPOSAL_MAX_STEPS;

const PUBLISH_QUESTION_KIND = "question.publish";

const PUBLISH_FORM_KIND = "form.publish";

/** The question's own page, where publishing one needs no draft to justify it. */
const QUESTION_DETAIL_SCREEN: ScreenId = "/questions/[questionId]";

export const ProposedStep = z.strictObject({
  kind: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
});

export type ProposedStep = z.infer<typeof ProposedStep>;

/**
 * The draft a turn proposed and the server's verdict on it, carried by the one kind that
 * applies it. The diff is the user's to review; both lists are the server's own validation
 * rather than anything the model said about the draft.
 */
export interface ProposedDraftStep {
  readonly definition: FormDefinition;
  readonly newQuestions: readonly QuestionDefinition[];
  readonly issues: readonly PublishIssue[];
  readonly warnings: readonly PublishWarning[];
}

/** One step as the card will display it, with its arguments resolved only symbolically. */
export interface PlanStep {
  readonly kind: string;
  readonly screen: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly environment: string;
  readonly handOff: boolean;
  /** A step the screen's own save completes, which carries no token. */
  readonly local: boolean;
  /** Present on the one kind that applies the turn's proposed draft. */
  readonly draft?: ProposedDraftStep;
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
  /** The screen the turn is on, which decides whether a question publish needs a pin. */
  readonly screen: ScreenId;
  readonly offered: readonly OfferedActionKind[];
  /** The workspace's ADR-41 switch, which refuses a publish-then-release-to-prod plan. */
  readonly requireSecondApprover: boolean;
  /** The environment name a production act runs in, from the deployment's own mount. */
  readonly productionEnvironment: string;
  readonly formId?: string | undefined;
  readonly issuedAt: Date;

  readonly proposalsThisTurn: number;
  /**
   * The draft this turn proposed, if it proposed one, with the questions it invents. The
   * kind that applies it is refused until it is here, so a card can never offer to apply a
   * draft the server never saw.
   */
  readonly proposedDraft?:
    | {
        readonly definition: FormDefinition;
        readonly newQuestions: readonly QuestionDefinition[];
      }
    | undefined;
  /**
   * The form's saved draft, read when a step asks to publish one of the versions it pins
   * unpublished. Absent, a question publish away from the question's own page is refused
   * rather than allowed unverified; a plan built from it is bound to its revision.
   */
  readonly savedDraft?: (() => Promise<SavedDraftPins | undefined>) | undefined;
  /** The builder's own validation, so the card's two lists and a publish cannot disagree. */
  readonly validate?:
    | ((definition: FormDefinition) => Promise<{
        readonly issues: readonly PublishIssue[];
        readonly warnings: readonly PublishWarning[];
      }>)
    | undefined;
}

function refuse(reason: string): ProposeOutcome {
  return { ok: false, reason };
}

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
  if (earlier?.local === true || earlier?.handOff === true) {
    // It reaches no route, so it writes no audit row and the provenance check has nothing
    // to resolve the reference against.
    return `Step ${String(value.fromStep + 1)} completes on the screen itself and records no result a later step can name. State the value in step ${String(index + 1)} instead.`;
  }
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

/**
 * The kind that applies a proposed draft is refused unless this turn proposed one for this
 * form, and unless the deployment can validate it: the card's two advisory lists are the
 * server's own verdict, never an absence read as a pass.
 */
function proposedDraftRefusal(
  input: ProposeInput,
  def: ActionKindDef,
  step: ProposedStep,
  index: number,
): string | undefined {
  const proposed = input.proposedDraft;
  if (proposed === undefined || input.validate === undefined) {
    return `Step ${String(index + 1)} applies a draft, and this turn has proposed none. Call propose_draft first, then propose ${def.kind}.`;
  }
  const named = step.args["formId"];
  if (named !== proposed.definition.formId) {
    return `Step ${String(index + 1)} names a different form from the draft this turn proposed.`;
  }
  if (input.steps.filter((entry) => entry.kind === def.kind).length > 1) {
    return `A plan applies the proposed draft once. Keep one ${def.kind} step.`;
  }
  return undefined;
}

/**
 * A question publish proposed anywhere but the question's own page names a version the
 * form's saved draft pins unpublished, and nothing else. A literal id and version, because
 * a value resolved from an earlier step's result could not be checked against the set here.
 */
function pinnedQuestionRefusal(
  step: ProposedStep,
  index: number,
  pinned: readonly PinnedQuestion[],
): string | undefined {
  const questionId = step.args["questionId"];
  const version = step.args["version"];
  const matched =
    typeof questionId === "string" &&
    typeof version === "number" &&
    pinned.some((pin) => pin.questionId === questionId && pin.version === version);
  if (matched) return undefined;
  const available =
    pinned.length === 0
      ? "This form's saved draft pins no unpublished question version."
      : `The versions this form's saved draft pins unpublished are: ${pinned
          .map((pin) => `${pin.questionId}@v${String(pin.version)}`)
          .join(", ")}.`;
  return (
    `Step ${String(index + 1)} publishes a question version this form's saved draft does not ` +
    `pin unpublished. ${available} Publish any other question from its own page in the library.`
  );
}

/**
 * The form's publish runs after every question publish in the same plan, because a draft
 * pinning an unpublished version cannot be published at all: proposed the other way round
 * the plan would stop at its own first step.
 */
function publishOrderRefusal(steps: readonly ProposedStep[]): string | undefined {
  const formAt = steps.findIndex((step) => step.kind === PUBLISH_FORM_KIND);
  if (formAt < 0) return undefined;
  const lastQuestion = steps.reduce(
    (last, step, index) => (step.kind === PUBLISH_QUESTION_KIND ? index : last),
    -1,
  );
  if (lastQuestion < formAt) return undefined;
  return (
    `Step ${String(formAt + 1)} publishes the form before step ${String(lastQuestion + 1)} ` +
    "publishes a question the draft pins, which would be refused as an unpublished pin. " +
    "Put every question publish before the form publish."
  );
}

/**
 * Publishing the form deletes the saved draft, so a plan bound to that draft's revision
 * ends at its publish: any later step carrying the token would be refused for a draft the
 * user never touched, and the card would say the draft changed when it did not.
 */
function boundPublishLastRefusal(steps: readonly PlanStep[]): string | undefined {
  const formAt = steps.findIndex((step) => step.kind === PUBLISH_FORM_KIND);
  if (formAt < 0) return undefined;
  const after = steps.findIndex((step, index) => index > formAt && carriesToken(step));
  if (after < 0) return undefined;
  return (
    `Step ${String(formAt + 1)} publishes the form, which deletes the saved draft this plan's ` +
    `question publishes were checked against, so step ${String(after + 1)} could not run. ` +
    "Make the form publish the last step of this plan and propose the rest in the next turn."
  );
}

/**
 * A local step saves the draft through the screen, which moves its revision, so in a plan
 * bound to that revision no token step may follow one: it would be refused as a draft
 * change the user never made.
 */
function boundAfterDraftWriteRefusal(steps: readonly PlanStep[]): string | undefined {
  const writeAt = steps.findIndex((step) => step.local);
  if (writeAt < 0) return undefined;
  const after = steps.findIndex((step, index) => index > writeAt && carriesToken(step));
  if (after < 0) return undefined;
  const kind = steps[writeAt]?.kind ?? "";
  return (
    `Step ${String(writeAt + 1)} (${kind}) saves the form's draft, which changes the draft ` +
    `this plan's question publishes were checked against, so step ${String(after + 1)} ` +
    `could not run. Propose ${kind} on its own, and once the user has applied it, ` +
    "propose the publish in the next turn."
  );
}

function stepReferenceRefusal(
  input: ProposeInput,
  step: ProposedStep,
  index: number,
): string | undefined {
  for (const value of Object.values(step.args)) {
    const refusal = referenceRefusal(value, index, input.steps);
    if (refusal !== undefined) return refusal;
  }
  // The provenance check substitutes one reference at a time, so a step with two could
  // never be verified. Refusing here keeps an unrunnable card off the screen.
  if (referencedMembers(step.args).size > 1) {
    return `Step ${String(index + 1)} refers to an earlier step's result in more than one argument, which this deployment cannot verify. Name one reference per step and state the other argument's value.`;
  }
  return undefined;
}

function kindRefusal(
  input: ProposeInput,
  def: ActionKindDef,
  step: ProposedStep,
  index: number,
  pinned: readonly PinnedQuestion[],
): string | undefined {
  if (def.carriesProposedDraft === true) {
    return proposedDraftRefusal(input, def, step, index);
  }
  if (step.kind === PUBLISH_QUESTION_KIND && input.screen !== QUESTION_DETAIL_SCREEN) {
    return pinnedQuestionRefusal(step, index, pinned);
  }
  return undefined;
}

function stepRefusal(
  input: ProposeInput,
  step: ProposedStep,
  index: number,
  pinned: readonly PinnedQuestion[],
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

  const referenceIssue = stepReferenceRefusal(input, step, index);
  if (referenceIssue !== undefined) return { reason: referenceIssue };

  const referenced = referencedMembers(step.args);
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

  const descriptorIssue = kindRefusal(input, def, step, index, pinned);
  if (descriptorIssue !== undefined) return { reason: descriptorIssue };

  return {
    step: {
      kind: step.kind,
      screen: def.screen,
      args: step.args,
      environment,
      handOff: def.handOff === true,
      local: def.local === true,
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
 * Every step that reaches a route of its own, which is what the token binds. A hand-off
 * and a local step reach none, so the card runs them without one and the step indexes the
 * token carries stay the indexes of the steps bound to it.
 */
function carriesToken(step: PlanStep): boolean {
  return !step.handOff && !step.local;
}

/**
 * Each step's position in the token, or `-1` for one that carries none. A digested
 * reference names its target by this index rather than by its plan position, because the
 * provenance check rebuilds it from audit rows written per token step.
 */
function tokenIndexes(steps: readonly PlanStep[]): readonly number[] {
  let next = 0;
  return steps.map((step) => {
    if (!carriesToken(step)) return -1;
    const index = next;
    next += 1;
    return index;
  });
}

function argsInTokenTerms(
  args: Readonly<Record<string, unknown>>,
  tokenIndex: readonly number[],
): Readonly<Record<string, unknown>> {
  const mapped: Record<string, unknown> = { ...args };
  for (const [name, value] of Object.entries(args)) {
    if (!isStepReference(value)) continue;
    const bound = tokenIndex[value.fromStep];
    if (bound === undefined || bound < 0) continue;
    mapped[name] = { fromStep: bound, field: value.field };
  }
  return mapped;
}

async function withProposedDraft(
  input: ProposeInput,
  steps: readonly PlanStep[],
): Promise<readonly PlanStep[]> {
  const proposed = input.proposedDraft;
  const validate = input.validate;
  if (proposed === undefined || validate === undefined) return steps;
  if (!steps.some((step) => actionKind(step.kind)?.carriesProposedDraft === true)) return steps;
  const { issues, warnings } = await validate(proposed.definition);
  return steps.map((step) =>
    actionKind(step.kind)?.carriesProposedDraft === true
      ? {
          ...step,
          draft: {
            definition: proposed.definition,
            newQuestions: proposed.newQuestions,
            issues,
            warnings,
          },
        }
      : step,
  );
}

function capRefusal(input: ProposeInput): string | undefined {
  if (input.proposalsThisTurn >= PROPOSALS_PER_TURN) {
    return "One proposal per turn; put the steps in one plan.";
  }
  if (input.steps.length === 0) return "A proposal carries at least one step.";
  if (input.steps.length > MAX_PLAN_STEPS) {
    return `A plan carries at most ${String(MAX_PLAN_STEPS)} steps. Propose a shorter plan.`;
  }
  return undefined;
}

/**
 * The draft's unpublished pins, read only when a step asks to publish one of them, with
 * the revision the token binds so Confirm can refuse a draft that has moved since.
 */
async function resolvedPins(
  input: ProposeInput,
): Promise<
  | { readonly pinned: readonly PinnedQuestion[]; readonly revision: number | undefined }
  | { readonly reason: string }
> {
  const needed =
    input.screen !== QUESTION_DETAIL_SCREEN &&
    input.steps.some((step) => step.kind === PUBLISH_QUESTION_KIND);
  if (!needed) return { pinned: [], revision: undefined };
  if (input.savedDraft === undefined) {
    return {
      reason:
        `This screen cannot say which question versions the form's draft pins, so ${PUBLISH_QUESTION_KIND} ` +
        "cannot be proposed here. Publish the question from its own page in the library.",
    };
  }
  const saved = await input.savedDraft();
  if (saved === undefined) {
    return {
      reason:
        `This form has no saved draft, so it pins no unpublished question version and ` +
        `${PUBLISH_QUESTION_KIND} cannot be proposed here. Publish the question from its own page in the library.`,
    };
  }
  return { pinned: saved.pins, revision: saved.revision };
}

/** The refusals that are about the plan as a whole rather than about one step. */
function planShapeRefusal(
  input: ProposeInput,
  steps: readonly PlanStep[],
  boundRevision: number | undefined,
): string | undefined {
  const ordering = publishOrderRefusal(input.steps);
  if (ordering !== undefined) return ordering;
  if (boundRevision !== undefined) {
    const bound = boundPublishLastRefusal(steps);
    if (bound !== undefined) return bound;
    const rewritten = boundAfterDraftWriteRefusal(steps);
    if (rewritten !== undefined) return rewritten;
  }
  const handOffAt = steps.findIndex((step) => step.handOff);
  if (handOffAt >= 0 && handOffAt !== steps.length - 1) {
    return `Step ${String(handOffAt + 1)} needs a secret the user types on the screen itself, so it may only be the last step of a plan.`;
  }
  return secondApproverRefusal(input, steps);
}

/**
 * Builds a proposal, or returns the reason it is refused. A hand-off step carries no
 * token, so a plan whose last step is a hand-off mints a token for the steps before it.
 */
export async function buildProposal(input: ProposeInput): Promise<ProposeOutcome> {
  const capped = capRefusal(input);
  if (capped !== undefined) return refuse(capped);

  const resolved = await resolvedPins(input);
  if ("reason" in resolved) return refuse(resolved.reason);

  const steps: PlanStep[] = [];
  for (const [index, step] of input.steps.entries()) {
    const checked = stepRefusal(input, step, index, resolved.pinned);
    if ("reason" in checked) return refuse(checked.reason);
    steps.push(checked.step);
  }

  const shape = planShapeRefusal(input, steps, resolved.revision);
  if (shape !== undefined) return refuse(shape);

  const proposalId = `prp_${crypto.randomUUID().replaceAll("-", "")}`;
  const tokenIndex = tokenIndexes(steps);
  const tokenSteps: ProposalStepBinding[] = [];
  for (const step of steps) {
    if (!carriesToken(step)) continue;
    tokenSteps.push({
      kind: step.kind,
      argsDigest: await argumentsDigest(argsInTokenTerms(step.args, tokenIndex)),
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
          draftRevision: resolved.revision,
          issuedAt: input.issuedAt,
        });

  return {
    ok: true,
    proposal: {
      proposalId,
      token,
      steps: await withProposedDraft(input, steps),
      proposedAt: input.issuedAt.toISOString(),
      expiresAt: new Date(input.issuedAt.getTime() + 10 * 60 * 1000).toISOString(),
      formId: input.formId,
      currentEnvironment: input.current,
    },
  };
}
