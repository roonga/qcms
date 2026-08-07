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
 * prohibited attribute), and reading on from it reaches the live region and then the
 * updated content.
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

/** The tombstone card's heading, the post-erasure focus destination. */
export const TOMBSTONE_HEADING_ID = "qcms-tombstone-heading";

/**
 * How long a focus request stays honourable.
 *
 * A bound rather than an unbounded flag: the request is normally taken within a frame
 * or two, and the only way one survives is an operator who navigates away between
 * erasing a response and the route re-rendering it. Without the bound, that stray
 * request would be taken by the next tombstone to mount anywhere in the session, which
 * would be a focus steal on arrival rather than an answer to an action.
 */
const REQUEST_TTL_MS = 5_000;

let pending: { readonly elementId: string; readonly at: number } | null = null;

/**
 * Ask the next render of `elementId` to take focus.
 *
 * This exists because of one specific hand-off, and only that one. Erasing revalidates
 * the response's own route, so a moment after the client component swaps in the
 * tombstone, the **route** re-renders the same URL as its own tombstone and unmounts
 * the whole subtree that had just taken focus - dropping focus back to `<body>` after
 * the fix had already worked. The request survives that swap where a ref cannot,
 * because it lives in the module rather than in the tree.
 */
export function requestPostActionFocus(elementId: string): void {
  pending = { elementId, at: Date.now() };
}

/**
 * Take a focus request addressed to `elementId`, if there is a live one.
 *
 * Called by the component that IS the post-action state, on mount. With no request
 * pending it does nothing, which is what makes an ordinary visit to an erased
 * response's URL an ordinary visit.
 */
export function claimPostActionFocus(elementId: string): (() => void) | undefined {
  if (pending === null) return undefined;
  if (pending.elementId !== elementId) return undefined;
  if (Date.now() - pending.at > REQUEST_TTL_MS) {
    pending = null;
    return undefined;
  }
  pending = null;
  return focusPostAction(document.getElementById(elementId));
}
