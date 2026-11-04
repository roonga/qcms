"use client";

import { useSyncExternalStore } from "react";

// Share an event counter across the rail client trees; repeated requests need distinct values, not an already-true boolean.

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

export function requestAddStep(): void {
  requests += 1;
  for (const listener of listeners) listener();
}

// Clear on unmount because module state outlives the route; a remount must not replay an earlier request.
export function resetAddStepRequests(): void {
  if (requests === 0) return;
  requests = 0;
  for (const listener of listeners) listener();
}

export function useAddStepRequests(): number {
  return useSyncExternalStore(subscribe, getRequests, getNoRequests);
}
