"use client";

import { useEffect, useSyncExternalStore } from "react";

import { PANEL_PARAM, type QuestionPanel, type QuestionPanelId } from "./panels.ts";

// The rail and editor are separate React trees sharing this module; the editor retains document ownership.
// Use the server-resolved panel until the reader chooses one to keep SSR and hydration aligned.
// The import-surface guard treats select and delete calls as database operations, even for local stores.

// The vendored Button forwards no form attribute; requestSubmit uses this id to retain native validation and form actions.
export const QUESTION_FORM_ID = "qcms-question-editor";

export interface QuestionSaveSnapshot {
  readonly isPending: boolean;
}

export interface QuestionPanelsSnapshot {
  readonly panels: readonly QuestionPanel[];

  readonly issueCounts: ReadonlyMap<QuestionPanelId, number>;
}

let chosen: QuestionPanelId | undefined;

let published: QuestionPanelsSnapshot | undefined;

let save: QuestionSaveSnapshot | undefined;

// Use copy-on-write subscriptions so a listener removing itself cannot skip the next notification.
// An array also avoids the import-surface guard treating Set.delete as a database operation.
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

function getChosen(): QuestionPanelId | undefined {
  return chosen;
}

function getPublished(): QuestionPanelsSnapshot | undefined {
  return published;
}

function getSave(): QuestionSaveSnapshot | undefined {
  return save;
}

function getNothing(): undefined {
  return undefined;
}

// Use replaceState to preserve unsaved editor state without a server rerender or a Back entry per panel.
// Keep the version parameter when changing panels so the address still names the edited version.
export function chooseQuestionPanel(panel: QuestionPanelId): void {
  if (chosen !== panel) {
    chosen = panel;
    emit();
  }
  const url = new URL(window.location.href);
  url.searchParams.set(PANEL_PARAM, panel);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

// Module state outlives the route; clear the selection on unmount so another question or version uses its own address.
export function resetQuestionPanel(): void {
  if (chosen === undefined) return;
  chosen = undefined;
  emit();
}

export function useQuestionPanel(address: QuestionPanelId): QuestionPanelId {
  return useSyncExternalStore(subscribe, getChosen, getNothing) ?? address;
}

// Publish through an effect so the rail sees committed renders; clear on cleanup to avoid stale unsaved digests.
export function usePublishQuestionPanels(next: QuestionPanelsSnapshot | undefined): void {
  useEffect(() => {
    published = next;
    emit();
    return () => {
      published = undefined;
      emit();
    };
  }, [next]);
}

export function useQuestionPanels(): QuestionPanelsSnapshot | undefined {
  return useSyncExternalStore(subscribe, getPublished, getNothing);
}

// Frozen versions publish no save state, so read-only screens render neither a save control nor a save-model note.
export function usePublishQuestionSave(next: QuestionSaveSnapshot | undefined): void {
  useEffect(() => {
    save = next;
    emit();
    return () => {
      save = undefined;
      emit();
    };
  }, [next]);
}

export function useQuestionSave(): QuestionSaveSnapshot | undefined {
  return useSyncExternalStore(subscribe, getSave, getNothing);
}
