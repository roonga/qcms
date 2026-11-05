import type { AgentPlanStep } from "../forms/assist-stream.ts";
import { PROD_ENVIRONMENT } from "../environment.ts";
import { t, type MessageKey } from "../i18n/en.ts";

import type { ReportedResults, StepResultFields } from "./plan-state.ts";
import { adminPageHref } from "./screens.ts";

/** Build confirmation copy only from registered templates and structured arguments, never model prose. Display every step and argument. */

export interface StepArgumentLine {
  readonly name: string;
  readonly label: string;
  readonly value: string;

  readonly mono: boolean;

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
  "label",
  "environments",
  "forms",
  "requireSecondApprover",
  "seedNewEditorsWithTestData",
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

export function stepArguments(
  step: AgentPlanStep,
  reported: ReportedResults = {},
  /** Workspace names the proposal carried, so a card names one rather than showing its id. */
  workspaces: ReadonlyMap<string, string> = new Map(),
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
    const named = name === "workspaceId" ? workspaces.get(value) : undefined;
    return {
      name,
      label: argumentLabel(name),
      value: named ?? value,
      mono: named === undefined && MONO_ARGUMENTS.has(name),
      ...(reference === undefined ? { fromStep: undefined } : { fromStep: reference.fromStep }),
    };
  });
}

function titleParams(step: AgentPlanStep, reported: ReportedResults): Record<string, string> {
  const params: Record<string, string> = { environment: step.environment };
  for (const line of stepArguments(step, reported)) {
    const reference = asReference(step.args[line.name]);
    const resolved =
      reference === undefined ? undefined : reported[reference.fromStep]?.[reference.field];

    params[line.name] =
      reference === undefined || resolved !== undefined
        ? line.value
        : t("agent.card.fromStepShort", { field: reference.field, step: reference.fromStep + 1 });
  }
  return params;
}

/** The proposal's own workspace names, keyed by id. */
export function workspaceNames(proposal: {
  readonly workspaces?: readonly { readonly workspaceId: string; readonly name: string }[];
}): ReadonlyMap<string, string> {
  return new Map((proposal.workspaces ?? []).map((entry) => [entry.workspaceId, entry.name]));
}

export function stepTitle(step: AgentPlanStep, reported: ReportedResults = {}): string {
  return t(step.card.titleKey as MessageKey, titleParams(step, reported));
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
