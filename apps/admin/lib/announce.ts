/**
 * The admin's one live region, held above the screens that speak into it (issue #355).
 *
 * ## The defect this exists for
 *
 * Erasing a response calls `revalidatePath` on that response's own route. The route
 * then re-renders the same URL as its own tombstone, which unmounts `ResponseDetail`
 * a few hundred milliseconds later - and takes with it the `aria-live` region that had
 * just been given "The respondent data for ... has been erased." A live region removed
 * before or during its announcement window does not reliably announce, so an operator
 * completed the least reversible action in the app and heard nothing.
 *
 * The focus half of the same unmount was solved by handing the request to the card that
 * arrives on the far side of the swap (`lib/ops/post-action-focus.ts`). An announcement
 * cannot be handed over the same way: a live region only announces a change to a region
 * the screen reader was **already** watching, so a region created on the far side of the
 * swap with its text already in it is the very shape issue #307 had to remove from the
 * webhook secret panel. The region has to be the same node before and after.
 *
 * ## So it lives in the shell layout
 *
 * `revalidatePath` re-renders the page segment; the `(shell)` layout above it is
 * reconciled rather than remounted, so a region rendered there is the same DOM node
 * before the action, during the swap and after it settles. The message survives because
 * it never belonged to the screen that was replaced. That fixes the class rather than
 * this instance: any admin action whose outcome outlives its own screen announces here.
 *
 * The message itself is held in this module rather than in React state, for the same
 * reason `post-action-focus` is a module: it has to be settable from a component that
 * is about to disappear, by a caller that has no path to the layout's tree.
 *
 * ## The sequence number is not decoration
 *
 * Two identical announcements in a row (a retry that fails the same way twice) would
 * write the same text into the region, produce no DOM mutation, and be silent. The
 * `seq` keys the rendered node, so every call replaces a child of the region and every
 * call is therefore a change a screen reader can see.
 *
 * ## Not for field validation or progress
 *
 * This is for the outcome of a completed action. Messages that belong beside a control
 * stay beside it: they are read from the control's description, they must not be
 * announced from somewhere else in the document, and routing them here would make two
 * mechanisms out of one job.
 */

/** One announcement, with the counter that makes a repeat still a DOM change. */
export interface Announcement {
  /** What to say. Empty means nothing has been announced yet. */
  readonly text: string;
  /** Increments on every call, so identical text still replaces a node. */
  readonly seq: number;
}

const NOTHING: Announcement = { text: "", seq: 0 };

let current: Announcement = NOTHING;
const listeners = new Set<() => void>();

/**
 * Say `text` in the shell's live region.
 *
 * Safe to call from a component that is about to unmount, which is the whole point:
 * the region is not in that component's subtree.
 */
export function announce(text: string): void {
  current = { text, seq: current.seq + 1 };
  for (const listener of listeners) listener();
}

/** Subscribe to announcements; returns the unsubscribe, for `useSyncExternalStore`. */
export function subscribeToAnnouncements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current announcement.
 *
 * Returns the stored object rather than building one, because `useSyncExternalStore`
 * compares snapshots by identity and a fresh object each call would re-render forever.
 */
export function readAnnouncement(): Announcement {
  return current;
}

/**
 * The server snapshot: always empty.
 *
 * A server render has no action behind it, and hydrating with text already in the
 * region would announce an outcome to someone who merely opened the page.
 */
export function serverAnnouncement(): Announcement {
  return NOTHING;
}
