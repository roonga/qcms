"use client";

import { useSyncExternalStore } from "react";

import {
  type Announcement,
  readAnnouncement,
  serverAnnouncement,
  subscribeToAnnouncements,
} from "@/lib/announce";

/**
 * The shell's live region (issue #355).
 *
 * Rendered once by the authenticated layout, above every page, so it is the same DOM
 * node before an action, while the action's revalidation swaps the page out underneath
 * it, and after that settles. `lib/announce.ts` states why an outcome announcement
 * cannot live on the screen that performed the action.
 *
 * Visually hidden rather than invisible: the visible confirmation of an action is the
 * state it produced (the tombstone, the emptied queue), and duplicating that as a
 * banner would say the same thing twice to a sighted operator while saying it once to
 * everyone else. `.qcms-visually-hidden` clips it out of the layout without taking it
 * out of the accessibility tree, which `display: none` would.
 *
 * Empty until something is said. A region that mounts already populated is announced
 * unreliably - several screen readers only observe mutations of a region they were
 * already watching - which is the same rule the webhook secret panel follows (#307).
 */
export function Announcer() {
  const announcement: Announcement = useSyncExternalStore(
    subscribeToAnnouncements,
    readAnnouncement,
    serverAnnouncement,
  );

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="qcms-visually-hidden"
      data-testid="qcms-announcer"
    >
      {/* Keyed by the sequence number so a repeated message is still a replaced node,
          and therefore still a change the region announces. */}
      {announcement.text === "" ? null : <span key={announcement.seq}>{announcement.text}</span>}
    </div>
  );
}
