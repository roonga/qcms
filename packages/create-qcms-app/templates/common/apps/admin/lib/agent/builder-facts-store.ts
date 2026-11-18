"use client";

import { useSyncExternalStore } from "react";

import type { LayoutReportFact, PreviewSelectionFact } from "./builder-facts";

/**
 * The preview and the assistant pane are separate client trees, so the facts they share
 * live here until a builder turn sends them. `selectionLabel` is display text for the
 * pane and is never part of a fact.
 */
export interface BuilderFacts {
  readonly selection: PreviewSelectionFact | undefined;
  readonly selectionLabel: string;
  readonly layout: LayoutReportFact | undefined;
}

const EMPTY: BuilderFacts = { selection: undefined, selectionLabel: "", layout: undefined };

let facts: BuilderFacts = EMPTY;
let listeners: readonly (() => void)[] = [];

function emit(next: BuilderFacts): void {
  facts = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

export function publishSelection(selection: PreviewSelectionFact | undefined, label = ""): void {
  emit({ ...facts, selection, selectionLabel: selection === undefined ? "" : label });
}

export function publishLayout(layout: LayoutReportFact | undefined): void {
  if (JSON.stringify(layout) === JSON.stringify(facts.layout)) return;
  emit({ ...facts, layout });
}

export function clearBuilderFacts(): void {
  emit(EMPTY);
}

/** What the next builder turn sends: the question pointed at and the step the browser measured. */
export function builderFacts(): BuilderFacts {
  return facts;
}

export function useBuilderFacts(): BuilderFacts {
  return useSyncExternalStore(subscribe, builderFacts, () => EMPTY);
}
