"use client";

import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};
const hydrated = () => true;
const notYetHydrated = () => false;

/** Disable Server Action submits until hydration: no-referrer navigation POSTs carry Origin: null and Next refuses them, losing unsaved state. External-store snapshots make SSR and the hydrating render agree. */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, hydrated, notYetHydrated);
}
