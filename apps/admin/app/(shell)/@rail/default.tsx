/**
 * The rail slot's fallback after a full-page load that matches no slot page.
 *
 * ## What this file does, and the thing it does NOT do
 *
 * Next consults a `default.tsx` only when it cannot recover a slot's active state, which is
 * to say after a HARD navigation. On a soft navigation it keeps whichever page the slot last
 * matched, unchanged, even when the new URL matches nothing there. The file convention's
 * reference is explicit about both halves.
 *
 * An earlier version of this comment claimed the opposite - that this file is "what stops
 * the slot from going stale on a soft navigation" - and the app behaved the way Next
 * documents rather than the way the comment asserted: walking from Settings to the question
 * library left the Settings section in the rail. Staleness is fixed by every route having a
 * page in the slot (`no-section.ts`), not here.
 *
 * So this is a genuine fallback and nothing more: a named slot with no `default.tsx` is an
 * error rather than an empty slot, so the file has to exist, and rendering nothing is the
 * right answer for an address that reached the shell without a section of its own.
 */
export default function RailDefault(): null {
  return null;
}
