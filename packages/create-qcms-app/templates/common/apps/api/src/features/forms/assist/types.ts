import type { FormDefinition, QuestionDefinition, QuestionId } from "@roonga/qcms-core";

import type { PublishIssue, PublishWarning } from "../handler.js";

export interface AssistTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Definition only: no response counts, no respondent data, no answer values. */
export interface LibraryEntry {
  readonly questionId: QuestionId;
  readonly slug: string;
  readonly version: number;
  readonly definition: QuestionDefinition;
}

/** Search rather than a preloaded array: bulk-loading would put every question in every upstream payload. */
export interface QuestionLibraryPort {
  search(query: string | undefined, limit: number): Promise<readonly LibraryEntry[]>;
}

/** Advisory only: there is no publish counterpart, by construction. */
export interface DraftVerdict {
  readonly issues: readonly PublishIssue[];
  readonly warnings: readonly PublishWarning[];
}

export type ValidateDraftPort = (definition: FormDefinition) => Promise<DraftVerdict>;

/**
 * The PII boundary is this object's shape: `validate` and `questionLibrary` are the
 * entire window, both definition-only, and neither takes a caller-controlled table,
 * query or session id.
 */
export interface AssistContext {
  readonly draft: FormDefinition;
  readonly questionLibrary: QuestionLibraryPort;
  readonly conversation: readonly AssistTurn[];
  readonly validate: ValidateDraftPort;
  readonly maxSteps: number;
}

/** Both advisory lists are server-computed, so the UI can never be handed an unvalidated proposal. */
export interface AssistProposal {
  readonly proposedDraft: FormDefinition;
  readonly newQuestions: readonly QuestionDefinition[];
  readonly rationale: string;
  readonly issues: readonly PublishIssue[];
  readonly warnings: readonly PublishWarning[];
}

/** A runtime array rather than a bare union so both halves of the contract stay enumerable in tests. */
export const ASSIST_ERROR_CODES = [
  "PROVIDER_ERROR",
  // Split from `PROVIDER_ERROR` on the SDK's own `isRetryable`, never on vendor text.
  "PROVIDER_REJECTED",
  "NO_PROPOSAL",
  "REFUSED",
  "LENGTH",
  "STEP_LIMIT",
] as const;

export type AssistErrorCode = (typeof ASSIST_ERROR_CODES)[number];

export type AssistEvent =
  /** `step` is a per-turn ordinal this slice assigns, never the provider's call id. */
  | {
      readonly type: "status";
      readonly phase: "thinking" | "tool";
      readonly tool?: string;
      readonly step?: number;
    }
  /** No error text travels: it would be assembled from model-supplied input (SEC-8). */
  | { readonly type: "tool-outcome"; readonly step: number; readonly outcome: "done" | "failed" }
  /** `segment` is the provider's text-segment id, so prose interleaves with timeline rows. */
  | { readonly type: "text"; readonly delta: string; readonly segment?: string }
  /** Provider reasoning summary, forwarded only under `summary`; never logged, stored or replayed (SEC-8). */
  | { readonly type: "reasoning"; readonly delta: string }
  | { readonly type: "reasoning-end" }
  /** A tool call outside the allowlist was refused server-side. */
  | { readonly type: "tool-rejected"; readonly tool: string }
  | { readonly type: "proposal"; readonly proposal: AssistProposal }
  | { readonly type: "error"; readonly code: AssistErrorCode; readonly message: string }
  /** Counts only, never content (SEC-8). */
  | {
      readonly type: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly steps: number;
    };

/** The caller owns the `AbortSignal` so a disconnected client stops the upstream call. */
export interface DraftAssistant {
  assist(context: AssistContext, signal: AbortSignal): AsyncIterable<AssistEvent>;
}
