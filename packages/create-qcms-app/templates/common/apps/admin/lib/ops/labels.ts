import { textOf } from "../questions/definition.ts";
import type { QuestionDetail } from "../questions/types.ts";

/**
 * Resolving a question's label **as the respondent saw it** (task 035).
 *
 * The response detail lists answers keyed by `questionId`, and an operator reading a
 * submission needs the wording the respondent was actually shown. That is not the
 * question's current label: a form version pins each question at a specific question
 * version (R1, R6), and the label may have been rewritten since. So the resolution
 * runs through the pin, never through "the latest version of this question".
 *
 * Getting this wrong is not a cosmetic bug. It would caption a stored answer with a
 * question that was never asked, which is exactly the kind of quiet falsehood an
 * audit view exists to rule out. When the pinned version cannot be resolved the
 * screen shows the raw `questionId` instead of guessing - an id is honest, a wrong
 * label is not.
 */

/** One question pinned by a form version: which question, at which version. */
export interface QuestionPin {
  readonly questionId: string;
  readonly version: number;
}

/**
 * The pins of a published form version, read out of its frozen `definition`.
 *
 * `definition` arrives as `unknown` because this app never parses a form definition
 * with the kernel (R2/R3: no `@qcms/core` value import). Only the two fields the
 * caption needs are read, and anything structurally unexpected yields no pins rather
 * than a throw: a detail view that renders ids beats one that will not open.
 */
export function pinsOf(definition: unknown): readonly QuestionPin[] {
  const steps = (definition as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  const pins: QuestionPin[] = [];
  for (const step of steps) {
    const items = (step as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const pin = item as { questionId?: unknown; version?: unknown } | null;
      if (typeof pin?.questionId !== "string") continue;
      if (typeof pin.version !== "number") continue;
      pins.push({ questionId: pin.questionId, version: pin.version });
    }
  }
  return pins;
}

/**
 * Build `questionId -> label` from the pins and the question details behind them.
 *
 * A pin whose question or whose pinned version is missing from `details` contributes
 * nothing, so {@link labelFor} falls back to the id for it. `details` may contain
 * questions that are not pinned; they are ignored.
 */
export function labelsForPins(
  pins: readonly QuestionPin[],
  details: readonly QuestionDetail[],
): ReadonlyMap<string, string> {
  const byId = new Map(details.map((detail) => [detail.questionId, detail]));
  const labels = new Map<string, string>();
  for (const pin of pins) {
    const version = byId
      .get(pin.questionId)
      ?.versions.find((candidate) => candidate.version === pin.version);
    if (version === undefined) continue;
    const label = textOf(version.definition.label);
    if (label !== "") labels.set(pin.questionId, label);
  }
  return labels;
}

/** The label for one question, or its id when the pinned label could not be resolved. */
export function labelFor(labels: ReadonlyMap<string, string>, questionId: string): string {
  return labels.get(questionId) ?? questionId;
}

/**
 * Order the answer keys the way the form version presents them.
 *
 * Document order (steps, then items) is the order the respondent met the questions
 * in, so it is the order the locked-answer list reads in. An answer whose question is
 * not pinned by this version - which a version change can leave behind in an older
 * session's stored set - is appended afterwards rather than dropped, sorted by id so
 * the tail is stable between renders.
 */
export function orderedAnswerKeys(
  answers: Readonly<Record<string, unknown>>,
  pins: readonly QuestionPin[],
): readonly string[] {
  const present = new Set(Object.keys(answers));
  const ordered: string[] = [];
  for (const pin of pins) {
    if (!present.has(pin.questionId)) continue;
    if (ordered.includes(pin.questionId)) continue;
    ordered.push(pin.questionId);
  }
  const rest = [...present]
    .filter((id) => !ordered.includes(id))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
}
