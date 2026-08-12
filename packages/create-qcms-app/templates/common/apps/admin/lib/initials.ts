/**
 * The two letters painted into the topbar's account disc (task 032).
 *
 * A module of its own rather than a helper inside `components/account-menu.tsx`, for one
 * reason: it is the only piece of that component with a contract worth testing, and the
 * component is a `"use client"` module whose import graph reaches
 * `react-aria-components`. Pulling that graph into a unit test to exercise a pure string
 * function is the wrong trade, and this app's Vitest project resolves relative imports
 * only, so `lib/` is where its testable logic already lives (`lib/questions/*`).
 */

/**
 * Segments by grapheme cluster - what a reader calls "a character".
 *
 * Built once at module scope because constructing a `Segmenter` is the expensive part and
 * the result is stateless. The default locale is deliberate: cluster boundaries are
 * essentially locale-independent, and the disc has no locale of its own to pass.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The first `count` user-perceived characters of `source`.
 *
 * `source[0]` and `source.slice(0, 2)` both count UTF-16 CODE UNITS, which is the wrong
 * unit for this. An astral character (any emoji, and every CJK extension-B ideograph) is
 * two code units, so indexing one of them yields half a surrogate pair - a lone surrogate
 * the browser paints as a replacement box. A combining accent breaks the other way:
 * decomposed "e" + U+0301 is two code units, so a two-character slice spends both on one
 * letter, and a slice landing between them strands a bare accent. Neither is hypothetical
 * for an operator's display name, and both fail visibly in the topbar rather than
 * silently, so this counts clusters instead.
 */
function firstGraphemes(source: string, count: number): string {
  const clusters: string[] = [];
  for (const { segment } of GRAPHEMES.segment(source)) {
    clusters.push(segment);
    if (clusters.length === count) break;
  }
  return clusters.join("");
}

/**
 * Two letters for the disc: initials of the display name, or of the email's local part
 * when there is no name (`op@example.test` gives `OP`).
 *
 * Deliberately not clever about WHICH characters it picks. Splitting on the separators
 * people actually use in an address (`.`, `_`, `-`, `+`) covers `ada.lovelace@` and
 * `ada_lovelace@`; anything else falls back to the first two characters, which is always
 * SOMETHING rather than a blank circle. The result is decorative - `aria-label` carries
 * the accessible name - so an imperfect guess costs nobody anything.
 *
 * It is careful about what a character IS, though, which is a different question and the
 * one `firstGraphemes` above answers.
 */
export function initialsFor(email: string, name?: string): string {
  const source = name !== undefined && name.trim() !== "" ? name : (email.split("@")[0] ?? email);
  const parts = source.split(/[\s._\-+]+/u).filter((part) => part !== "");
  if (parts.length >= 2) {
    return `${firstGraphemes(parts[0] ?? "", 1)}${firstGraphemes(parts[1] ?? "", 1)}`.toUpperCase();
  }
  return firstGraphemes(parts[0] ?? source, 2).toUpperCase();
}
