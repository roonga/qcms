"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { DraftForm } from "./types.ts";

/**
 * The seam between the form builder and the rail beside it (Code Owner, 2026-08-25).
 *
 * ## Why a store and not props
 *
 * The steps now live in the rail, and the rail is a parallel-route slot
 * (`app/(shell)/@rail/forms/[formId]/`) so that it renders BESIDE the capped content column
 * rather than inside it. That makes it a different React tree from the builder: nothing
 * renders both, so there is no component that could hold the draft and hand it down, and
 * the shell layout that renders both slots is shared by every screen in the app - putting a
 * builder provider there would make seventeen screens carry a context one of them uses.
 *
 * This is the same problem the Settings rail solved the same way (`lib/settings-panel.ts`),
 * and for the same reason: two client trees on one page import one instance of one module
 * out of one bundle, so a module IS what they genuinely share. `useSyncExternalStore` is
 * React's own answer for reading a value that lives outside React.
 *
 * ## The builder owns the draft, and that does not change
 *
 * What crosses this seam is a snapshot plus the callbacks that mutate it, published by the
 * builder on every render. The draft, its history, its autosave and its validation stay
 * exactly where they were: the rail calls `rename`, the builder decides what that means.
 * Nothing here mutates anything, which is what keeps one owner for the draft rather than
 * two writers racing over one document (R2's shape, applied inside the client).
 *
 * ## What the rail does before the builder has published
 *
 * `undefined`, and the rail renders the steps the SERVER gave it as plain anchors. That is
 * the honest first paint: the slot already loaded the form's steps to render them, so the
 * reader sees the real list immediately, and it becomes interactive when the page hydrates.
 * A reader with no JavaScript keeps that anchored list rather than a dead menu.
 */
/**
 * `choose` rather than `select`, and the name is load-bearing rather than a preference:
 * `lib/server/r2-import-surface.test.ts` reads every source file in this app and treats a
 * call named `select`, `insert`, `update`, `delete` or `transaction` as evidence of a
 * database query, because the admin is a strict BFF and is forbidden one (R2, ADR-35).
 * Choosing a step is not a query, but the tripwire cannot tell, and the right response to a
 * coarse security check is to stay clear of it rather than to carve an exemption into it.
 */
/**
 * WHAT THE BUILDER IS SHOWING, and the two are exclusive (Code Owner, 2026-08-26).
 *
 * The builder used to show one screen: the selected step's editor with the form's own
 * title, settings, rules, test bench and validation stacked under it. Those five are
 * properties of the FORM, so every step showed them again, and a reader moving between
 * steps saw the same five panels follow them around as though each step had its own copy.
 *
 * `plan/admin-shell-poc/admin-shell-poc.html` draws two screens rather than one - its own
 * card subtitle says "left rail navigating a form screen and a step screen" - and the rail
 * is what switches between them. So the form's details are `kind: "form"`, reached from a
 * row of the rail, and a step is `kind: "step"`, reached from that step's row.
 */
export type BuilderSelection =
  { readonly kind: "form" } | { readonly kind: "step"; readonly stepId: string };

export interface BuilderRailSnapshot {
  readonly draft: DraftForm;
  readonly issueCounts: ReadonlyMap<string, number>;
  readonly selection: BuilderSelection;
  /** Show the form's own details rather than any step's. */
  readonly chooseForm: () => void;
  readonly choose: (stepId: string) => void;
  readonly add: (title: string) => void;
  readonly rename: (stepId: string, title: string) => void;
  readonly move: (stepId: string, delta: -1 | 1) => void;
  readonly remove: (stepId: string) => void;
}

let snapshot: BuilderRailSnapshot | undefined;

/**
 * Held as an immutable array that is replaced rather than mutated, for the reason
 * `lib/settings-panel.ts` writes out at length: `lib/server/r2-import-surface.test.ts` reads
 * every source file in this app and treats a call named `delete` as evidence of a database
 * query, because the admin is a strict BFF and is forbidden one (R2, ADR-35). A `Set`
 * removal is not a query, but the tripwire cannot tell, and the right response to a coarse
 * security check is to stay clear of it rather than to carve an exemption into it.
 */
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

function getSnapshot(): BuilderRailSnapshot | undefined {
  return snapshot;
}

/** The server has no builder mounted, by construction, so it publishes nothing. */
function getServerSnapshot(): undefined {
  return undefined;
}

/**
 * Publish the builder's current steps and mutators for the rail to render.
 *
 * Called from the builder's own render through an effect, so the value the rail reads is
 * the one the builder last committed rather than one from a render React discarded. The
 * cleanup clears it, which is what stops a stale draft being offered to the rail after the
 * builder unmounts - navigating from the builder to Preview leaves the rail rendering the
 * server's anchors again, which is correct: there is no builder to select a step in.
 */
export function usePublishBuilderRail(next: BuilderRailSnapshot): void {
  useEffect(() => {
    snapshot = next;
    emit();
    return () => {
      snapshot = undefined;
      emit();
    };
  }, [next]);
}

/** The builder's published state, or `undefined` when no builder is mounted. */
export function useBuilderRail(): BuilderRailSnapshot | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
