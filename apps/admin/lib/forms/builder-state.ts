import type { FormIssue, FormSettings } from "./types.ts";

/**
 * What each form-builder mutation reports back to the screen (task 033).
 *
 * Beside the types rather than inside the actions module for the reason 032's
 * `editor-state.ts` records: a `"use server"` module may only export async functions, so a
 * shared interface declared there is a build error whose message does not say so. Keeping
 * them here also lets a client component name the type without pulling the server module
 * into its graph.
 */

/** The create-form screen's `useActionState` shape. */
export interface CreateFormState {
  readonly status: "idle" | "error";
  readonly code?: string;
  readonly message?: string;
  /** Echoed back so a refused create redisplays what the author typed, not an empty form. */
  readonly submitted?: {
    readonly slug: string;
    readonly title: string;
    readonly defaultLocale: string;
  };
}

export const IDLE_CREATE_FORM: CreateFormState = { status: "idle" };

/**
 * The result of one autosave.
 *
 * `issues` is populated on success too, and that is 022's advisory-save semantics rather
 * than an oddity: an inconsistent draft saves perfectly well and comes back with the list
 * of what would block a publish. A save that reports issues is a save that worked.
 */
export interface SaveDraftState {
  readonly status: "saved" | "error";
  readonly issues: readonly FormIssue[];
  readonly code?: string;
  readonly message?: string;
}

/** The result of one debounced dry-run validation. */
export interface ValidateDraftState {
  readonly status: "ok" | "error";
  readonly valid: boolean;
  readonly issues: readonly FormIssue[];
  readonly message?: string;
}

/** The result of saving the per-form abuse-control settings (ADR-24 tier 2). */
export interface SettingsState {
  readonly status: "idle" | "saved" | "error";
  readonly settings?: FormSettings;
  /** The deployment's challenge provider as the API reports it after the write. */
  readonly challengeProvider?: string;
  readonly message?: string;
}

export const IDLE_SETTINGS: SettingsState = { status: "idle" };

/**
 * The rule test bench's verdict.
 *
 * Three outcomes, not two, and the distinction is the point: "this condition did not
 * match" and "this condition could not be evaluated" are different answers, and a bench
 * that rendered the second as the first would teach an author something false about their
 * rule. `reason` is present only for `unavailable`.
 */
export type PreviewOutcome = "match" | "noMatch" | "unavailable";

export type PreviewReason = "unparseableDraft" | "ruleNotFound" | "noTarget" | "unresolvedAnswers";

export interface PreviewConditionState {
  readonly status: "idle" | "ok" | "error";
  readonly outcome?: PreviewOutcome;
  readonly reason?: PreviewReason;
  /** The question ids the condition reads, in the draft's document order. */
  readonly references?: readonly string[];
  readonly message?: string;
}

export const IDLE_PREVIEW: PreviewConditionState = { status: "idle" };
