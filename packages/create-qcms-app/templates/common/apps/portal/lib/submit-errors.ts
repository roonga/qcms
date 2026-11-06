import type { A2UIErrors, A2UIStepDocument } from "@roonga/qcms-ui";
import { INSTANCE_NAME_SEPARATOR } from "@roonga/qcms-ui/repeat-node";

import { t } from "./i18n/en";
import { authorMessageFor, defaultAnswerMessage, firstAnswerRejection } from "./validation-message";
import { messagesOf } from "./visible";

/**
 * One field's refusal: the constraint it failed plus the message to fall back to. The
 * author's message is resolved later, on the step that renders the field, because those
 * messages ride on that step's compiled document (ADR-32).
 */
export interface FieldRefusal {
  readonly constraint?: string | undefined;
  readonly message: string;
}

/** Keyed as the API keys an answer: `questionId`, or `instanceId/questionId` in a group. */
export type FieldRefusals = Readonly<Record<string, FieldRefusal | undefined>>;

/**
 * What a refused submit says about individual questions, split the way both portal paths
 * already draw a step: an unanswered required question reads "needs an answer", a refused
 * value carries the kernel's own sentence.
 */
export interface SubmitRefusal {
  readonly missingRequired: readonly string[];
  readonly invalid: FieldRefusals;
}

export const NO_SUBMIT_REFUSAL: SubmitRefusal = Object.freeze({
  missingRequired: Object.freeze([]),
  invalid: Object.freeze({}),
});

function fieldKey(questionId: string, instanceId: unknown): string {
  return typeof instanceId === "string" && instanceId !== ""
    ? `${instanceId}${INSTANCE_NAME_SEPARATOR}${questionId}`
    : questionId;
}

/**
 * Reads the submit slice's 422 detail. Total over unknown input, because the detail
 * crosses the BFF boundary untyped and a malformed one must cost the respondent nothing
 * beyond the per-question messages. A count refusal and an answer naming no question in
 * the form have no field to report against and are left to the page-level notice.
 */
export function submitRefusal(details: unknown): SubmitRefusal {
  if (typeof details !== "object" || details === null) return NO_SUBMIT_REFUSAL;
  const entries = (details as { errors?: unknown }).errors;
  if (!Array.isArray(entries)) return NO_SUBMIT_REFUSAL;
  const missingRequired: string[] = [];
  const invalid: Record<string, FieldRefusal> = {};
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { code, questionId, instanceId } = entry as {
      code?: unknown;
      questionId?: unknown;
      instanceId?: unknown;
    };
    if (typeof questionId !== "string" || questionId === "") continue;
    const field = fieldKey(questionId, instanceId);
    if (code === "MISSING_REQUIRED") {
      missingRequired.push(field);
      continue;
    }
    if (code !== "INVALID_ANSWER") continue;
    const rejection = firstAnswerRejection(entry);
    invalid[field] = {
      constraint: rejection?.constraint,
      message: defaultAnswerMessage(rejection, t("answer.invalid")),
    };
  }
  return { missingRequired, invalid };
}

/**
 * Drops one field, which is how a refusal stops being true: the respondent has changed
 * that answer, so the sweep's verdict on it is about a value the server no longer holds.
 * Unchanged input is returned as is, so an edit elsewhere re-renders nothing.
 */
export function withoutField(refusal: SubmitRefusal, field: string): SubmitRefusal {
  const missing = refusal.missingRequired.includes(field);
  const invalid = refusal.invalid[field] !== undefined;
  if (!missing && !invalid) return refusal;
  const remaining = { ...refusal.invalid };
  delete remaining[field];
  return {
    missingRequired: refusal.missingRequired.filter((entry) => entry !== field),
    invalid: remaining,
  };
}

/** Every field the refusal names, for the per-step split. */
export function refusedFields(refusal: SubmitRefusal): readonly string[] {
  return [...refusal.missingRequired, ...Object.keys(refusal.invalid)];
}

/** The no-JS re-render context's two parallel records, as one refusal per field. */
export function contextRefusals(
  errors: Readonly<Record<string, string>>,
  constraints: Readonly<Record<string, string>>,
): FieldRefusals {
  const refusals: Record<string, FieldRefusal> = {};
  for (const [field, message] of Object.entries(errors)) {
    refusals[field] = { constraint: constraints[field], message };
  }
  return refusals;
}

/**
 * The messages to draw beside the fields of one step: the author's message for the
 * constraint that failed where there is one, else the message the refusal carried. A
 * refusal naming a question this step does not render is dropped, which is what keeps a
 * refusal about another step, or about a question a branch has since hidden, off it.
 */
export function authoredFieldErrors(
  document: A2UIStepDocument | null,
  refusals: FieldRefusals,
  visibleQuestions: readonly string[],
): A2UIErrors {
  const visible = new Set(visibleQuestions);
  const messages = messagesOf(document);
  const resolved: Record<string, string> = {};
  for (const [field, refusal] of Object.entries(refusals)) {
    if (refusal === undefined || !visible.has(field)) continue;
    resolved[field] = authorMessageFor(messages.get(field), refusal.constraint) ?? refusal.message;
  }
  return resolved;
}

/** One line of the summary for a step the respondent is not on. */
export interface OtherStepErrors {
  /**
   * Where this client last rendered the field, which is the cursor it can navigate to.
   * `undefined` when it has never rendered it, and then the first incomplete step is the
   * only honest target.
   */
  readonly stepIndex: number | undefined;
  readonly count: number;
}

/**
 * Groups the refused fields that are not on the rendered step by the step they were last
 * seen on, lowest cursor first, so the summary can say which steps still need attention
 * and move the respondent to one.
 */
export function otherStepErrors(
  fields: readonly string[],
  visibleQuestions: readonly string[],
  stepOfField: ReadonlyMap<string, number>,
): readonly OtherStepErrors[] {
  const visible = new Set(visibleQuestions);
  const counts = new Map<number, number>();
  let unknown = 0;
  for (const field of new Set(fields)) {
    if (visible.has(field)) continue;
    const stepIndex = stepOfField.get(field);
    if (stepIndex === undefined) {
      unknown += 1;
      continue;
    }
    counts.set(stepIndex, (counts.get(stepIndex) ?? 0) + 1);
  }
  const grouped: OtherStepErrors[] = [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([stepIndex, count]) => ({ stepIndex, count }));
  if (unknown > 0) grouped.push({ stepIndex: undefined, count: unknown });
  return grouped;
}

/** The sentence for one such line; `stepIndex` is a 0-based cursor and reads as 1-based. */
export function otherStepMessage(entry: OtherStepErrors): string {
  if (entry.stepIndex === undefined) {
    return entry.count === 1
      ? t("errorSummary.onAnotherStep.one")
      : t("errorSummary.onAnotherStep.other", { count: entry.count });
  }
  const step = entry.stepIndex + 1;
  return entry.count === 1
    ? t("errorSummary.onStep.one", { step })
    : t("errorSummary.onStep.other", { step, count: entry.count });
}
