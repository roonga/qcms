"use client";

import { useSyncExternalStore } from "react";

import {
  type Announcement,
  readAnnouncement,
  serverAnnouncement,
  subscribeToAnnouncements,
} from "@/lib/announce";

/* Mount the empty region first: screen readers may miss a live region created with its initial
   announcement. */
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
      {announcement.text === "" ? null : <span key={announcement.seq}>{announcement.text}</span>}
    </div>
  );
}
