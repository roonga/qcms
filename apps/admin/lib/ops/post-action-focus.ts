/**
 * Move focus to the successor of a control that has just removed itself (issue #308).
 *
 * Erasing a response, releasing a withheld event and both redelivery paths all finish
 * by unmounting the button that started them: the erase button goes with the answers,
 * the release button goes with the flag panel, and a redelivered row leaves the queue.
 * React Aria then restores focus to the node that opened the overlay, that node is no
 * longer in the document, and focus lands on `<body>` - so a keyboard or screen-reader
 * operator finishes an irreversible action at the top of the document with no idea
 * where they are. Restore is the right default and cannot know what replaced the
 * trigger; naming the successor is the application's job.
 *
 * ## Headings, not the live region
 *
 * Every caller passes the heading of whatever now occupies the place: the tombstone's
 * heading after an erasure, the response's heading after a release, the queue's heading
 * after a redelivery. A heading already carries a role and a name, so it announces
 * where focus went without an `aria-label` on a generic element (which axe rejects as a
 * prohibited attribute), and reading on from it reaches the polite live region and then
 * the updated content.
 *
 * Deliberately **not** the live region itself. That region announces the outcome on its
 * own; focusing it would have most screen readers say the same sentence twice, once as
 * a live update and once on focus, and would park the operator on a node that
 * disappears at the next action.
 *
 * ## Twice, one frame apart
 *
 * The first call is the one that matters. The second exists because React Aria's
 * restore runs in the same commit and, in some paths, a frame later - so this has to be
 * the last word rather than a race with it. Re-focusing an element that already has
 * focus fires no events and is free.
 *
 * Returns the effect cleanup, so a caller can pass the result straight out of
 * `useEffect`.
 */
export function focusPostAction(target: HTMLElement | null): (() => void) | undefined {
  if (target === null) return undefined;
  target.focus();
  const frame = requestAnimationFrame(() => {
    target.focus();
  });
  return () => {
    cancelAnimationFrame(frame);
  };
}
