import type { DraftPreview, FormIssue, FormSettings, MintedLink } from "./types.ts";

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
  /**
   * Non-blocking publish advisories (issue #123).
   *
   * Empty whenever the **kernel** reports errors, because `compileDraft` advises
   * only on a draft it could compile. That is narrower than "empty whenever
   * `issues` is not": `issues` also carries the API's `DEPRECATED_PIN` findings,
   * so a deprecated pin and a warning about the same draft arrive together.
   *
   * What holds either way is the part the panel depends on: a warning is never
   * part of the reason the count beside it is what it is.
   */
  readonly warnings: readonly FormIssue[];
  readonly code?: string;
  readonly message?: string;
}

/** The result of one debounced dry-run validation. */
export interface ValidateDraftState {
  readonly status: "ok" | "error";
  /** Errors only: a warning describes a draft that would publish (issue #123). */
  readonly valid: boolean;
  readonly issues: readonly FormIssue[];
  readonly warnings: readonly FormIssue[];
  readonly message?: string;
}

/** The result of saving the per-form abuse-control settings (ADR-24 tier 2). */
export interface SettingsState {
  readonly status: "idle" | "saved" | "error";
  readonly settings?: FormSettings;
  /** Whether a challenge is enforceable here, as the API reports it after the write. */
  readonly challengeEnforceable?: boolean;
  readonly message?: string;
}

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

// --- publish, preview, lifecycle and secure links (task 034) ----------------

/**
 * The publish attempt's result.
 *
 * `rejected` is a first-class status rather than a flavour of `error`, because the two ask
 * different things of the screen: an `error` is a sentence, while a `rejected` publish is
 * a work list - every issue the kernel raised, each one anchored to the rule, step or pin
 * that caused it, and nothing persisted.
 */
export interface PublishState {
  readonly status: "idle" | "published" | "rejected" | "error";
  readonly version?: number;
  readonly publishedAt?: string;
  readonly issues?: readonly FormIssue[];
  readonly message?: string;
}

export const IDLE_PUBLISH: PublishState = { status: "idle" };

/**
 * The draft preview's result: the compiled documents plus the visible set for the answers
 * that were sent, or the issues that stop the draft compiling at all.
 */
export interface DraftPreviewState {
  readonly status: "idle" | "loading" | "ok" | "rejected" | "error";
  readonly preview?: DraftPreview;
  readonly issues?: readonly FormIssue[];
  readonly message?: string;
}

export const IDLE_DRAFT_PREVIEW: DraftPreviewState = { status: "idle" };

/** Close/reopen. The screen re-reads the form afterwards; this only reports the outcome. */
export interface FormStatusState {
  readonly status: "idle" | "changed" | "error";
  readonly formStatus?: "open" | "closed";
  readonly message?: string;
}

export const IDLE_FORM_STATUS: FormStatusState = { status: "idle" };

/**
 * A mint result.
 *
 * The URLs live here and nowhere else for as long as the screen is open: the API stores a
 * link's state and never its token, so this is the only moment they can be copied.
 */
export interface MintLinksState {
  readonly status: "idle" | "minted" | "error";
  readonly links?: readonly MintedLink[];
  readonly message?: string;
}

export const IDLE_MINT: MintLinksState = { status: "idle" };

/** A revoke attempt. */
export interface RevokeLinkState {
  readonly status: "idle" | "revoked" | "error";
  readonly linkId?: string;
  readonly message?: string;
}

export const IDLE_REVOKE: RevokeLinkState = { status: "idle" };
