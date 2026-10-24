"use client";

import { useSyncExternalStore } from "react";

/**
 * "Somebody asked for a step to be added", as a value two client trees can share
 * (issue #1116).
 *
 * ## Why a module and not a prop
 *
 * Add step is asked for from two places and §7.0 moved them apart. The control is the rail's
 * Actions part, at the foot of the rail; the form row's own menu sits at the top of the step
 * list, so that the way in is still reachable once a long list has pushed the control out of
 * the rail's scroll (Code Owner, 2026-08-26). Those two are rendered by different components
 * now - `components/forms/rail-add-step.tsx` and `components/forms/rail-steps.tsx` - under a
 * frame that is a server component, so there is no component between them that could hold the
 * state and hand it down.
 *
 * One dialog is the requirement that makes this a store rather than two local states: two
 * dialogs would be two drafts of one step title, and which one you had typed into would
 * depend on which control you had reached for. The dialog belongs to the control, and this is
 * the menu's way of opening it.
 *
 * `lib/settings-panel.ts` is the precedent and the shape is deliberately the same:
 * `useSyncExternalStore` is React's own answer for reading a value that lives outside React,
 * and a module is what two client components on one page genuinely share.
 *
 * ## Why the value is a counter
 *
 * A boolean "open" would make this store own the dialog, and the dialog's own open state
 * already lives with the dialog. What crosses the seam is an EVENT - "open it now" - and a
 * monotonic counter is an event that `useSyncExternalStore` can report: each request is a new
 * value, so asking twice in a row works, which a boolean that was already `true` would not.
 */

let requests = 0;

/**
 * The subscribers, held as an immutable array that is replaced rather than mutated.
 *
 * A `Set` is the obvious shape and is deliberately not used: `lib/server/r2-import-surface.
 * test.ts` reads every source file in this app and treats a call named `select`, `insert`,
 * `update`, `delete` or `transaction` as evidence of a database query, because the admin is
 * a strict BFF and is forbidden one (R2, ADR-35). A `Set` removal is not a query, but the
 * tripwire cannot tell, and the right response to a coarse security check is to stay clear
 * of it rather than to carve an exemption into it.
 */
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

/** The server has had no request: nothing has been pressed before the first paint. */
function getNoRequests(): number {
  return 0;
}

/** Ask the rail's Add step control to open its dialog. */
export function requestAddStep(): void {
  requests += 1;
  for (const listener of listeners) listener();
}

/**
 * Forget every request made so far, so a control mounting next opens nothing.
 *
 * MODULE STATE OUTLIVES A ROUTE, which is the defect `resetSettingsPanel` exists for one
 * module over (`lib/settings-panel.ts`), and this store had it: the count is read against a
 * per-mount ref, so a control that unmounted with one request behind it and then mounted
 * again - walking from the builder to Preview and back, say - saw a number it had not seen
 * and opened a dialog nobody had asked for. The control clears it as it unmounts, which is
 * what makes "a new number means open it now" true of this page's life rather than of the
 * bundle's.
 */
export function resetAddStepRequests(): void {
  if (requests === 0) return;
  requests = 0;
  for (const listener of listeners) listener();
}

/**
 * How many times a step has been asked for in this page's life.
 *
 * The caller watches the value change rather than reading it as a state: a new number means
 * "open the dialog now". Exported this way rather than as a callback registry so the only
 * thing crossing the seam is a value React already knows how to subscribe to.
 */
export function useAddStepRequests(): number {
  return useSyncExternalStore(subscribe, getRequests, getNoRequests);
}
