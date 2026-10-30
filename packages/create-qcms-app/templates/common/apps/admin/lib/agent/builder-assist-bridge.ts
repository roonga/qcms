"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { DraftForm } from "../forms/types";

/**
 * The seam between the form builder and the assistant panel the shell renders.
 *
 * The panel moved out of the builder and into the shell, so the two are different React
 * trees and nothing renders both. This is the answer `builder-bridge.ts` gives the rail,
 * for the same reason: two client trees on one page import one instance of one module, so
 * a module is what they genuinely share.
 *
 * The builder still owns the draft. What crosses here is a snapshot plus the accept
 * callback, so the draft's autosave and its validation stay where they were.
 */
export interface BuilderAssistSnapshot {
  /** This form's assist route, relative to this app. */
  readonly endpoint: string;
  /**
   * Whether this caller may write this form's draft. False sends the turn to the screen
   * route instead: the per-form route requires `form: write`, and a caller who cannot
   * write has nothing to accept.
   */
  readonly canPropose: boolean;
  readonly draft: DraftForm;
  readonly draftUpdatedAt: string | undefined;
  readonly accept: (proposedDraft: DraftForm, newQuestions: readonly unknown[]) => void;
}

let snapshot: BuilderAssistSnapshot | undefined;
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

function getSnapshot(): BuilderAssistSnapshot | undefined {
  return snapshot;
}

/** The server has no builder mounted, by construction, so it publishes nothing. */
function getServerSnapshot(): undefined {
  return undefined;
}

/** Publish the draft and the accept path for the panel the shell renders. */
export function usePublishBuilderAssist(next: BuilderAssistSnapshot | undefined): void {
  useEffect(() => {
    snapshot = next;
    emit();
    return () => {
      snapshot = undefined;
      emit();
    };
  }, [next]);
}

/** The builder's published draft, or `undefined` when no builder is mounted. */
export function useBuilderAssist(): BuilderAssistSnapshot | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
