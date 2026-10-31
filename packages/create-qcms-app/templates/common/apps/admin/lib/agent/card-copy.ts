import type { AgentPlanStep } from "../forms/assist-stream.ts";
import { PROD_ENVIRONMENT } from "../environment.ts";
import { t, type MessageKey } from "../i18n/en.ts";

import type { ReportedResults } from "./plan-state.ts";

/**
 * What one step of a card says, from the step's kind, its structured arguments and the
 * catalog. This module takes no model input at all, so nothing the model wrote can reach
 * a title, an argument label or a consequence sentence, and no argument or step can be
 * collapsed out of what the user confirms.
 */

export interface StepArgumentLine {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  /** An id, a URL, a hash or a version, which the card sets in the mono face. */
  readonly mono: boolean;
  /** Set when the value comes from an earlier step's result rather than the plan. */
  readonly fromStep: number | undefined;
}

/**
 * The order arguments read in. It is fixed rather than the order the model happened to
 * write them, so the same step always reads the same way.
 */
const ARGUMENT_ORDER: readonly string[] = [
  "formId",
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
];

const MONO_ARGUMENTS: ReadonlySet<string> = new Set([
  "formId",
  "linkId",
  "sessionId",
  "webhookId",
  "deliveryId",
  "url",
  "version",
  "expiresAt",
]);

/** The environment is its own line, with the chip and the production sentence on it. */
const ENVIRONMENT_ARGUMENT = "environment";

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

/**
 * The catalog has a label for every argument the registered kinds take. An argument a
 * future kind adds reads as its own field name rather than throwing at render time, which
 * still shows it: card rule 2 forbids dropping one.
 */
function argumentLabel(name: string): string {
  return ARGUMENT_ORDER.includes(name) ? t(`agent.card.arg.${name}` as MessageKey) : name;
}

function scalarText(value: unknown): string {
  // `null` is a value rather than an omission: it means the deployment's own setting.
  if (value === null) return t("agent.card.arg.unset");
  if (typeof value === "boolean") return t(value ? "agent.card.arg.yes" : "agent.card.arg.no");
  if (typeof value === "string" || typeof value === "number") return String(value);
  // Never reached for a D0 kind, whose arguments are all scalars; written out rather than
  // dropped, because a dropped argument is the one thing card rule 2 forbids.
  return JSON.stringify(value) ?? "";
}

function orderOf(name: string): number {
  const at = ARGUMENT_ORDER.indexOf(name);
  return at < 0 ? ARGUMENT_ORDER.length : at;
}

/**
 * A plain argument as it reads, a resolved reference as the value that ran, and an
 * unresolved one as the words card rule 2 asks for.
 */
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

/**
 * Arguments whose value is one word of a closed vocabulary. The card shows the word the
 * screen's own dialog shows, so an operator reads the same reason on both.
 */
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

/**
 * Every argument of one step, in run order, with a reference shown as the words the rule
 * asks for rather than as a resolved value the user was never shown.
 */
export function stepArguments(
  step: AgentPlanStep,
  reported: ReportedResults = {},
): readonly StepArgumentLine[] {
  const names = Object.keys(step.args)
    .filter((name) => name !== ENVIRONMENT_ARGUMENT)
    .sort((left, right) => orderOf(left) - orderOf(right) || (left < right ? -1 : 1));

  return names.map((name) => {
    const raw = step.args[name];
    const reference = asReference(raw);
    const resolved =
      reference === undefined ? undefined : reported[reference.fromStep]?.[reference.field];
    const value = referenceText(raw, reference, resolved, name);
    return {
      name,
      label: argumentLabel(name),
      value,
      mono: MONO_ARGUMENTS.has(name),
      ...(reference === undefined ? { fromStep: undefined } : { fromStep: reference.fromStep }),
    };
  });
}

/** The arguments a title template may substitute, as text. */
function titleParams(step: AgentPlanStep, reported: ReportedResults): Record<string, string> {
  const params: Record<string, string> = { environment: step.environment };
  for (const line of stepArguments(step, reported)) {
    const reference = asReference(step.args[line.name]);
    const resolved =
      reference === undefined ? undefined : reported[reference.fromStep]?.[reference.field];
    // A title is one sentence, so a reference nothing has resolved yet reads as the short
    // form there and as the full sentence on its own argument line.
    params[line.name] =
      reference === undefined || resolved !== undefined
        ? line.value
        : t("agent.card.fromStepShort", { field: reference.field, step: reference.fromStep + 1 });
  }
  return params;
}

/** The step's title, written by the admin from the kind's own template. */
export function stepTitle(step: AgentPlanStep, reported: ReportedResults = {}): string {
  return t(step.card.titleKey as MessageKey, titleParams(step, reported));
}

/** The screen dialog's own consequence sentences for this step, in order. */
export function stepConsequences(step: AgentPlanStep): readonly string[] {
  return step.card.consequenceKeys
    .filter((key) => key !== "agent.card.environment.production")
    .map((key) => t(key as MessageKey, { environment: step.environment }));
}

/**
 * What the card asks the user to retype before Confirm, taken from the steps' own card
 * templates rather than from the caller, so a plan carrying an irreversible step cannot be
 * rendered without its gate. The match is exact after trimming and case-sensitive, which is
 * the screen's own rule: a card weaker than the dialog it mirrors is the thing card rule 3
 * forbids.
 */
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

/** A card whose steps include one with no inverse carries its own band, once. */
export function hasIrreversibleStep(steps: readonly AgentPlanStep[]): boolean {
  return steps.some((step) => step.card.typedConfirmation !== undefined);
}

/** A production step carries the production band, inline on its environment line. */
export function isProductionStep(step: AgentPlanStep): boolean {
  return step.environment === PROD_ENVIRONMENT;
}

export function productionSentence(): string {
  return t("agent.card.environment.production");
}

/** Whole minutes left before the card expires, floored, and never below zero. */
export function minutesLeft(expiresAt: string, now: number): number {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((at - now) / 60_000));
}
