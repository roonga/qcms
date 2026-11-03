"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { DraftForm } from "./types.ts";

// The rail and editor are separate client trees. Share committed snapshots and mutators without giving the rail draft ownership.

// Step and group selection are exclusive so the editor and rail cannot describe different active subjects.
// Carry stepId with groupId so the step-scoped panel does not search the whole draft.
export type BuilderSelection =
  | { readonly kind: "form" }
  | { readonly kind: "step"; readonly stepId: string }
  | { readonly kind: "group"; readonly stepId: string; readonly groupId: string };

export interface BuilderRailSnapshot {
  readonly draft: DraftForm;
  readonly issueCounts: ReadonlyMap<string, number>;
  readonly selection: BuilderSelection;

  readonly chooseForm: () => void;
  readonly choose: (stepId: string) => void;
  readonly add: (title: string) => void;
  readonly rename: (stepId: string, title: string) => void;
  readonly move: (stepId: string, delta: -1 | 1) => void;
  readonly remove: (stepId: string) => void;

  readonly chooseGroup: (stepId: string, groupId: string) => void;

  readonly addGroup: (stepId: string, label: string) => void;
  readonly renameGroup: (groupId: string, label: string) => void;
  readonly moveGroup: (stepId: string, groupId: string, delta: -1 | 1) => void;
  readonly removeGroup: (groupId: string) => void;
}

let snapshot: BuilderRailSnapshot | undefined;

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

function getServerSnapshot(): undefined {
  return undefined;
}

// Publish through an effect so the rail reads committed renders. Clear on cleanup so it cannot retain a stale draft after navigation.
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

export function useBuilderRail(): BuilderRailSnapshot | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
