/** Keep the live region in the shell so revalidation cannot unmount it mid-announcement. Sequence identical messages to force a DOM mutation; field descriptions stay beside their controls. */

export interface Announcement {
  readonly text: string;

  readonly seq: number;
}

const NOTHING: Announcement = { text: "", seq: 0 };

let current: Announcement = NOTHING;

/** Copy-on-write subscriptions keep an unsubscribe during announcement from corrupting iteration. */
let listeners: readonly (() => void)[] = [];

export function announce(text: string): void {
  current = { text, seq: current.seq + 1 };
  for (const listener of listeners) listener();
}

export function subscribeToAnnouncements(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

/** Return the same snapshot object until it changes; fresh identities would make useSyncExternalStore rerender forever. */
export function readAnnouncement(): Announcement {
  return current;
}

/** Start SSR empty so hydration cannot announce an action to someone who merely opened the page. */
export function serverAnnouncement(): Announcement {
  return NOTHING;
}
