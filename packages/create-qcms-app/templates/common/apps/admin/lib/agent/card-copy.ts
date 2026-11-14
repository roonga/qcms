import type { AgentPlanStep } from "../forms/assist-stream.ts";
import { PROD_ENVIRONMENT } from "../environment.ts";
import { t, tPlural, type MessageKey } from "../i18n/en.ts";

import type { ReportedResults, StepResultFields } from "./plan-state.ts";
import { adminPageHref } from "./screens.ts";

/** Build confirmation copy only from registered templates and structured arguments, never model prose. Display every step and argument. */

export interface StepArgumentLine {
  readonly name: string;
  readonly label: string;
  readonly value: string;

  readonly mono: boolean;

  /** The id this line replaced with a title, kept for support behind a disclosure. */
  readonly id: string | undefined;

  readonly fromStep: number | undefined;
}

const ARGUMENT_ORDER: readonly string[] = [
  "formId",
  "questionId",
  "slug",
  "definition",
  "defaultLocale",
  "workspaceId",
  "teamId",
  "userId",
  "email",
  "name",
  "role",
  "roles",
  "label",
  "environments",
  "forms",
  "requireSecondApprover",
  "version",
  "environment",
  "fromEnvironment",
  "linkId",
  "count",
  "expiresAt",
  "oneTime",
  "challengeRequired",
  "minSubmitMs",
  "sessionId",
  "reason",
  "webhookId",
  "deliveryId",
  "url",
  "active",
  "format",
  "shape",
  "from",
  "to",
];

const MONO_ARGUMENTS: ReadonlySet<string> = new Set([
  "formId",
  "questionId",
  "slug",
  "workspaceId",
  "teamId",
  "userId",
  "linkId",
  "sessionId",
  "webhookId",
  "deliveryId",
  "url",
  "version",
  "expiresAt",
]);

const ENVIRONMENT_ARGUMENT = "environment";

const LOCALE_ARGUMENT = "defaultLocale";

export interface StepReference {
  readonly fromStep: number;
  readonly field: string;
}

export function asReference(value: unknown): StepReference | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 2) return undefined;
  const { fromStep, field } = candidate;
  if (typeof fromStep !== "number" || !Number.isInteger(fromStep)) return undefined;
  return typeof field === "string" ? { fromStep, field } : undefined;
}

/** Unknown argument names remain visible instead of dropping part of what the operator confirms. */
function argumentLabel(name: string): string {
  return ARGUMENT_ORDER.includes(name) ? t(`agent.card.arg.${name}` as MessageKey) : name;
}

function scalarText(value: unknown): string {
  if (value === null) return t("agent.card.arg.unset");
  if (typeof value === "boolean") return t(value ? "agent.card.arg.yes" : "agent.card.arg.no");
  if (typeof value === "string" || typeof value === "number") return String(value);
  /** Render unexpected structured values rather than silently omitting confirmation arguments. */
  return JSON.stringify(value) ?? "";
}

function orderOf(name: string): number {
  const at = ARGUMENT_ORDER.indexOf(name);
  return at < 0 ? ARGUMENT_ORDER.length : at;
}

function referenceText(
  raw: unknown,
  reference: StepReference | undefined,
  resolved: unknown,
  name: string,
): string {
  if (reference === undefined) return vocabularyText(name, raw) ?? scalarText(raw);
  if (resolved !== undefined) return vocabularyText(name, resolved) ?? scalarText(resolved);
  return t("agent.card.usesStep", { field: reference.field, step: reference.fromStep + 1 });
}

const VOCABULARY_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  reason: ["subject_request", "retention_policy", "operator_error"],
};

function vocabularyText(name: string, raw: unknown): string | undefined {
  const words = VOCABULARY_ARGUMENTS[name];
  if (words === undefined || typeof raw !== "string") return undefined;
  return words.includes(raw)
    ? t(`ops.erase.reason.${raw}` as MessageKey)
    : t("ops.erase.reason.unknown", { reason: raw });
}

/** The arguments a card names by title; their ids are support detail rather than the subject. */
const NAMED_ID_ARGUMENTS: ReadonlySet<string> = new Set(["formId", "questionId", "workspaceId"]);

/** The arguments whose title the plan can work out for itself. */
const TITLED_ID_ARGUMENTS: readonly string[] = ["formId", "questionId"];

export function stepArguments(
  step: AgentPlanStep,
  reported: ReportedResults = {},
  names: PlanNames = EMPTY_NAMES,
): readonly StepArgumentLine[] {
  const ordered = Object.keys(step.args)
    .filter((name) => name !== ENVIRONMENT_ARGUMENT)
    .sort((left, right) => orderOf(left) - orderOf(right) || (left < right ? -1 : 1));

  return ordered.map((name) => {
    const raw = step.args[name];
    const reference = asReference(raw);
    const resolved =
      reference === undefined ? undefined : reported[reference.fromStep]?.[reference.field];
    const value = referenceText(raw, reference, resolved, name);
    const named = displayName(name, value, names);
    return {
      name,
      label: argumentLabel(name),
      value: named ?? value,
      mono: named === undefined && MONO_ARGUMENTS.has(name),
      id: named === undefined || !NAMED_ID_ARGUMENTS.has(name) ? undefined : value,
      ...(reference === undefined ? { fromStep: undefined } : { fromStep: reference.fromStep }),
    };
  });
}

function displayName(name: string, value: string, names: PlanNames): string | undefined {
  if (NAMED_ID_ARGUMENTS.has(name)) return names.byId.get(value);
  return name === LOCALE_ARGUMENT ? localeName(value) : undefined;
}

/** The language's own name, so a card says English rather than the tag an API argument carries. */
function localeName(tag: string): string | undefined {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    return name === tag ? undefined : name;
  } catch {
    // A tag the platform cannot parse is shown exactly as the step named it.
    return undefined;
  }
}

/** Titles the plan can supply for itself: what a step is about, and what each id stands for. */
export interface PlanNames {
  readonly byId: ReadonlyMap<string, string>;
  readonly byStep: ReadonlyMap<number, string>;
}

const EMPTY_NAMES: PlanNames = { byId: new Map(), byStep: new Map() };

const SUBJECT_FIELDS: readonly string[] = ["title", "label"];

/** A label or title may be authored per locale; any one of them names the thing better than an id. */
export function displayText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim();
  if (typeof value !== "object" || value === null) return undefined;
  for (const text of Object.values(value as Record<string, unknown>)) {
    if (typeof text === "string" && text.trim() !== "") return text.trim();
  }
  return undefined;
}

function textField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return displayText((value as Record<string, unknown>)[field]);
}

/** A step's own subject: the title of the form draft it carries, or the label of its question. */
function stepSubject(step: AgentPlanStep): string | undefined {
  for (const field of SUBJECT_FIELDS) {
    const found =
      textField(step.args["definition"], field) ?? textField(step.draft?.definition, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

function literalId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/**
 * A plan carries the titles of what it makes: the draft it saves names the form an earlier step
 * creates, and a question definition names the question. Collected here so no card shows an id
 * where the plan itself knows a title.
 */
export function planNames(
  proposal: {
    readonly steps: readonly AgentPlanStep[];
    readonly workspaces?: readonly { readonly workspaceId: string; readonly name: string }[];
  },
  /** Titles the screen already knows, such as the draft open in the builder. */
  known: ReadonlyMap<string, string> = new Map(),
): PlanNames {
  const byId = new Map(known);
  for (const entry of proposal.workspaces ?? []) byId.set(entry.workspaceId, entry.name);

  const byStep = new Map<number, string>();
  for (const [index, step] of proposal.steps.entries()) {
    const subject = stepSubject(step);
    if (subject !== undefined) byStep.set(index, subject);
  }

  for (const [index, subject] of byStep) {
    const step = proposal.steps[index];
    if (step !== undefined) recordSubject(step, subject, byId, byStep);
  }

  return { byId, byStep };
}

/** What this step calls its form or its question, and what it calls the step that makes one. */
function recordSubject(
  step: AgentPlanStep,
  subject: string,
  byId: Map<string, string>,
  byStep: Map<number, string>,
): void {
  for (const name of TITLED_ID_ARGUMENTS) {
    const raw = step.args[name];
    const id = literalId(raw);
    if (id !== undefined) byId.set(id, subject);
    const reference = asReference(raw);
    if (reference !== undefined && !byStep.has(reference.fromStep))
      byStep.set(reference.fromStep, subject);
  }
}

/**
 * The name the referenced step will produce. A title reads better as the thing being made than as
 * "step 1's formId", and the plan's own titles outrank the address it was asked for.
 */
function plannedName(
  reference: StepReference,
  steps: readonly AgentPlanStep[],
  names: PlanNames,
): string | undefined {
  const slug = steps[reference.fromStep]?.args["slug"];
  return (
    names.byStep.get(reference.fromStep) ??
    (typeof slug === "string" && slug !== "" ? slug : undefined)
  );
}

/** The title to call a form or a question by on this step, never its id. */
function subjectName(
  step: AgentPlanStep,
  index: number,
  argument: string,
  names: PlanNames,
  reported: ReportedResults,
): string | undefined {
  const raw = step.args[argument];
  const id = literalId(raw);
  if (id !== undefined) return names.byId.get(id);
  const reference = asReference(raw);
  if (reference !== undefined) {
    const planned = names.byStep.get(reference.fromStep);
    if (planned !== undefined) return planned;
    const resolved = reported[reference.fromStep]?.[reference.field];
    const found = literalId(resolved);
    if (found !== undefined) return names.byId.get(found);
  }
  return names.byStep.get(index);
}

const SUBJECTS: readonly (readonly [string, string, MessageKey])[] = [
  ["form", "formId", "agent.card.subject.form"],
  ["question", "questionId", "agent.card.subject.question"],
];

function titleParams(
  step: AgentPlanStep,
  reported: ReportedResults,
  steps: readonly AgentPlanStep[],
  names: PlanNames,
): Record<string, string> {
  const params: Record<string, string> = { environment: step.environment };
  for (const line of stepArguments(step, reported)) {
    const reference = asReference(step.args[line.name]);
    const resolved =
      reference === undefined ? undefined : reported[reference.fromStep]?.[reference.field];

    params[line.name] =
      reference === undefined || resolved !== undefined
        ? line.value
        : (plannedName(reference, steps, names) ??
          t("agent.card.fromStepShort", { field: reference.field, step: reference.fromStep + 1 }));
  }

  const index = steps.indexOf(step);
  const address = step.args["slug"];
  for (const [param, argument, fallback] of SUBJECTS) {
    params[param] =
      subjectName(step, index, argument, names, reported) ??
      (typeof address === "string" && address !== "" ? address : t(fallback));
  }
  return params;
}

/** Title templates whose subject is counted, so the card reads "1 test link" rather than "1 links". */
const PLURAL_TITLES: Readonly<Record<string, readonly [MessageKey, MessageKey]>> = {
  "agent.card.link.mint.title": [
    "agent.card.link.mint.title.one",
    "agent.card.link.mint.title.other",
  ],
  "agent.card.link.mint.title.prod": [
    "agent.card.link.mint.title.prod.one",
    "agent.card.link.mint.title.prod.other",
  ],
};

/* A link minted outside production is for trying a form out; one minted in production is for the people
   answering it. Which environment that is stays on the step's own environment line. */
const PRODUCTION_TITLES: Readonly<Record<string, MessageKey>> = {
  "agent.card.link.mint.title": "agent.card.link.mint.title.prod",
};

export function stepTitle(
  step: AgentPlanStep,
  reported: ReportedResults = {},
  steps: readonly AgentPlanStep[] = [],
  names: PlanNames = EMPTY_NAMES,
): string {
  const params = titleParams(step, reported, steps, names);
  const key =
    (isProductionStep(step) ? PRODUCTION_TITLES[step.card.titleKey] : undefined) ??
    step.card.titleKey;
  const plural = PLURAL_TITLES[key];
  const count = step.args["count"];
  return plural !== undefined && typeof count === "number"
    ? tPlural(plural[0], plural[1], count, params)
    : t(key as MessageKey, params);
}

/** The subject of a whole plan: the form it creates, or whatever its first step is about. */
export function planTitleSubject(
  steps: readonly AgentPlanStep[],
  reported: ReportedResults,
  names: PlanNames,
): string {
  const leading = steps.find((step) => step.kind === "form.create") ?? steps[0];
  return leading === undefined ? "" : stepTitle(leading, reported, steps, names);
}

export function stepConsequences(step: AgentPlanStep): readonly string[] {
  return step.card.consequenceKeys
    .filter((key) => key !== "agent.card.environment.production")
    .map((key) => t(key as MessageKey, { environment: step.environment }));
}

/** Derive irreversible gates from registered step templates so callers cannot omit them. Matching is trimmed and case-sensitive, like the screen dialog. */
export function typedConfirmation(steps: readonly AgentPlanStep[]): string | undefined {
  for (const step of steps) {
    const argument = step.card.typedConfirmation;
    if (argument === undefined) continue;
    const value = step.args[argument];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

export function isTypedConfirmed(typed: string, required: string | undefined): boolean {
  return required === undefined || typed.trim() === required;
}

export function hasIrreversibleStep(steps: readonly AgentPlanStep[]): boolean {
  return steps.some((step) => step.card.typedConfirmation !== undefined);
}

export function isProductionStep(step: AgentPlanStep): boolean {
  return step.environment === PROD_ENVIRONMENT;
}

export function productionSentence(): string {
  return t("agent.card.environment.production");
}

/** Allow only served page routes; a model link must never turn a download handler into a browser fetch. */
export function createdHref(
  step: AgentPlanStep,
  result: StepResultFields | undefined,
): string | undefined {
  const link = step.card.createdLink;
  if (link === undefined || result === undefined) return undefined;
  const id = result[link.field];
  if (typeof id !== "string" || id === "") return undefined;
  const path = link.screen
    .split("/")
    .map((segment) => (segment.startsWith("[") ? encodeURIComponent(id) : segment))
    .join("/");
  return adminPageHref(path);
}

export function minutesLeft(remainingMs: number): number {
  if (!Number.isFinite(remainingMs)) return 0;
  return Math.max(0, Math.floor(remainingMs / 60_000));
}
