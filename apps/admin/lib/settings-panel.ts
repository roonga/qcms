"use client";

import { useSyncExternalStore } from "react";

import type { SettingsSectionId } from "./settings-sections.ts";

/**
 * The Settings screen's panel switch (issue 655).
 *
 * ## Why a store and not `useState`
 *
 * The two halves of the switch are in different React trees. The rail is a parallel-route
 * slot (`app/(shell)/@rail/settings/page.tsx`) so that it renders BESIDE the capped content
 * column rather than inside it, and the panels are in the page itself. Nothing renders both,
 * so there is no component that could hold the state and hand it down, and the shell layout
 * that renders both slots is shared by every other screen in the app - putting a Settings
 * provider there would make sixteen screens carry a context one of them uses.
 *
 * A module is what the two trees genuinely share: they are client components on one page, so
 * they import one instance of this file out of one bundle. `useSyncExternalStore` is React's
 * own answer for reading a value that lives outside React, and it is what keeps the rail's
 * `aria-current`, the heading and the visible panel from ever disagreeing - they are three
 * renders of one value, not three copies of it.
 *
 * ## Why the stored value can be `undefined`
 *
 * The section the screen OPENS with is decided by the URL and rendered on the server (see
 * `settingsSectionFromParams`), and both trees are told it as a prop. If this module also
 * held a default, the two would have to be kept equal by hand and a hydration mismatch is
 * what "by hand" looks like when it slips. So the store holds only what the reader has
 * CHOSEN, which is nothing until they click, and {@link useSettingsPanel} falls back to the
 * server's answer. On the server the snapshot is `undefined` by construction, so the first
 * client render and the HTML it hydrates are the same by construction too.
 *
 * ## JavaScript is required here, by design
 *
 * The POC switches panels with a script and this is the approved design. There is no
 * scriptless fallback and none is wanted: the no-JavaScript floor is the respondent portal's
 * constraint, not this app's.
 */

/** The section the reader has chosen, or `undefined` while the URL's answer still stands. */
let chosen: SettingsSectionId | undefined;

const listeners = new Set<() => void>();

function emit(): void {
  // A copy, so a listener that unsubscribes while being notified cannot skip the next one.
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getChosen(): SettingsSectionId | undefined {
  return chosen;
}

/** The server never has a chosen section: the URL is the whole of what it knows. */
function getNothingChosen(): undefined {
  return undefined;
}

/** Show a section's panel, mark its rail row current, and rename the heading. */
export function selectSettingsPanel(id: SettingsSectionId): void {
  if (chosen === id) return;
  chosen = id;
  emit();
}

/**
 * Forget the reader's choice, so the next visit opens on the section its URL names.
 *
 * Module state outlives a route: without this, arriving at `/settings?changed=1` after
 * having clicked Account earlier in the session would show the Account panel and hide the
 * password confirmation. The screen clears it as it unmounts.
 */
export function resetSettingsPanel(): void {
  if (chosen === undefined) return;
  chosen = undefined;
  emit();
}

/** The section showing right now: the reader's choice, or the one the URL opened with. */
export function useSettingsPanel(initial: SettingsSectionId): SettingsSectionId {
  return useSyncExternalStore(subscribe, getChosen, getNothingChosen) ?? initial;
}
