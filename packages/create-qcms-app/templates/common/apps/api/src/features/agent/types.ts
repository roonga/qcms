import type { FormDefinition, QuestionDefinition, QuestionId } from "@roonga/qcms-core";

import type { PublishIssue, PublishWarning } from "../forms/handler.js";
import type { OfferedActionKind } from "./grant-filter.js";
import type { Proposal, ProposedStep, ProposeOutcome } from "./tools/propose.js";

export interface AssistTextTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** One step's outcome, carrying the kind's allowlisted non-secret result fields only. */
export interface ActionStepResult {
  readonly kind: string;
  readonly outcome: "done" | "failed" | "pending-approval" | "not-run" | "cancelled" | "expired";
  readonly result?: Readonly<Record<string, string | number | boolean | undefined>> | undefined;
}

/**
 * What ran, what failed and what did not run, after the user confirmed a card or a plan
 * (section 5.3). The admin writes it, so no model text reaches it, and the allowlist is
 * what keeps a minted URL, a secret or an export's bytes out of it.
 */
export interface ActionResultTurn {
  readonly role: "action-result";
  readonly proposalId: string;
  readonly steps: readonly ActionStepResult[];
}

export type AssistTurn = AssistTextTurn | ActionResultTurn;

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

/**
 * The propose tools' port. It validates, filters and signs; it executes nothing, so a
 * screen that offers no action kind simply has no port.
 */
export type ProposePort = (input: {
  readonly steps: readonly ProposedStep[];

  readonly proposalsThisTurn: number;
  /**
   * The draft this turn proposed, if it proposed one. The kind that applies it is refused
   * without it, so no card can offer to apply a draft the server never validated.
   */
  readonly proposedDraft?:
    | {
        readonly definition: FormDefinition;
        readonly newQuestions: readonly QuestionDefinition[];
      }
    | undefined;
}) => Promise<ProposeOutcome>;

export interface RuleVerdict {
  readonly ruleId: string;
  readonly outcome: "match" | "noMatch" | "unavailable";
  readonly reason: string | null;
  readonly references: readonly string[];
  readonly targetGroupId: string | null;
  readonly instanceOutcomes:
    readonly { readonly instanceId: string; readonly outcome: "match" | "noMatch" }[] | null;
}

/**
 * Hypothetical answers travel inward only, as {@link ProjectDraftPort}'s do: these are the
 * model's own hypotheses and nothing a respondent submitted is read.
 */
export type TestRulePort = (input: {
  readonly ruleId: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly instances?: Readonly<Record<string, readonly string[]>> | undefined;
}) => Promise<RuleVerdict>;

/** Structure only: which ids moved, and how many rules each side carries. */
export interface FormVersionDiff {
  readonly from: string;
  readonly to: string;
  readonly fromFound: boolean;
  readonly toFound: boolean;
  readonly identical: boolean;
  readonly stepsAdded: readonly string[];
  readonly stepsRemoved: readonly string[];
  readonly questionsAdded: readonly string[];
  readonly questionsRemoved: readonly string[];
  readonly questionsRepinned: readonly {
    readonly questionId: string;
    readonly from: number;
    readonly to: number;
  }[];
  readonly ruleCountFrom: number;
  readonly ruleCountTo: number;
}

/** `null` names the working draft on either side, which is what the versions screen diffs against. */
export type DiffFormVersionsPort = (input: {
  readonly from: number | null;
  readonly to: number | null;
}) => Promise<FormVersionDiff>;

export interface LinkCounts {
  readonly environment: string;
  readonly active: number;
  readonly consumed: number;
  readonly revoked: number;
  readonly expired: number;
  readonly total: number;
}

export type CountLinksPort = () => Promise<LinkCounts>;

/** The response list's own four filters and nothing else; no filter takes an answer value. */
export interface ResponseFilterInput {
  readonly version?: number | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly flagged?: boolean | undefined;
  readonly limit: number;
}

/** Metadata only, under the same projection the response screens' facts use. */
export interface ResponseMetadataRow {
  readonly sessionId: string;
  readonly formVersion: number;
  readonly startedAt: string | null;
  readonly submittedAt: string | null;
  readonly accessMode: string;
  readonly flagged: boolean;
  readonly flaggedReason: string | null;
}

export interface ResponsePage {
  readonly total: number;
  readonly responses: readonly ResponseMetadataRow[];
}

export type ListResponsesPort = (input: ResponseFilterInput) => Promise<ResponsePage>;

export type CountResponsesPort = (
  input: Omit<ResponseFilterInput, "limit">,
) => Promise<{ readonly total: number }>;

/** Delivery state and timing, never a payload, a response body or a last-error string. */
export interface DeliveryStatusReport {
  readonly scanned: number;
  readonly truncated: boolean;
  readonly delivered: number;
  readonly pending: number;
  readonly dead: number;
  readonly cancelled: number;
  readonly endpoints: readonly {
    readonly webhookId: string;
    readonly url: string;
    readonly active: boolean;
  }[];
}

export type DeliveryStatusPort = (input: {
  readonly webhookId?: string | undefined;
}) => Promise<DeliveryStatusReport>;

export interface DeadLetterCounts {
  readonly scanned: number;
  readonly truncated: boolean;
  readonly total: number;
  readonly byForm: readonly { readonly formId: string; readonly count: number }[];
}

export type CountDeadLettersPort = () => Promise<DeadLetterCounts>;

/** Which top-level members of the definition differ, never their content. */
export interface QuestionVersionDiff {
  readonly questionId: string;
  readonly from: number;
  readonly to: number;
  readonly fromFound: boolean;
  readonly toFound: boolean;
  readonly identical: boolean;
  readonly statusFrom: string | null;
  readonly statusTo: string | null;
  readonly typeFrom: string | null;
  readonly typeTo: string | null;
  readonly changedFields: readonly string[];
}

export type DiffQuestionVersionsPort = (input: {
  readonly from: number;
  readonly to: number;
}) => Promise<QuestionVersionDiff>;

export interface FormSearchResult {
  readonly environment: string;
  readonly matched: number;
  readonly forms: readonly {
    readonly formId: string;
    readonly slug: string;
    readonly title: string | null;
    readonly latestVersion: number | null;
    readonly releasedVersion: number | null;
    readonly closed: boolean;
  }[];
}

export type SearchFormsPort = (input: {
  readonly query?: string | undefined;
  readonly limit: number;
}) => Promise<FormSearchResult>;

/** The permission cell a read tool declares, checked for the calling principal by the door. */
export interface ToolCell {
  readonly resource: string;
  readonly action: string;
}

/**
 * One turn's context: the screen's facts, the tools it declares and the ports those tools close over. A port
 * absent is a tool the screen does not offer, which is why no tool can reach past its own screen. {@link
 * AssistContext} is the builder's own shape.
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
  /**
   * D1 to D7's read ports. Each one re-makes the grant check its own screen's read makes,
   * including the per-form and installation-wide checks the door's single cell cannot
   * express, so a port absent and a port refused are both "nothing" to the model.
   */
  readonly testRule?: TestRulePort;
  readonly diffFormVersions?: DiffFormVersionsPort;
  readonly countLinks?: CountLinksPort;
  readonly listResponses?: ListResponsesPort;
  readonly countResponses?: CountResponsesPort;
  readonly deliveryStatus?: DeliveryStatusPort;
  readonly countDeadLetters?: CountDeadLettersPort;
  readonly diffQuestionVersions?: DiffQuestionVersionsPort;
  readonly searchForms?: SearchFormsPort;
  /** Absent on a screen with no action kind, which is what leaves its propose tools unoffered. */
  readonly propose?: ProposePort;
  /**
   * What the grant filter offered this caller on this screen, which is what narrows the
   * propose tools' advertised schemas. Empty means this user changes nothing here.
   */
  readonly offeredActionKinds?: readonly OfferedActionKind[];
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
  /** No error text travels: it would be assembled from model-supplied input. */
  | { readonly type: "tool-outcome"; readonly step: number; readonly outcome: "done" | "failed" }
  /** `segment` is the provider's text-segment id, so prose interleaves with timeline rows. */
  | { readonly type: "text"; readonly delta: string; readonly segment?: string }
  /** Provider reasoning summary, forwarded only under `summary`; never logged, stored or replayed. */
  | { readonly type: "reasoning"; readonly delta: string }
  | { readonly type: "reasoning-end" }
  /** A tool call outside the allowlist was refused server-side. */
  | { readonly type: "tool-rejected"; readonly tool: string }
  /**
   * One proposed action, or one ordered plan. The steps and their arguments are the admin's to display; the
   * token is what Confirm carries. Nothing has run.
   */
  | { readonly type: "action"; readonly proposal: Proposal }
  | { readonly type: "plan"; readonly proposal: Proposal }
  | { readonly type: "error"; readonly code: AssistErrorCode; readonly message: string }
  /** Counts only, never content. */
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
