"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { DraftForm } from "../forms/types";

/** The shell panel and builder are separate client trees; share a snapshot and accept callback while the builder retains draft ownership. */
export interface BuilderAssistSnapshot {
  readonly endpoint: string;
  /** Read-only callers use screen assist because form assist requires write access and has no acceptable draft for them. */
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

function getServerSnapshot(): undefined {
  return undefined;
}

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

let waiting: ((draftUpdatedAt: string | undefined) => void)[] = [];

export function recordDraftSaved(draftUpdatedAt: string | undefined): void {
  const waiters = waiting;
  waiting = [];
  for (const resolve of waiters) resolve(draftUpdatedAt);
}

/** Wait for the next successful save before proposing publication: accepted question pins must exist first. Use the save token, not a possibly stale render. */
export function nextDraftSaved(timeoutMs = 20_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const held: { timer?: ReturnType<typeof setTimeout> } = {};
    const settle = (draftUpdatedAt: string | undefined): void => {
      if (held.timer !== undefined) clearTimeout(held.timer);
      resolve(draftUpdatedAt);
    };
    held.timer = setTimeout(() => {
      waiting = waiting.filter((candidate) => candidate !== settle);
      resolve(undefined);
    }, timeoutMs);
    waiting = [...waiting, settle];
  });
}

export function useBuilderAssist(): BuilderAssistSnapshot | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function builderAssistSnapshot(): BuilderAssistSnapshot | undefined {
  return snapshot;
}
