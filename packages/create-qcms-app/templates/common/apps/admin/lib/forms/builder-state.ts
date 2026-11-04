import type { DraftPreview, FormIssue, FormSettings, MintedLink } from "./types.ts";

// Keep shared state outside use-server modules, which may export only async functions.

export interface CreateFormState {
  readonly status: "idle" | "error";
  readonly code?: string;
  readonly message?: string;

  readonly submitted?: {
    readonly slug: string;
    readonly title: string;
    readonly defaultLocale: string;
  };
}

export const IDLE_CREATE_FORM: CreateFormState = { status: "idle" };

// The card variant must return instead of redirecting or it would discard later plan steps.
export interface CreateFormCardState {
  readonly status: "created" | "error";
  readonly formId?: string;
  readonly slug?: string;
  readonly message?: string;
}

export interface SaveDraftState {
  readonly status: "saved" | "error";
  readonly issues: readonly FormIssue[];
  // Compiler warnings exist only for compiled drafts and never contribute to the blocking issue count.
  readonly warnings: readonly FormIssue[];
  readonly code?: string;
  readonly message?: string;

  readonly agentAssisted?: boolean;

  readonly updatedAt?: string;
}

export interface ValidateDraftState {
  readonly status: "ok" | "error";

  readonly valid: boolean;
  readonly issues: readonly FormIssue[];
  readonly warnings: readonly FormIssue[];
  readonly message?: string;
}

export interface SettingsState {
  readonly status: "idle" | "saved" | "error";
  readonly settings?: FormSettings;

  readonly challengeEnforceable?: boolean;
  readonly message?: string;
}

// Unavailable is distinct from a non-match; failed evaluation must not teach the author that a condition was false.
export type PreviewOutcome = "match" | "noMatch" | "unavailable";

export type PreviewReason = "unparseableDraft" | "ruleNotFound" | "noTarget" | "unresolvedAnswers";

// Bound hypothetical browser allocations with the preview cap; the API remains authoritative. This cap does not replace an authored group maximum.
export const PREVIEW_INSTANCE_CAP = 50;

export interface PreviewRoster {
  readonly groupId: string;
  readonly instances: readonly string[];
}

export interface InstanceOutcome {
  readonly instanceId: string;
  readonly outcome: "match" | "noMatch";
}

export interface PreviewConditionState {
  readonly status: "idle" | "ok" | "error";
  readonly outcome?: PreviewOutcome;
  readonly reason?: PreviewReason;

  readonly references?: readonly string[];
  readonly message?: string;
  // Echo the evaluated roster so a verdict cannot be shown as though it describes newer hypothetical counts.
  readonly rosters?: readonly PreviewRoster[];

  readonly targetGroupId?: string;

  readonly instanceOutcomes?: readonly InstanceOutcome[];
}

export const IDLE_PREVIEW: PreviewConditionState = { status: "idle" };

export interface PublishState {
  readonly status: "idle" | "published" | "rejected" | "error";
  readonly version?: number;
  readonly publishedAt?: string;
  readonly issues?: readonly FormIssue[];
  readonly message?: string;
}

export const IDLE_PUBLISH: PublishState = { status: "idle" };

export interface DraftPreviewState {
  readonly status: "idle" | "loading" | "ok" | "rejected" | "error";
  readonly preview?: DraftPreview;
  readonly issues?: readonly FormIssue[];
  readonly message?: string;
}

export const IDLE_DRAFT_PREVIEW: DraftPreviewState = { status: "idle" };

// Rollback is the same release operation with an earlier version, not another outcome.
export interface ReleaseState {
  readonly status: "idle" | "released" | "error";
  readonly version?: number;
  readonly environment?: string;
  readonly rollback?: boolean;
  readonly message?: string;
}

export const IDLE_RELEASE: ReleaseState = { status: "idle" };

export interface PublishReleaseState {
  readonly status: "idle" | "released" | "rejected" | "error";
  readonly version?: number;
  readonly environment?: string;
  readonly issues?: readonly FormIssue[];
  readonly message?: string;
}

export const IDLE_PUBLISH_RELEASE: PublishReleaseState = { status: "idle" };

export interface PublishBatchRelease {
  readonly environment: string;
  readonly version: number;
  readonly rollback: boolean;
}

// Resolve uncertain results by the same idempotency key; never offer a second publish. A stale review requires another read and confirmation.
export interface PublishBatchState {
  readonly status: "idle" | "done" | "rejected" | "stale" | "uncertain" | "not-committed" | "error";
  readonly version?: number;

  readonly froze?: boolean;
  readonly releases?: readonly PublishBatchRelease[];

  readonly replayed?: boolean;
  readonly issues?: readonly FormIssue[];
  readonly message?: string;
}

export const IDLE_PUBLISH_BATCH: PublishBatchState = { status: "idle" };

export interface FormStatusState {
  readonly status: "idle" | "changed" | "error";
  readonly formStatus?: "open" | "closed";

  readonly environment?: string;
  readonly message?: string;
}

export const IDLE_FORM_STATUS: FormStatusState = { status: "idle" };

// Bearer URLs exist only in this mint result; keep them in screen memory so they can be copied once.
export interface MintLinksState {
  readonly status: "idle" | "minted" | "error";
  readonly links?: readonly MintedLink[];
  readonly message?: string;
}

export const IDLE_MINT: MintLinksState = { status: "idle" };

export interface RevokeLinkState {
  readonly status: "idle" | "revoked" | "error";
  readonly linkId?: string;
  readonly message?: string;
}

export const IDLE_REVOKE: RevokeLinkState = { status: "idle" };
