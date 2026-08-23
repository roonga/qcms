/**
 * Rendering a stored answer value as text (task 035).
 *
 * The values are the canonical encodings the reporting view froze (015): a string, a
 * number, a boolean, or an array of option ids. This app cannot narrow them with the
 * kernel (R2), so the rendering is structural and total - every shape produces
 * something readable, and nothing throws on a value a future question type
 * introduces.
 *
 * Option ids are shown as ids on purpose. The stored value of a choice answer is the
 * option id, and resolving it to the option's label would need the pinned question's
 * option list; where that resolution is available the caller does it, and where it is
 * not, an id is the truthful thing to show (same rule as `labels.ts`).
 *
 * Since issue 515 this module also owns the **list-row preview**: the same rendering,
 * bounded, for the browser table's sixth column. The bound is a privacy rule and is
 * documented as one on the two constants below.
 */

import { t } from "../i18n/en.ts";
import { orderedAnswerKeys } from "./labels.ts";

/** The separator between the option ids of a multi-choice answer, matching the CSV export. */
const MULTI_SEPARATOR = "; ";

/**
 * One canonical answer value as display text, or `null` when there is no value.
 *
 * `null` is distinct from `""`: a question can be answered with an empty string,
 * while an absent or retracted answer has no value at all, and the two must not
 * render the same way. The caller supplies the words for the second case.
 */
export function answerText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? null : value.map((entry) => String(entry)).join(MULTI_SEPARATOR);
  }
  // No canonical answer is a plain object. Render it rather than dropping it: an
  // unexpected shape in an audit view is information, and hiding it would not be.
  return JSON.stringify(value);
}

/**
 * How many answered questions the list-row preview shows (issue 515).
 *
 * Two, and the number is a privacy budget rather than a layout one. The preview
 * column is a scan aid - "is this the submission I am looking for" - and not a
 * readout: reading a response is the detail screen's job, and opening it is the
 * authorised, audited act. One pair cannot separate two similar submissions; three
 * or more start to make a 25-row page a bulk readout of respondent answers that an
 * operator never asked to see and a passer-by can read over their shoulder.
 */
export const PREVIEW_ENTRIES = 2;

/**
 * How many characters of one respondent-entered value a preview may show.
 *
 * Enough for an option id, a number, a date or a short choice; short enough that a
 * sentence of free text is cut mid-clause rather than delivered whole. Combined with
 * {@link PREVIEW_ENTRIES} it bounds any one row to about fifty characters of
 * respondent-entered text, whatever the answers actually contain.
 *
 * The clip happens **here**, on the string that becomes the cell's text, so the full
 * value never reaches the markup at all. That is the reason this column carries no
 * `title` tooltip holding the untruncated answer: a tooltip would put the whole thing
 * back into the DOM and make the budget above cosmetic.
 */
export const PREVIEW_VALUE_CHARS = 24;

/** One question and its clipped value, as a list-row preview shows them. */
export interface PreviewEntry {
  /**
   * The question, as the list can honestly name it.
   *
   * The list payload carries answers keyed by question id and no labels: resolving a
   * label needs the pins of the row's own form version (`labels.ts`), and a page mixes
   * versions. An id is the truthful thing to show where the resolution is unavailable,
   * which is exactly the rule the detail screen's caption already follows.
   */
  readonly questionId: string;
  /** The value as text, already clipped to {@link PREVIEW_VALUE_CHARS}. */
  readonly value: string;
  /** Whether the clip removed anything, so the caller adds the ellipsis affordance. */
  readonly clipped: boolean;
}

/** What a list row shows in its answer-preview cell. */
export interface AnswerPreview {
  readonly entries: readonly PreviewEntry[];
  /** Answered questions beyond {@link entries}, which the caller marks as "more". */
  readonly hidden: number;
}

/**
 * The preview of one response's answers, for the browser table's sixth column
 * (issue 515).
 *
 * Deterministic by construction: keys are ordered by {@link orderedAnswerKeys} with no
 * pins, which sorts by id, so the same stored answers preview the same way on every
 * render and between rows. Object key order out of a JSON payload is not something to
 * rest a rendered column on.
 *
 * A question present in the map but carrying no value (`null`, an absent value, an
 * empty multi-choice - everything {@link answerText} answers `null` for) is skipped
 * rather than previewed as a blank: a preview exists to show what was answered, and a
 * slot spent on a non-answer is a slot the next real one could have had. Those
 * questions are not counted in `hidden` either, for the same reason.
 */
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

/**
 * The exact text a browser-table row shows in its answer-preview cell.
 *
 * The words live here rather than in the component so that every branch, the
 * no-answers one included, is reachable without a browser. The cell is a client
 * component inside a client component, and the state that matters most to get right -
 * a submitted response holding no answers - is not reachable through the seeded forms
 * either (their first question is required, so an empty submission is a 422). This is
 * the highest layer that can assert all of it, which is the argument
 * `app/(shell)/forms-list-states.test.tsx` makes for its own case.
 *
 * Every part is a catalog key (ADR-27): the pair template, the separator, the clip
 * marker, the more-answers marker and the empty sentence. A locale that punctuates a
 * list differently changes `en.ts` and nothing else. `../i18n/en.ts` is the same
 * import `lib/ops/unexpected.ts` already makes from this directory.
 */
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
