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
  /** Task 041: whether the stored draft carries the marker after this save. */
  readonly agentAssisted?: boolean;
  /** Task 041: the stored draft's fresh `updatedAt`, for the next assist call's `clientState`. */
  readonly updatedAt?: string;
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

/**
 * The most instances a preview surface will hypothesise about a group whose author has not
 * declared a maximum yet (task 074; the Code Owner read a preview-only cap as inside Q14 on
 * 2026-10-03).
 *
 * **The API's own `PREVIEW_INSTANCE_CAP` is the authoritative bound** - it truncates the roster
 * it evaluates, so a drift between the two numbers can only make this app's controls stricter or
 * more generous than the answer, never wrong about it. This copy exists so the instance-count
 * fields can state the bound to the author instead of letting them type a seven-figure count that
 * allocates an array in their own browser before the request is even sent, and so the two preview
 * surfaces agree with each other.
 *
 * It bounds one request's hypothesis and no form's declared maximum: a group that declares a
 * `max` is bounded by the author's own figure, above or below this.
 */
export const PREVIEW_INSTANCE_CAP = 50;

/** One group's hypothetical roster, as the bench and the preview both pass and read it. */
export interface PreviewRoster {
  readonly groupId: string;
  readonly instances: readonly string[];
}

/** One instance's verdict, for a rule whose target sits inside a repeating group. */
export interface InstanceOutcome {
  readonly instanceId: string;
  readonly outcome: "match" | "noMatch";
}

export interface PreviewConditionState {
  readonly status: "idle" | "ok" | "error";
  readonly outcome?: PreviewOutcome;
  readonly reason?: PreviewReason;
  /** The question ids the condition reads, in the draft's document order. */
  readonly references?: readonly string[];
  readonly message?: string;
  /**
   * The hypothetical roster the API evaluated with, echoed so the panel can say what the
   * verdict is ABOUT (074). A verdict computed against three passengers beside a panel since
   * set to five is the one wrong thing a bench must never show.
   */
  readonly rosters?: readonly PreviewRoster[];
  /** The group the rule's target sits in: present exactly when the rule is per-instance. */
  readonly targetGroupId?: string;
  /**
   * One verdict per live instance of {@link targetGroupId}, in roster order, and **empty
   * rather than absent** when that group has no instance - which is the zero-instance case
   * seen from the panel's side.
   */
  readonly instanceOutcomes?: readonly InstanceOutcome[];
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

/**
 * A release attempt's result (ADR-40, task 065).
 *
 * `rollback` is reported rather than asked for: the API derives it from the release's
 * predecessor in that environment, and the screen says so afterwards. There is no
 * "rollback" status, because a rollback is not a different outcome - it is a release of an
 * earlier version, which is the same act with the same result (criterion 4).
 */
export interface ReleaseState {
  readonly status: "idle" | "released" | "error";
  readonly version?: number;
  readonly environment?: string;
  readonly rollback?: boolean;
  readonly message?: string;
}

export const IDLE_RELEASE: ReleaseState = { status: "idle" };

/**
 * The combined publish-and-release result (finding 2's first mitigation).
 *
 * `rejected` carries the publish issues, exactly as {@link PublishState} does, because the
 * publish half can refuse for every reason an ordinary publish can and the author needs
 * the same work list. There is no half-done status: the API writes both or neither.
 */
export interface PublishReleaseState {
  readonly status: "idle" | "released" | "rejected" | "error";
  readonly version?: number;
  readonly environment?: string;
  readonly issues?: readonly FormIssue[];
  readonly message?: string;
}

export const IDLE_PUBLISH_RELEASE: PublishReleaseState = { status: "idle" };

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
