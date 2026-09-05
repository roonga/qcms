/**
 * The draft-assistant seam (041, ADR-25).
 *
 * ADR-25 in one line: **the agent proposes, the kernel validates, the human
 * publishes.** An authoring agent is just another author emitting domain JSON
 * through the same gauntlet a person faces. Nothing here touches the serving
 * path, and nothing here can reach a respondent's answers.
 *
 * `DraftAssistant` is the qcms-owned port above the vendor SDK, shaped like
 * 026's `ChallengeVerifier`: one interface, one selector, implementations chosen
 * by a flag value. The Vercel AI SDK sits *below* this line, so swapping the SDK
 * itself is a change to one file rather than to the slice.
 */

import type { FormDefinition, QuestionDefinition, QuestionId } from "@roonga/qcms-core";

import type { PublishIssue, PublishWarning } from "../handler.js";

/** One conversation turn. The session is the whole memory (041 out of scope: anything longer). */
export interface AssistTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * One published question, as the agent is allowed to see it.
 *
 * Deliberately the *definition* and nothing else: no response counts, no
 * respondent data, no answer values. The library is the agent's only window onto
 * stored content, and this type is where that window's width is decided.
 */
export interface LibraryEntry {
  readonly questionId: QuestionId;
  readonly slug: string;
  readonly version: number;
  readonly definition: QuestionDefinition;
}

/**
 * The published question library, reachable only by search.
 *
 * A port rather than a preloaded array: a real library is larger than a prompt,
 * and bulk-loading it would put every question in every upstream payload.
 */
export interface QuestionLibraryPort {
  search(query: string | undefined, limit: number): Promise<readonly LibraryEntry[]>;
}

/**
 * Advisory validation (022) as the agent sees it: give it a candidate draft, get
 * back **both** advisory channels the builder's live validation shows. There is
 * no "publish" counterpart, by construction.
 *
 * Two channels rather than one, since issue #123 split them. `issues` is why a
 * publish would be refused; `warnings` is a draft that would publish and may not
 * behave as written. The port carries both because the alternative is an
 * assistant whose proposal card says "validation passes" over a draft the
 * builder will flag the moment it is accepted, which is the same claim-more-than-
 * you-know defect in a different surface. The kernel decides both; this slice
 * only relays them.
 */
export interface DraftVerdict {
  readonly issues: readonly PublishIssue[];
  readonly warnings: readonly PublishWarning[];
}

export type ValidateDraftPort = (definition: FormDefinition) => Promise<DraftVerdict>;

/**
 * Everything one assist turn is allowed to touch.
 *
 * The PII boundary is this object's shape. There is no `Executor` on it, no
 * session reader, no answer reader, no publish call, no link minting and no
 * webhook config: an implementation cannot reach respondent data because it is
 * handed nothing that could. That is what "the tool surface makes this
 * structural" means in 041 - it is not a prompt instruction the model may ignore.
 *
 * Stated precisely, because the loose version overclaims (PO review, 2026-08-13).
 * `validate` and `questionLibrary.search` are closures the handler builds over
 * `Deps`, and `Deps` does hold a database handle, so "this object carries no
 * `Executor`" is a fact about its SHAPE and not about transitive reachability.
 * The accurate statement of the control is that **these two ports are the entire
 * window, and both are definition-only**: one compiles a candidate draft, the
 * other searches published question definitions, and neither takes a
 * caller-controlled table, query or session id. `tools.test.ts` pins it from the
 * other side with a key-set assertion over this object, so a third port cannot
 * appear without that test being edited on purpose.
 */
export interface AssistContext {
  /** The form's current working draft (022) - the thing a proposal is a diff against. */
  readonly draft: FormDefinition;
  /** The published question library, search only. */
  readonly questionLibrary: QuestionLibraryPort;
  /** This session's turns, oldest first. */
  readonly conversation: readonly AssistTurn[];
  /** Advisory validation over a candidate draft (022). */
  readonly validate: ValidateDraftPort;
  /** Hard ceiling on tool-loop steps for this turn. */
  readonly maxSteps: number;
}

/**
 * What the agent proposes, after the server has validated it.
 *
 * Neither advisory list is optional and neither is client-computed: the slice
 * runs 022's advisory validation over `proposedDraft` before this leaves the
 * process, so the UI can never be handed an unvalidated proposal (041
 * deliverable). `warnings` rides beside `issues` for the reason
 * {@link ValidateDraftPort} gives: the panel shows exactly what the builder
 * would show for the same draft, and a proposal that would publish with a
 * warning says so here rather than one Accept later.
 */
export interface AssistProposal {
  readonly proposedDraft: FormDefinition;
  readonly newQuestions: readonly QuestionDefinition[];
  readonly rationale: string;
  readonly issues: readonly PublishIssue[];
  readonly warnings: readonly PublishWarning[];
}

/**
 * Machine-readable failure codes the UI renders as its error states.
 *
 * A runtime array rather than a bare union, because both halves of this contract
 * need to be enumerable. `assistant.test.ts` asserts every code here is actually
 * emitted by some scenario (no code may exist that the API cannot produce), and
 * the admin's `assist-error-codes.test.ts` asserts this exact list is the one it
 * holds copy for. Those two together are what stops a code and its message from
 * drifting apart, which is how `STEP_LIMIT` came to be declared, rendered, and
 * unreachable.
 */
export const ASSIST_ERROR_CODES = [
  "PROVIDER_ERROR",
  // The other half of what `PROVIDER_ERROR` used to hold on its own (issue
  // #818). Waiting out a transient upstream failure is right; waiting out a
  // provider that has refused the account is not, and one sentence cannot give
  // both pieces of advice. The split is drawn on the SDK's own `isRetryable`,
  // never on vendor text - see `providerRetryAdvice` in `assistant.ts`.
  "PROVIDER_REJECTED",
  "NO_PROPOSAL",
  "REFUSED",
  "LENGTH",
  "STEP_LIMIT",
] as const;

export type AssistErrorCode = (typeof ASSIST_ERROR_CODES)[number];

/**
 * The stream an assist turn produces. The SSE relay writes one event per item;
 * every variant is JSON-serialisable and value-free with respect to secrets.
 */
export type AssistEvent =
  /** Progress, for the panel's working indicator. */
  | { readonly type: "status"; readonly phase: "thinking" | "tool"; readonly tool?: string }
  /** A chunk of the assistant's prose (the rationale, streamed). */
  | { readonly type: "text"; readonly delta: string }
  /** A tool call outside the allowlist was refused server-side (041 security control). */
  | { readonly type: "tool-rejected"; readonly tool: string }
  /** The completed, server-validated proposal. Terminal. */
  | { readonly type: "proposal"; readonly proposal: AssistProposal }
  /** A terminal failure. */
  | { readonly type: "error"; readonly code: AssistErrorCode; readonly message: string }
  /** Token counts for this turn - counts only, never content (SEC-8, 041). */
  | {
      readonly type: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly steps: number;
    };

/**
 * The vendor-shaped port. One turn in, an event stream out; the caller owns the
 * `AbortSignal` so a disconnected client stops the upstream call.
 */
export interface DraftAssistant {
  assist(context: AssistContext, signal: AbortSignal): AsyncIterable<AssistEvent>;
}
