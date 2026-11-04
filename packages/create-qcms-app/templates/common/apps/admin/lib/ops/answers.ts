/** Render canonical stored values structurally; unresolved choice IDs stay IDs rather than guessed labels. */

import { t } from "../i18n/en.ts";
import { orderedAnswerKeys } from "./labels.ts";

const MULTI_SEPARATOR = "; ";

/** Null means no answer; an answered empty string is distinct and must not render the same way. */
export function answerText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? null : value.map((entry) => String(entry)).join(MULTI_SEPARATOR);
  }

  return JSON.stringify(value);
}

/** Two preview entries are a privacy budget, not a layout limit. Full response reading belongs to the authorized, audited detail screen. */
export const PREVIEW_ENTRIES = 2;

/** Clip before markup and never add a full-value tooltip; otherwise the privacy budget would be cosmetic. */
export const PREVIEW_VALUE_CHARS = 24;

export interface PreviewEntry {
  /** A mixed-version list has no reliable current label; show the stored question ID unless the row pinned version is resolved. */
  readonly questionId: string;

  readonly value: string;

  readonly clipped: boolean;
}

export interface AnswerPreview {
  readonly entries: readonly PreviewEntry[];

  readonly hidden: number;
}

/** Use stable ID order when no pins are available; skip non-answers rather than spending preview privacy budget on blanks. */
export function answerPreview(answers: Readonly<Record<string, unknown>>): AnswerPreview {
  const entries: PreviewEntry[] = [];
  let answered = 0;
  for (const questionId of orderedAnswerKeys(answers, [])) {
    const text = answerText(answers[questionId]);
    if (text === null) continue;
    answered += 1;
    if (entries.length >= PREVIEW_ENTRIES) continue;
    entries.push({
      questionId,
      value: text.slice(0, PREVIEW_VALUE_CHARS),
      clipped: text.length > PREVIEW_VALUE_CHARS,
    });
  }
  return { entries, hidden: answered - entries.length };
}

/** Keep every separator and clipping marker in catalog templates so localization never depends on component punctuation. */
export function answerPreviewText(answers: Readonly<Record<string, unknown>>): string {
  const { entries, hidden } = answerPreview(answers);
  if (entries.length === 0) return t("ops.responses.preview.none");

  const parts = entries.map((entry) =>
    t("ops.responses.preview.pair", {
      question: entry.questionId,
      value: entry.clipped
        ? t("ops.responses.preview.clipped", { value: entry.value })
        : entry.value,
    }),
  );
  if (hidden > 0) parts.push(t("ops.responses.preview.more"));
  return parts.join(t("ops.responses.preview.separator"));
}
