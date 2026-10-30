import type { FormDefinition, QuestionDefinition, QuestionId } from "@roonga/qcms-core";

import type { PublishIssue, PublishWarning } from "../forms/handler.js";

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

/** What a draft projection tells the model: the visible set, never an answer value. */
export interface DraftProjection {
  readonly visibleSteps: readonly string[];
  readonly visibleQuestions: readonly string[];
  readonly complete: boolean;
}

/**
 * Hypothetical answers travel inward only, from the model to the kernel; nothing a
 * respondent submitted is read here.
 */
export type ProjectDraftPort = (
  answers: Readonly<Record<string, unknown>>,
) => Promise<DraftProjection>;

/** The SEC-3 cell a read tool declares, checked for the calling principal by the door. */
export interface ToolCell {
  readonly resource: string;
  readonly action: string;
}

/**
 * One turn's context: the screen's facts, the tools it declares and the ports those tools
 * close over. A port absent is a tool the screen does not offer, which is why no tool can
 * reach past its own screen (SEC-17). {@link AssistContext} is the builder's own shape.
 */
export interface AgentContext {
  readonly screen: string;
  /** The screen's typed facts, already validated against its strict schema. */
  readonly facts: unknown;
  readonly conversation: readonly AssistTurn[];
  readonly maxSteps: number;
  /** The screen's declared list; the door refuses every other name. */
  readonly tools: readonly string[];
  /** The policy evaluator, closed over this caller and this screen's workspace. */
  readonly authorize: (cell: ToolCell) => Promise<void>;
  readonly draft?: FormDefinition;
  readonly questionLibrary?: QuestionLibraryPort;
  readonly validate?: ValidateDraftPort;
  readonly projectDraft?: ProjectDraftPort;
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
  assist(context: AgentContext, signal: AbortSignal): AsyncIterable<AssistEvent>;
}
