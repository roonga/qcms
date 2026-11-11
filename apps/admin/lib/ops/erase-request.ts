"use client";

import { useSyncExternalStore } from "react";

// A counter rather than a flag: the header's menu and the detail body are separate client trees, and a
// second request after a cancelled dialog has to be distinguishable from the first.

let requests = 0;

// Use an array: the import-surface guard treats Set.delete as a database operation.
let listeners: readonly (() => void)[] = [];

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

function getRequests(): number {
  return requests;
}

function getNoRequests(): number {
  return 0;
}

export function requestErase(): void {
  requests += 1;
  for (const listener of listeners) listener();
}

// Clear on unmount because module state outlives the route; a remount must not replay an earlier request.
export function resetEraseRequests(): void {
  if (requests === 0) return;
  requests = 0;
  for (const listener of listeners) listener();
}

export function useEraseRequests(): number {
  return useSyncExternalStore(subscribe, getRequests, getNoRequests);
}
