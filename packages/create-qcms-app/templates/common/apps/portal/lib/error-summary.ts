import type { A2UIErrors, A2UIStepDocument } from "@roonga/qcms-ui";

import { t } from "./i18n/en";
import { authorMessageFor } from "./validation-message";
import { instanceLabels, messagesOf, questionLabels, questionPositions } from "./visible";

export interface ErrorSummaryEntry {
  /** The anchor target is `#<questionId>`. */
  readonly questionId: string;
  /** The link text, and therefore its accessible name. */
  readonly message: string;
}

/**
 * `body` is returned unchanged only when the question has no position either, which
 * means it is in neither the document nor the visible set, and no caller can reach that.
 */
function unlabelledMessage(position: number | undefined, body: string): string {
  if (position === undefined) return body;
  return t("errorSummary.positional", { position, message: body });
}

/**
 * Prefixes an entry with its instance's label inside a repeating group, without which a
 * three-instance step draws the same sentence three times. The identity for a step with
 * no group.
 */
function withInstance(
  instances: ReadonlyMap<string, string>,
  field: string,
  message: string,
): string {
  const instance = instances.get(field);
  if (instance === undefined) return message;
  return t("errorSummary.inInstance", { instance, message });
}

/**
 * The hydrated flow's summary, in `missing`'s order, which is the API's set in document
 * order, so the links read in the same order as the fields. `visibleQuestions` is only
 * ever read for the ordinal a label-less entry is named by (R2).
 */
export function missingRequiredEntries(
  document: A2UIStepDocument | null,
  missing: readonly string[],
  visibleQuestions: readonly string[],
): readonly ErrorSummaryEntry[] {
  if (missing.length === 0) return [];
  const labels = document === null ? undefined : questionLabels(document);
  const messages = messagesOf(document);
  const positions = questionPositions(document, visibleQuestions);
  const instances = instanceLabels(document);
  return missing.map((questionId) => {
    const label = labels?.get(questionId);
    const authored = authorMessageFor(messages.get(questionId), "required");
    let message: string;
    if (label === undefined) {
      message = unlabelledMessage(
        positions.get(questionId),
        authored ?? t("errorSummary.missingRequired"),
      );
    } else if (authored === undefined) {
      message = t("errorSummary.missingRequiredNamed", { label });
    } else {
      message = t("errorSummary.namedCustom", { label, message: authored });
    }
    return { questionId, message: withInstance(instances, questionId, message) };
  });
}

/**
 * The no-JS re-render's summary, in the order the route recorded the refusals. The
 * per-field message is already resolved by the time it gets here, so this only has to
 * make each entry name its own question.
 */
export function errorSummaryEntries(
  document: A2UIStepDocument | null,
  errors: A2UIErrors,
  visibleQuestions: readonly string[],
): readonly ErrorSummaryEntry[] {
  const entries = Object.entries(errors).filter(([, message]) => message !== undefined);
  if (entries.length === 0) return [];
  const labels = document === null ? undefined : questionLabels(document);
  const positions = questionPositions(document, visibleQuestions);
  const instances = instanceLabels(document);
  return entries.map(([questionId, message]) => {
    const label = labels?.get(questionId);
    const body = message as string;
    const named =
      label === undefined
        ? unlabelledMessage(positions.get(questionId), body)
        : t("errorSummary.namedCustom", { label, message: body });
    return { questionId, message: withInstance(instances, questionId, named) };
  });
}

export function missingOnStep(
  missingRequired: readonly string[],
  visibleQuestions: readonly string[],
  errors: A2UIErrors,
): readonly string[] {
  if (missingRequired.length === 0) return [];
  const visible = new Set(visibleQuestions);
  return [...new Set(missingRequired)].filter(
    (questionId) => visible.has(questionId) && !Object.hasOwn(errors, questionId),
  );
}

export function requiredFieldErrors(
  document: A2UIStepDocument | null,
  missing: readonly string[],
): Readonly<Record<string, string>> {
  const messages = messagesOf(document);
  const resolved: Record<string, string> = {};
  for (const questionId of missing) {
    resolved[questionId] =
      authorMessageFor(messages.get(questionId), "required") ?? t("errorSummary.missingRequired");
  }
  return resolved;
}

export function orderedEntries(
  entries: readonly ErrorSummaryEntry[],
  visibleQuestions: readonly string[],
): readonly ErrorSummaryEntry[] {
  const order = new Map(visibleQuestions.map((questionId, index) => [questionId, index]));
  return entries
    .map((entry, index) => ({ entry, index, rank: order.get(entry.questionId) ?? order.size }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.entry);
}

/**
 * The hydrated flow keeps every refusal for the whole session, so a refusal on a step
 * the respondent has left, or on a question a branch has since hidden, is not on screen
 * and must neither block Continue nor appear in the summary.
 */
export function refusalsOnStep(
  errors: A2UIErrors,
  visibleQuestions: readonly string[],
): A2UIErrors {
  const visible = new Set(visibleQuestions);
  const narrowed: Record<string, string> = {};
  for (const [questionId, message] of Object.entries(errors)) {
    if (message !== undefined && visible.has(questionId)) narrowed[questionId] = message;
  }
  return narrowed;
}

/**
 * The whole summary for one step, as both portal paths draw it. `missing` is already
 * narrowed by the caller, so a refused question is reported once, with the kernel's
 * message about the value it refused rather than "needs an answer".
 */
export function stepSummaryEntries(
  document: A2UIStepDocument | null,
  refused: A2UIErrors,
  missing: readonly string[],
  visibleQuestions: readonly string[],
): readonly ErrorSummaryEntry[] {
  return orderedEntries(
    [
      ...errorSummaryEntries(document, refused, visibleQuestions),
      ...missingRequiredEntries(document, missing, visibleQuestions),
    ],
    visibleQuestions,
  );
}
