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
 */

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
