"use client";

import { useSyncExternalStore } from "react";

import type { DerivedThemeFact, LayoutReportFact, PreviewSelectionFact } from "./builder-facts";

/**
 * The preview and the assistant pane are separate client trees, so the facts they share
 * live here until a builder turn sends them. `selectionLabel` is display text for the
 * pane and is never part of a fact.
 */
export interface BuilderFacts {
  readonly selection: PreviewSelectionFact | undefined;
  readonly selectionLabel: string;
  readonly layout: LayoutReportFact | undefined;
  /** The newest derive's colours, which the turn after it reads instead of the website. */
  readonly derivedTheme: DerivedThemeFact | undefined;
}

const EMPTY: BuilderFacts = {
  selection: undefined,
  selectionLabel: "",
  layout: undefined,
  derivedTheme: undefined,
};

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

export function publishDerivedTheme(derivedTheme: DerivedThemeFact | undefined): void {
  emit({ ...facts, derivedTheme });
}

export function clearBuilderFacts(): void {
  emit(EMPTY);
}

/** What the next builder turn sends: the question pointed at, the step measured and the derive. */
export function builderFacts(): BuilderFacts {
  return facts;
}

export function useBuilderFacts(): BuilderFacts {
  return useSyncExternalStore(subscribe, builderFacts, () => EMPTY);
}
