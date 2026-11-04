"use client";

import { useSyncExternalStore } from "react";

import type { SettingsSectionId } from "./settings-sections.ts";

/** The page and parallel rail are separate client trees. Share only chosen overrides; undefined preserves the server URL answer and hydration consistency. */

let chosen: SettingsSectionId | undefined;

/** Copy-on-write subscriptions keep a mid-notification unsubscribe from skipping another listener. */
let listeners: readonly (() => void)[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

function getChosen(): SettingsSectionId | undefined {
  return chosen;
}

/** The server uses the URL, never browser module choices. */
function getNothingChosen(): undefined {
  return undefined;
}

export function selectSettingsPanel(id: SettingsSectionId): void {
  if (chosen === id) return;
  chosen = id;
  emit();
}

/** Clear on unmount because module state outlives navigation and could hide a redirected password confirmation. */
export function resetSettingsPanel(): void {
  if (chosen === undefined) return;
  chosen = undefined;
  emit();
}

export function useSettingsPanel(initial: SettingsSectionId): SettingsSectionId {
  return useSyncExternalStore(subscribe, getChosen, getNothingChosen) ?? initial;
}
