/**
 * The propose tools' own logic (section 6.1). It executes nothing: it validates every
 * step, checks it against the caller's grants, applies the caps and the hand-off and
 * ADR-41 rules, and mints the token Confirm carries. A refusal goes to the model.
 */

import { z } from "zod";

import {
  FormDefinition as FormDefinitionSchema,
  type FormDefinition,
  type QuestionDefinition,
} from "@roonga/qcms-core";

import type { PendingQuestionVersion, PublishIssue, PublishWarning } from "../../forms/handler.js";
import { checkQuestionDefinition } from "../../questions/create.js";
import { actionKind, actsInOneEnvironment } from "../actions/registry.js";
import type { ActionKindDef } from "../actions/types.js";
import type { PinnedQuestion, SavedDraftPins } from "../draft-pins.js";
import { offeredEnvironments, type OfferedActionKind } from "../grant-filter.js";
import { isOperationalScreen } from "../screens.js";
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

const CREATE_QUESTION_KIND = "question.create";

const SAVE_QUESTION_KIND = "question.saveDraft";

/**
 * The id a draft is validated under when its form is an earlier step's result. Nothing
 * depends on the value: the validation resolves pinned question versions, and the real id
 * is minted by the create step and injected by the screen's own save.
 */
const PENDING_FORM_ID = "frm_pending";

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
  /** Which step of this plan creates each new question, so the card can name it. */
  readonly createdBy?: readonly { readonly questionId: string; readonly step: number }[];
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

/** Display context, never an argument: the card names a workspace, and the digest binds its id. */
export interface WorkspaceName {
  readonly workspaceId: string;
  readonly name: string;
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
  /** The names of the workspaces this plan's arguments name, for the card to show. */
  readonly workspaces?: readonly WorkspaceName[];
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
  /** Resolves the names of the workspaces a plan's own arguments name. */
  readonly workspaceNames?:
    ((workspaceIds: readonly string[]) => Promise<readonly WorkspaceName[]>) | undefined;
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
   * One form's saved draft, read when a plan publishes both a question version and the form
   * that pins it. Absent, such a plan is refused rather than allowed unverified; a plan
   * built from the pin set is bound to that draft's revision.
   */
  readonly savedDraft?: ((formId: string) => Promise<SavedDraftPins | undefined>) | undefined;
  /** The builder's own validation, so the card's two lists and a publish cannot disagree. */
  readonly validate?:
    | ((
        definition: FormDefinition,
        pending?: readonly PendingQuestionVersion[],
      ) => Promise<{
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
  // The builder runs this step against the form it has open, so the screen's own form is
  // the only one it can apply a draft to.
  if (input.formId !== undefined && named !== input.formId) {
    return (
      `Step ${String(index + 1)} applies a draft to a form other than the one this screen has ` +
      "open, and only that form's own builder can run it. Propose form.saveDraft instead."
    );
  }
  if (input.steps.filter((entry) => entry.kind === def.kind).length > 1) {
    return `A plan applies the proposed draft once. Keep one ${def.kind} step.`;
  }
  return undefined;
}

/**
 * The route's own check, run before any card exists, with the server's own words and the
 * spelling it suggests. So the model corrects the definition rather than the person watching
 * step 2 of a confirmed plan fail on it.
 */
function questionDefinitionRefusal(step: ProposedStep, index: number): string | undefined {
  const checked = checkQuestionDefinition(step.args["definition"]);
  if (checked.ok) return undefined;
  const named = step.args["questionId"] ?? step.args["slug"];
  const subject = typeof named === "string" && named !== "" ? ` (${named})` : "";
  const issues = checked.issues
    .map((issue) => {
      const at =
        issue.path === undefined || issue.path.length === 0 ? "" : `${issue.path.join(".")}: `;
      return `${at}${issue.message}`;
    })
    .join(" ");
  return (
    `Step ${String(index + 1)}'s question definition${subject} is invalid, so it cannot be ` +
    `proposed: ${issues} Correct the definition and propose the plan again.`
  );
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

/** A step that saves the form's draft, and so moves the revision a bound plan rests on. */
function writesDraft(step: PlanStep): boolean {
  const def = actionKind(step.kind);
  return step.local || def?.carriesDraftArgument === true;
}

/**
 * A step that saves the draft moves its revision, so in a plan bound to that revision no
 * token step may follow one: it would be refused as a draft change the user never made.
 */
function boundAfterDraftWriteRefusal(steps: readonly PlanStep[]): string | undefined {
  const writeAt = steps.findIndex((step) => writesDraft(step));
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
  pinChecked: boolean,
): string | undefined {
  if (def.carriesQuestionDefinition === true) {
    const invalid = questionDefinitionRefusal(step, index);
    if (invalid !== undefined) return invalid;
  }
  if (def.carriesProposedDraft === true) {
    return proposedDraftRefusal(input, def, step, index);
  }
  if (step.kind === PUBLISH_QUESTION_KIND && pinChecked) {
    return pinnedQuestionRefusal(step, index, pinned);
  }
  return undefined;
}

function stepRefusal(
  input: ProposeInput,
  step: ProposedStep,
  index: number,
  pinned: readonly PinnedQuestion[],
  pinChecked: boolean,
): { readonly reason: string } | { readonly step: PlanStep; readonly def: ActionKindDef } {
  const def = actionKind(step.kind);
  if (def === undefined) {
    return { reason: `There is no action kind named "${step.kind}".` };
  }

  const allowed = offeredEnvironments(input.offered, step.kind);
  if (allowed.length === 0) {
    // A local kind is absent because of where the turn is, not because of a grant, so it
    // says so and names the kinds that do work from anywhere.
    if (def.local === true) {
      return {
        reason:
          `${step.kind} is run by the ${def.screen} screen itself, so it can only be proposed ` +
          "from there. From anywhere else, propose a question.create step per new question " +
          "and one form.saveDraft step carrying the whole draft.",
      };
    }
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

  const descriptorIssue = kindRefusal(input, def, step, index, pinned, pinChecked);
  if (descriptorIssue !== undefined) return { reason: descriptorIssue };

  return {
    step: {
      kind: step.kind,
      screen: def.screen,
      // Normalised, so the card shows and the digest binds the same arguments the request's
      // own recompute will produce.
      args: def.normaliseArgs?.(step.args) ?? step.args,
      environment,
      handOff: def.handOff === true,
      local: def.local === true,
      card: actsInOneEnvironment(def) ? def.card : { ...def.card, hideEnvironment: true },
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

interface PlannedQuestion {
  readonly step: number;
  readonly version: number;
  readonly created: boolean;
  readonly definition: QuestionDefinition;
}

/**
 * The question versions this plan writes before a later step saves a draft: the ones it
 * creates, and the ones it rewrites. A pinned question with a pre-existing defect is
 * therefore fixed inside the same plan rather than by a card of its own.
 */
function plannedQuestions(steps: readonly PlanStep[]): readonly PlannedQuestion[] {
  return steps.flatMap((step, index) => {
    const created = step.kind === CREATE_QUESTION_KIND;
    if (!created && step.kind !== SAVE_QUESTION_KIND) return [];
    const definition = step.args["definition"];
    if (typeof definition !== "object" || definition === null) return [];
    const named = step.args["version"];
    // A create always writes v1; a save names the draft version it replaces.
    const version = created || typeof named !== "number" ? 1 : named;
    return [{ step: index, version, created, definition: definition as QuestionDefinition }];
  });
}

/**
 * An issue a draft save is entitled to carry: an unpublished pin whoever made it, since a
 * draft is where an unpublished version is meant to sit, and a dangling reference only for a
 * question this plan creates. Anything else is a defect the model can still fix.
 */
function isExpectedPinIssue(issue: PublishIssue, created: ReadonlySet<string>): boolean {
  if (issue.code === "UNPUBLISHED_QUESTION_PIN") return true;
  if (issue.code !== "DANGLING_QUESTION_REF") return false;
  const named = (issue as { readonly path?: { readonly question?: unknown } }).path?.question;
  return typeof named === "string" && created.has(named);
}

async function withDraftArguments(
  input: ProposeInput,
  steps: readonly PlanStep[],
): Promise<{ readonly reason: string } | { readonly steps: readonly PlanStep[] }> {
  const validate = input.validate;
  if (validate === undefined) return { steps };
  const created = plannedQuestions(steps);
  // Validated as the draft will stand once the plan has run: a question an earlier step
  // creates exists as draft v1 by then, so its pin is an unpublished pin and not a
  // dangling reference.
  const pending: PendingQuestionVersion[] = created.map((entry) => ({
    questionId: entry.definition.questionId,
    version: entry.version,
    definition: entry.definition,
  }));
  // Only a created question's pin is an expected unpublished pin; a rewritten one keeps
  // whatever status it already had.
  const createdBy = created
    .filter((entry) => entry.created)
    .map((entry) => ({ questionId: entry.definition.questionId, step: entry.step }));
  const plannedIds = new Set(
    created.filter((entry) => entry.created).map((entry) => entry.definition.questionId),
  );
  const out: PlanStep[] = [];
  for (const [index, step] of steps.entries()) {
    const parsed =
      actionKind(step.kind)?.carriesDraftArgument === true
        ? FormDefinitionSchema.safeParse({
            ...(step.args["definition"] as Record<string, unknown>),
            formId: typeof step.args["formId"] === "string" ? step.args["formId"] : PENDING_FORM_ID,
          })
        : undefined;
    if (parsed === undefined || !parsed.success) {
      out.push(step);
      continue;
    }
    const { issues, warnings } = await validate(parsed.data, pending);
    const blocking = issues.filter((issue) => !isExpectedPinIssue(issue, plannedIds));
    if (blocking.length > 0) {
      return {
        reason:
          `Step ${String(index + 1)}'s draft has a problem this plan does not fix: ` +
          `${blocking.map((issue) => issue.message).join(" ")} ` +
          "Add the steps that fix it to THIS plan and propose it again, rather than asking " +
          "for a card of its own. An unpublished pin is not what this is about.",
      };
    }
    out.push({
      ...step,
      draft: {
        definition: parsed.data,
        newQuestions: created.map((entry) => entry.definition),
        issues,
        warnings,
        createdBy,
      },
    });
  }
  return { steps: out };
}

/**
 * A draft argument the kernel cannot parse is refused at propose time, so no card ever
 * offers to save a definition the save itself would reject.
 */
function draftArgumentRefusal(steps: readonly PlanStep[]): string | undefined {
  for (const [index, step] of steps.entries()) {
    if (actionKind(step.kind)?.carriesDraftArgument !== true) continue;
    const parsed = FormDefinitionSchema.safeParse({
      ...(step.args["definition"] as Record<string, unknown>),
      formId: typeof step.args["formId"] === "string" ? step.args["formId"] : PENDING_FORM_ID,
    });
    if (parsed.success) continue;
    return (
      `Step ${String(index + 1)}'s draft is not a valid FormDefinition: ${parsed.error.message} ` +
      "Send defaultLocale, title, steps and rules, and leave formId out."
    );
  }
  return undefined;
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

/** The form a plan publishes, which is the draft its question publishes are checked against. */
function publishedFormId(input: ProposeInput): string | undefined {
  for (const step of input.steps) {
    if (step.kind !== PUBLISH_FORM_KIND) continue;
    const named = step.args["formId"];
    if (typeof named === "string" && named !== "") return named;
  }
  return input.formId;
}

/**
 * The draft's unpublished pins, read only when a plan publishes a question version and the
 * form that pins it: that is the only shape whose safety the pin set decides, since a
 * dangling pin is what refuses a publish. Any other plan reads none and binds no revision.
 */
async function resolvedPins(input: ProposeInput): Promise<
  | {
      readonly pinned: readonly PinnedQuestion[];
      readonly revision: number | undefined;
      readonly formId: string | undefined;
    }
  | { readonly reason: string }
> {
  const empty = { pinned: [], revision: undefined, formId: publishedFormId(input) } as const;
  const publishes = (kind: string): boolean => input.steps.some((step) => step.kind === kind);
  if (!publishes(PUBLISH_FORM_KIND) || !publishes(PUBLISH_QUESTION_KIND)) return empty;
  const formId = publishedFormId(input);
  if (input.savedDraft === undefined || formId === undefined) {
    return {
      reason:
        "This deployment cannot say which question versions the form's draft pins, so a plan " +
        `publishing both ${PUBLISH_QUESTION_KIND} and ${PUBLISH_FORM_KIND} cannot be proposed. ` +
        "Publish the question from its own page in the library.",
    };
  }
  const saved = await input.savedDraft(formId);
  if (saved === undefined) {
    return {
      reason:
        "This form has no saved draft, so it pins no unpublished question version and nothing " +
        `is published by ${PUBLISH_FORM_KIND}. Publish the question from its own page in the library.`,
    };
  }
  return { pinned: saved.pins, revision: saved.revision, formId };
}

/**
 * One Confirm covers one context. An authoring plan edits shared authoring content; an
 * operational plan acts on one environment's live state, so a plan mixing them would be one
 * confirmation spanning both.
 */
function mixedContextRefusal(steps: readonly PlanStep[]): string | undefined {
  const operational = steps.filter((step) => isOperationalScreen(step.screen));
  if (operational.length === 0 || operational.length === steps.length) return undefined;
  const authoring = steps.find((step) => !isOperationalScreen(step.screen));
  return (
    `This plan mixes authoring (${authoring?.kind ?? ""}) with operational ` +
    `(${operational[0]?.kind ?? ""}) steps, and one Confirm covers one context. Propose the ` +
    "authoring steps and the operational steps as two plans."
  );
}

/** The refusals that are about the plan as a whole rather than about one step. */
function planShapeRefusal(
  input: ProposeInput,
  steps: readonly PlanStep[],
  boundRevision: number | undefined,
): string | undefined {
  const mixed = mixedContextRefusal(steps);
  if (mixed !== undefined) return mixed;
  const malformed = draftArgumentRefusal(steps);
  if (malformed !== undefined) return malformed;
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
  const pinChecked = resolved.revision !== undefined;

  const steps: PlanStep[] = [];
  for (const [index, step] of input.steps.entries()) {
    const checked = stepRefusal(input, step, index, resolved.pinned, pinChecked);
    if ("reason" in checked) return refuse(checked.reason);
    steps.push(checked.step);
  }

  const shape = planShapeRefusal(input, steps, resolved.revision);
  if (shape !== undefined) return refuse(shape);

  // Validated before anything is signed, so a refused plan mints no token at all.
  const enriched = await withDraftArguments(input, await withProposedDraft(input, steps));
  if ("reason" in enriched) return refuse(enriched.reason);

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

  // The form the plan acts on rather than the one the screen names, because a plan may be
  // proposed from anywhere and the bound revision has to be that form's own.
  const boundFormId = resolved.formId ?? input.formId;
  const token =
    tokenSteps.length === 0
      ? undefined
      : await signProposalToken(input.appKey, {
          sub: input.subject,
          pid: proposalId,
          steps: tokenSteps,
          formId: boundFormId,
          draftRevision: resolved.revision,
          issuedAt: input.issuedAt,
        });

  return {
    ok: true,
    proposal: {
      proposalId,
      token,
      steps: enriched.steps,
      proposedAt: input.issuedAt.toISOString(),
      expiresAt: new Date(input.issuedAt.getTime() + 10 * 60 * 1000).toISOString(),
      formId: boundFormId,
      currentEnvironment: input.current,
      ...(await namedWorkspaces(input, steps)),
    },
  };
}

/** Spread-shaped, because `exactOptionalPropertyTypes` refuses an explicit `undefined`. */
async function namedWorkspaces(
  input: ProposeInput,
  steps: readonly PlanStep[],
): Promise<{ workspaces?: readonly WorkspaceName[] }> {
  const resolve = input.workspaceNames;
  if (resolve === undefined) return {};
  const ids = new Set<string>();
  for (const step of steps) {
    const named = step.args["workspaceId"];
    if (typeof named === "string" && named !== "") ids.add(named);
  }
  if (ids.size === 0) return {};
  const named = await resolve([...ids]);
  return named.length === 0 ? {} : { workspaces: named };
}
