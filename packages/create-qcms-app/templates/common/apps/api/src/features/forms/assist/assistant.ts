/**
 * The `DraftAssistant` implementations and their selector (041).
 *
 * One tool loop, built on the Vercel AI SDK's `streamText`, serves every
 * provider: switching vendor or model is configuration (`QCMS_FLAG_AGENT_AUTHORING`
 * + `QCMS_AGENT_MODEL` + `QCMS_AGENT_API_KEY` + optional `QCMS_AGENT_BASE_URL`)
 * and a restart, never a code change (ADR-24 semantics). The deterministic
 * `fake` provider is the *same* loop with a scripted model swapped in, which is
 * what lets CI exercise the real allowlist, the real tool dispatch and the real
 * event mapping without a provider account.
 */

import {
  APICallError,
  stepCountIs,
  streamText,
  type LanguageModel,
  type StopCondition,
  type TextStreamPart,
  type ToolSet,
} from "ai";

import type { FormDefinition } from "@roonga/qcms-core";

import type { AgentThinking, Config } from "../../../config.js";
import type { Logger } from "../../../logger.js";
import { fakeAssistantModel } from "./fake-model.js";
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "./system-prompt.js";
import { thinkingProviderOptions, type ProviderOptions } from "./thinking.js";
import {
  assistToolSet,
  createProposalState,
  isAllowedToolName,
  type ProposalState,
} from "./tools.js";
import type { AssistContext, AssistEvent, DraftAssistant } from "./types.js";

/** One prose segment of a turn: the provider's segment id and what it said. */
export interface TextSegment {
  readonly id: string;
  text: string;
}

/** What the loop learned by the time the stream ended. */
export interface RunOutcome {
  /**
   * The turn's prose, split at the provider's own text-segment boundaries
   * (streaming improvement 3). A new entry starts whenever the id changes, so a
   * provider that reuses an id across steps still produces two segments.
   */
  readonly textSegments: TextSegment[];
  steps: number;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  rejectedTool: string | undefined;
  providerError: string | undefined;
  /** What the provider said about trying again. See {@link providerRetryAdvice}. */
  providerRetryable: boolean;
  /** The upstream HTTP status, when the failure had one. Logged, never rendered. */
  providerStatus: number | undefined;
  /**
   * How many individual tool calls failed during the turn. Counted, never
   * quoted: a tool error's text is assembled from model-supplied input.
   */
  toolErrors: number;
  /**
   * The step ordinal each allowlisted tool call was announced with, keyed by the
   * SDK's call id. The id stays here; only the ordinal reaches the client.
   */
  readonly toolSteps: Map<string, number>;
  /** The provider's reasoning token count for the turn. Counted, never quoted (SEC-8). */
  reasoningTokens: number;
}

/**
 * Append a text delta to the turn's segment column and return the segment it
 * landed in. Exported for its unit test.
 */
export function appendTextSegment(segments: TextSegment[], id: string, delta: string): string {
  const last = segments.at(-1);
  if (last !== undefined && last.id === id) last.text += delta;
  else segments.push({ id, text: delta });
  return id;
}

/** The turn's last prose segment, which is what the proposal card quotes. */
function lastSegmentText(segments: readonly TextSegment[]): string {
  return segments.at(-1)?.text ?? "";
}

/**
 * The current draft is handed to the model as the first user turn rather than
 * folded into the system prompt, so the system prompt stays byte-identical
 * across turns. That is what makes it worth caching upstream, and it is the only
 * reason the split exists.
 */
function draftPreamble(draft: FormDefinition): string {
  return [
    "The current draft of this form is:",
    "```json",
    JSON.stringify(draft, null, 2),
    "```",
    "Propose changes to it. Nothing below this line is a respondent's data;",
    "you have no access to any.",
  ].join("\n");
}

function toModelMessages(ctx: AssistContext): { role: "user" | "assistant"; content: string }[] {
  return [
    { role: "user" as const, content: draftPreamble(ctx.draft) },
    ...ctx.conversation.map((turn) => ({ role: turn.role, content: turn.content })),
  ];
}

function errorMessage(error: unknown): string {
  // Provider errors are relayed to an authenticated admin, so the message is
  // useful. It is the SDK's own message and never carries our key (SEC-8).
  return error instanceof Error ? error.message : "The model provider call failed";
}

/**
 * Whether the provider said trying again could work (issue #818).
 *
 * One error code held two conditions with opposite guidance: "the vendor is
 * down", where waiting is the right advice, and "this account cannot pay for the
 * call", where waiting is the wrong advice and the operator has to go and do
 * something. A real turn against a funded-then-emptied account showed the second
 * one rendered as the first - `429 insufficient_quota`, `isRetryable: false`,
 * and an assist panel saying "try again shortly".
 *
 * The SDK already knows. It sets `isRetryable` at the point the failure is built
 * (429 and 5xx are retryable by default; a provider narrows that, and the OpenAI
 * package explicitly excludes `insufficient_quota`), so the distinction is
 * available **without parsing vendor text**, which is what keeps SEC-8 intact:
 * nothing here reads a vendor message, a vendor code or a URL, and none of them
 * reaches the operator.
 *
 * Two shapes carry the flag - `APICallError` for a failed request, and the
 * plain stream-error payload a provider emits mid-stream - and only the first is
 * re-exported by `ai`. The second is read structurally rather than by pulling in
 * `@ai-sdk/provider-utils` for one type guard.
 *
 * **Defaults to `true`**, deliberately. Absent a definite "this will not
 * succeed" from the provider, the operator gets the advice they got before this
 * split existed. A wrongly-permanent message sends someone to check an account
 * that is fine; a wrongly-transient one is the failure being fixed here, and
 * only positive evidence should trigger it.
 */
function providerRetryAdvice(error: unknown): boolean {
  if (APICallError.isInstance(error)) return error.isRetryable;
  if (typeof error === "object" && error !== null && "isRetryable" in error) {
    const { isRetryable } = error;
    if (typeof isRetryable === "boolean") return isRetryable;
  }
  return true;
}

/** The upstream status code, when the failure carried one. */
function providerStatusCode(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const { statusCode } = error;
    if (typeof statusCode === "number") return statusCode;
  }
  return undefined;
}

/**
 * Build the assistant over any AI SDK language model.
 *
 * `providerOptions` is the SDK's per-provider passthrough, and it is the seam
 * through which provider-specific capabilities (Anthropic prompt caching over
 * the frozen system prompt, reasoning budgets, safety settings) are configured
 * without this file learning anything vendor-shaped.
 */
export function aiSdkDraftAssistant(options: {
  readonly model: LanguageModel;
  readonly providerId: string;
  readonly logger: Logger;
  readonly providerOptions?: ProviderOptions;
  /** Whether reasoning parts reach the client at all (081). Defaults to `off`. */
  readonly thinking?: AgentThinking;
}): DraftAssistant {
  const { model, providerId, logger, providerOptions, thinking = "off" } = options;

  return {
    assist(ctx: AssistContext, signal: AbortSignal): AsyncIterable<AssistEvent> {
      const state = createProposalState();
      return runTurn({ ctx, signal, model, providerId, logger, providerOptions, state, thinking });
    },
  };
}

/**
 * Record a stream failure as a provider error.
 *
 * It used to ask first whether the failure was a refused tool, on a
 * `NoSuchToolError.isInstance` guard it shared with {@link noteToolFailure}
 * (issue #840). The guard matched in neither place. The SDK settles an
 * unallowlisted verb entirely inside `parseToolCall`, which catches its own
 * `NoSuchToolError` and returns an `invalid: true` tool-call part rather than
 * throwing, so no refusal is thrown past the stream or enqueued as an `error`
 * part for this function to see (read against ai 7.0.92,
 * `src/generate-text/parse-tool-call.ts`). The refusal has exactly one route,
 * and it is {@link handlePart}'s `tool-call` case.
 */
function noteFailure(outcome: RunOutcome, raw: unknown): void {
  outcome.providerError = errorMessage(raw);
  outcome.providerRetryable = providerRetryAdvice(raw);
  outcome.providerStatus = providerStatusCode(raw);
}

/**
 * Record one failed tool call, which is **not** a failed turn.
 *
 * A `tool-error` part means one call did not execute: the model sent input the
 * schema refused, or an executor threw. The SDK hands the error back to the
 * model as that call's result and the loop carries on, which is exactly what a
 * capable model does with it - fix the arguments and call again. Every local
 * model observed doing real work has produced at least one.
 *
 * It used to be routed into {@link noteFailure} alongside a genuine stream
 * failure, and because a provider error is terminal that made one bad call
 * anywhere in a turn discard everything the turn went on to produce. Observed on
 * 2026-09-05: a turn that malformed a `propose_draft` call, corrected itself,
 * proposed successfully and finished with `stop` in six of twelve steps was
 * reported to the operator as "the assistant is unavailable right now" with the
 * proposal thrown away. The narration had already streamed, so the panel showed
 * a described proposal and then an unavailable provider.
 *
 * A refused verb arrives here too, and is deliberately **not counted** (issue
 * #840). The SDK reports an unallowlisted call twice - as the parsed `tool-call`
 * part, `toolName` intact and `invalid: true`, and then as the paired
 * `tool-error` part for the same call - and {@link handlePart} has already
 * recorded the refusal off the first of them. Counting the second made every
 * refused turn log `toolErrors: 1` for a call no executor ever ran, which is the
 * opposite of what the field is read for: a non-zero count means a model
 * correcting itself, and a refusal is not that. This function used to try to
 * recognise the refusal instead of skipping it, on a guard that never matched -
 * see {@link noteFailure} for why. Teaching that guard the stringified shape the
 * SDK does deliver was the alternative and was rejected: it would mean reading a
 * tool name back out of prose the SDK formats (a format 7.0.0 itself changed,
 * "preserve error type prefix in getErrorMessage"), to recover something the
 * part beside it already carries structurally. The membership test is
 * {@link isAllowedToolName}, the same one everything else in the slice uses.
 *
 * Nothing about the refusal depends on this: `outcome.rejectedTool` is what ends
 * the turn refused, and {@link stopOnRejectedTool} is what ends the loop at the
 * refusing step (issue #814). Neither reads this counter.
 */
function noteToolFailure(outcome: RunOutcome, toolName: string): void {
  if (!isAllowedToolName(toolName)) return;
  outcome.toolErrors += 1;
}

/**
 * The outcome of one announced tool call, for the panel's step timeline.
 *
 * A step is `done` only on evidence that it worked: a final `tool-result` whose
 * executor did not refuse the input (`propose_draft` answers `accepted: false` for a
 * proposal naming another form, which is a result, not a success). A `tool-error` is
 * `failed`. A call that was never announced - a refused verb - has no step and
 * produces nothing, so the refusal path is unchanged. No text from the result or the
 * error is forwarded. Exported for its unit test.
 */
export function toolOutcomeEvent(
  toolSteps: ReadonlyMap<string, number>,
  toolCallId: string,
  output: unknown,
  { preliminary = false, errored = false }: { preliminary?: boolean; errored?: boolean } = {},
): AssistEvent | undefined {
  const step = toolSteps.get(toolCallId);
  if (step === undefined || preliminary) return undefined;
  const refused =
    typeof output === "object" &&
    output !== null &&
    (output as { accepted?: unknown }).accepted === false;
  return { type: "tool-outcome", step, outcome: errored || refused ? "failed" : "done" };
}

/**
 * Announce one allowlisted tool step, once.
 *
 * Called from both `tool-input-start` and `tool-call` for the same call id. The
 * first of them to arrive wins, which is what moves the timeline row to the
 * moment the model starts streaming the call's JSON rather than the moment the
 * SDK has parsed all of it (streaming improvement 1). `propose_draft` carries a
 * whole `FormDefinition`, so that gap is the longest silent stretch of a turn.
 *
 * A name outside the allowlist produces nothing here and is **not** recorded as
 * the refusal: the refusal stays on the parsed `tool-call`, which is the only
 * part that carries a settled name, so a `tool-input-start` can neither end a
 * turn nor put an unknown verb on screen (issue #814's path is unchanged).
 */
function announceToolStep(
  outcome: RunOutcome,
  callId: string,
  toolName: string,
): AssistEvent | undefined {
  if (!isAllowedToolName(toolName) || outcome.toolSteps.has(callId)) return undefined;
  const step = outcome.toolSteps.size + 1;
  outcome.toolSteps.set(callId, step);
  return { type: "status", phase: "tool", tool: toolName, step };
}

/** A fresh outcome, which is also what a `handlePart` unit test starts from. */
export function newRunOutcome(): RunOutcome {
  return {
    textSegments: [],
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    finishReason: "unknown",
    rejectedTool: undefined,
    providerError: undefined,
    providerRetryable: true,
    providerStatus: undefined,
    toolErrors: 0,
    toolSteps: new Map(),
    reasoningTokens: 0,
  };
}

/**
 * Map one SDK stream part onto the slice's own event vocabulary, recording what
 * the turn's terminal events will need. Returns `undefined` for parts that only
 * update the outcome. Exported for its unit tests.
 */
export function handlePart(
  part: TextStreamPart<ToolSet>,
  outcome: RunOutcome,
  thinking: AgentThinking = "off",
): AssistEvent | undefined {
  switch (part.type) {
    // Reasoning is forwarded only under `summary`, and dropped under `off` **even
    // when a provider emits it unasked** (081, SEC-8). Dropping it here rather
    // than declining to request it is what makes the default a guarantee: a model
    // that volunteers thinking, or an `openai-compatible` endpoint that always
    // does, cannot get a word of it onto a screen. Nothing is accumulated either,
    // so there is no buffer for a logger or the next turn's request to read.
    case "reasoning-delta":
      return thinking === "summary" ? { type: "reasoning", delta: part.text } : undefined;
    case "reasoning-end":
      return thinking === "summary" ? { type: "reasoning-end" } : undefined;
    case "start-step":
      outcome.steps += 1;
      return { type: "status", phase: "thinking" };
    case "text-delta":
      return {
        type: "text",
        delta: part.text,
        segment: appendTextSegment(outcome.textSegments, part.id, part.text),
      };
    case "tool-input-start":
      return announceToolStep(outcome, part.id, part.toolName);
    case "tool-call":
      // Defence in depth: `assistToolSet` never offered a verb outside the
      // allowlist and `runAssistTool` would refuse it, but the refusal is
      // *observed* here so the turn ends refused rather than half-done. What
      // ends the loop is `stopOnRejectedTool`, which reads the same allowlist
      // off the SDK's step record; this line is what makes the outcome refused,
      // and it is the only place that does. The paired `tool-error` part the SDK
      // emits next is the same refused call arriving a second time, and
      // `noteToolFailure` skips it rather than counting it (issue #840).
      if (isAllowedToolName(part.toolName)) {
        return announceToolStep(outcome, part.toolCallId, part.toolName);
      }
      outcome.rejectedTool = part.toolName;
      return undefined;
    case "tool-result":
      return toolOutcomeEvent(outcome.toolSteps, part.toolCallId, part.output, {
        preliminary: part.preliminary === true,
      });
    case "tool-error":
      noteToolFailure(outcome, part.toolName);
      return toolOutcomeEvent(outcome.toolSteps, part.toolCallId, undefined, { errored: true });
    case "error":
      noteFailure(outcome, part.error);
      return undefined;
    case "finish":
      outcome.finishReason = part.finishReason;
      outcome.inputTokens = part.totalUsage.inputTokens ?? 0;
      outcome.outputTokens = part.totalUsage.outputTokens ?? 0;
      // Under `outputTokenDetails`, because reasoning tokens are billed output
      // (`ai` 7.0.147, `LanguageModelUsage`).
      outcome.reasoningTokens = part.totalUsage.outputTokenDetails.reasoningTokens ?? 0;
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Stop the loop at the step that reached for a verb outside the allowlist
 * (issue #814).
 *
 * The refusal was always **recorded** the moment it was observed, and no
 * proposal has ever survived one. What did not happen is the loop ending: the
 * only stop condition was `stepCountIs(maxSteps)`, so a model that asked for
 * `publish` was handed the SDK's "no such tool" result and asked again, up to
 * the full budget. A refused turn therefore billed a real provider for up to
 * `QCMS_AGENT_MAX_STEPS` round trips to reach a conclusion that was settled at
 * the first one, and the refused-state screenshot in #814 shows the same
 * narration eight times over.
 *
 * This is composed with the ceiling rather than replacing it, and it reads the
 * SDK's own step record rather than {@link RunOutcome}. Both choices are load
 * bearing:
 *
 * - **`stopWhen`, not an abort on the rejection event.** Aborting would end the
 *   turn through the failure path, where an `AbortError` has to be told apart
 *   from a genuine provider failure before {@link finishTurn} can still reach
 *   the refusal. `stopWhen` is the loop's own termination seam, so the turn ends
 *   the way a completed turn ends and the refusal copy stays in exactly one
 *   place: nothing about the recorded outcome, the logged record or the emitted
 *   events changes, only how many steps ran before them.
 * - **The step record, not the outcome field.** `outcome.rejectedTool` is set by
 *   {@link handlePart} as *this process* drains `result.stream`, which is
 *   decoupled from the SDK's internal loop; a predicate reading it would be
 *   racing the consumer. `steps` is what the loop has already committed, so the
 *   answer is the same on every run.
 *
 * The membership test is {@link isAllowedToolName}, the same one the tool set,
 * the dispatch door and the event mapping use. There is one allowlist.
 */
const stopOnRejectedTool: StopCondition<ToolSet> = ({ steps }) =>
  steps
    .at(-1)
    ?.content.some((part) => part.type === "tool-call" && !isAllowedToolName(part.toolName)) ??
  false;

async function* runTurn(args: {
  ctx: AssistContext;
  signal: AbortSignal;
  model: LanguageModel;
  providerId: string;
  logger: Logger;
  providerOptions: ProviderOptions | undefined;
  state: ProposalState;
  thinking: AgentThinking;
}): AsyncGenerator<AssistEvent> {
  const { ctx, signal, model, providerId, logger, providerOptions, state, thinking } = args;
  const outcome = newRunOutcome();

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages: toModelMessages(ctx),
    tools: assistToolSet(ctx, state),
    stopWhen: [stepCountIs(ctx.maxSteps), stopOnRejectedTool],
    abortSignal: signal,
    // The SDK's per-provider passthrough. Empty by default; this is the seam a
    // deployment uses for vendor capabilities (prompt caching over the frozen
    // system prompt, reasoning budgets, safety settings) without this file
    // learning anything vendor-shaped.
    providerOptions: providerOptions ?? {},
  });

  try {
    for await (const part of result.stream) {
      const event = handlePart(part, outcome, thinking);
      if (event !== undefined) yield event;
    }
  } catch (error) {
    noteFailure(outcome, error);
  }

  yield* finishTurn({ ctx, state, outcome, providerId, logger });
}

/**
 * Why a turn ended with no proposal, named precisely.
 *
 * The three cases are genuinely different problems with genuinely different
 * fixes, and telling them apart is the whole point of having three codes:
 *
 * - `LENGTH` - the model ran out of output room mid-answer. Ask for less.
 * - `STEP_LIMIT` - the model was still working when `QCMS_AGENT_MAX_STEPS` cut
 *   the loop off. It was making progress; it needed more room to make. This is
 *   the one that most needs its own name, because a step-exhausted turn and a
 *   turn where the model simply never answered look identical from the outside,
 *   and anyone tuning a prompt against a real model has to be able to tell which
 *   they are looking at. `tool-calls` as the last finish reason is what makes it
 *   unambiguous: the model had asked for another tool and the ceiling, not the
 *   model, is what stopped it.
 * - `NO_PROPOSAL` - the model finished of its own accord without proposing.
 *   Rephrase, or the model is not up to the task.
 */
function emptyTurnError(outcome: RunOutcome, maxSteps: number): AssistEvent {
  if (outcome.finishReason === "length") {
    return {
      type: "error",
      code: "LENGTH",
      message: "The model ran out of output room before proposing a draft. Try a smaller request.",
    };
  }
  if (outcome.steps >= maxSteps && outcome.finishReason === "tool-calls") {
    return {
      type: "error",
      code: "STEP_LIMIT",
      // The step ceiling is an operator setting, so the sentence says the behaviour and
      // not the variable that sets it (issue #910). Every `AssistEvent` is framed into
      // the SSE response body by `handler.ts`, which puts this string in front of a
      // client, and ADR-24's "clients receive behavior, not flag values" has reached any
      // environment identifier in a response body since the Code Owner widened it on
      // 2026-09-12. The admin never renders this prose anyway - it keys on `code` and
      // reads `forms.assist.error.STEP_LIMIT` out of its own catalog - so the operator
      // half lives where an operator sets the ceiling, in `docs/operations.md`.
      message:
        "The assistant reached its step limit before proposing a draft. " +
        "Try a smaller request, or raise the assistant's step ceiling " +
        "(docs/operations.md).",
    };
  }
  return {
    type: "error",
    code: "NO_PROPOSAL",
    message: "The assistant did not propose a draft. Try describing the form differently.",
  };
}

/**
 * Turn the accumulated outcome into terminal events.
 *
 * The refusal is emitted **and logged** here, which is the "rejected and logged"
 * half of 041's allowlist control. A refused turn produces no proposal at all:
 * a model that reached for `publish` does not get its other work accepted. It
 * also reaches here at the refusing step rather than at the step ceiling, which
 * is issue #814; the events are identical either way, so this function did not
 * have to change for that.
 */
async function* finishTurn(args: {
  ctx: AssistContext;
  state: ProposalState;
  outcome: RunOutcome;
  providerId: string;
  logger: Logger;
}): AsyncGenerator<AssistEvent> {
  const { ctx, state, outcome, providerId, logger } = args;

  logger.info("draft assistant turn", {
    provider: providerId,
    promptVersion: SYSTEM_PROMPT_VERSION,
    steps: outcome.steps,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    finishReason: outcome.finishReason,
    toolRejected: outcome.rejectedTool !== undefined,
    // A count, never the text: a tool error's message is assembled from input
    // the model wrote (SEC-8). Non-zero on a turn that still proposed is normal
    // and is how a model correcting itself looks from here.
    toolErrors: outcome.toolErrors,
    // The provider's reasoning token count, and nothing else about reasoning
    // (SEC-8). The text never reaches a logger, a span or an audit row, and
    // there is nowhere it could: `handlePart` forwards each delta and keeps
    // none, so no buffer of it exists by the time this line runs. The count is
    // here because reasoning is billed output and an operator turning `summary`
    // on has no other way to see what it costs.
    reasoningTokens: outcome.reasoningTokens,
  });

  yield {
    type: "usage",
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    steps: outcome.steps,
  };

  if (outcome.rejectedTool !== undefined) {
    logger.warn("draft assistant tool call rejected", {
      provider: providerId,
      tool: outcome.rejectedTool,
      allowlisted: false,
    });
    yield { type: "tool-rejected", tool: outcome.rejectedTool };
    yield {
      type: "error",
      code: "REFUSED",
      message: "The assistant attempted an action outside its allowed tools and was stopped.",
    };
    return;
  }

  if (outcome.providerError !== undefined) {
    // Two conditions, two codes, opposite advice (issue #818). The record is
    // logged here because the panel deliberately shows the operator no vendor
    // detail: without this line a permanent refusal leaves no trace an operator
    // can act on. Every field is ours - a provider id from configuration, a
    // boolean the SDK set, an HTTP status - and no vendor message, code or URL
    // is written (SEC-8). The event name is classified in the OTLP export
    // vocabulary (SEC-13); its attributes are outside the attribute allowlist
    // and are dropped on export, so what leaves the process is the name and a
    // count.
    logger.warn("draft assistant provider failure", {
      provider: providerId,
      retryable: outcome.providerRetryable,
      statusCode: outcome.providerStatus,
    });
    yield {
      type: "error",
      code: outcome.providerRetryable ? "PROVIDER_ERROR" : "PROVIDER_REJECTED",
      message: outcome.providerError,
    };
    return;
  }

  if (outcome.finishReason === "content-filter") {
    yield { type: "error", code: "REFUSED", message: "The model refused this request." };
    return;
  }

  if (state.proposedDraft === undefined) {
    yield emptyTurnError(outcome, ctx.maxSteps);
    return;
  }

  // The advisory validation the UI is handed is always the server's own, run
  // here even if the model already called validate_draft: the agent never hands
  // the UI a proposal it validated for itself (041).
  const { issues, warnings } = await ctx.validate(state.proposedDraft);

  yield {
    type: "proposal",
    proposal: {
      proposedDraft: state.proposedDraft,
      newQuestions: state.newQuestions,
      // The last prose segment, not every delta joined: the segments before it
      // are the narration that already streamed beside the timeline rows
      // (streaming improvement 3).
      rationale: lastSegmentText(outcome.textSegments).trim(),
      issues,
      warnings,
    },
  };
}

/**
 * The inert assistant for a deployment with the flag off. Nothing mounts the
 * assist routes there, so this is only ever reached by a composition error; it
 * fails loudly rather than silently doing nothing.
 */
const UNAVAILABLE: AssistEvent = {
  type: "error",
  code: "PROVIDER_ERROR",
  message: "Agent-assisted authoring is not enabled on this deployment.",
};

async function* once(event: AssistEvent): AsyncGenerator<AssistEvent> {
  // The await is structural, not incidental: the interface is an async iterable
  // and a generator with no suspension point is not one the linter accepts.
  await Promise.resolve();
  yield event;
}

export const unavailableDraftAssistant: DraftAssistant = {
  assist: () => once(UNAVAILABLE),
};

/**
 * Resolve the configured provider to a language model.
 *
 * Every arm is the same two lines - construct the vendor provider with the key
 * and optional base URL, then name the model - which is the point: the vendor
 * differences live entirely inside the AI SDK provider packages.
 */
async function resolveModel(agent: Extract<Config["agent"], { model: string }>) {
  const { provider, model, apiKey, baseUrl } = agent;
  const withBase = baseUrl === undefined ? {} : { baseURL: baseUrl };

  switch (provider) {
    case "fake":
      return fakeAssistantModel();
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey, ...withBase })(model);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey, ...withBase })(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey, ...withBase })(model);
    }
    case "openai-compatible": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      // `baseUrl` is required for this provider by config validation, so the
      // fallback is unreachable; it keeps the call total for the type checker.
      return createOpenAICompatible({ name: "qcms-agent", baseURL: baseUrl ?? "", apiKey })(model);
    }
  }
}

/** Await the vendor package on first use, then run the turn against it. */
async function* deferred(
  pending: Promise<DraftAssistant>,
  ctx: AssistContext,
  signal: AbortSignal,
): AsyncGenerator<AssistEvent> {
  let assistant: DraftAssistant;
  try {
    assistant = await pending;
  } catch (error) {
    yield { type: "error", code: "PROVIDER_ERROR", message: errorMessage(error) };
    return;
  }
  yield* assistant.assist(ctx, signal);
}

/**
 * Build the assistant for this deployment's configuration.
 *
 * The vendor provider package is imported on **first use**, not at boot: a
 * `none` deployment (the default) never loads any of them, a deployment that
 * picked one vendor never loads the other three, and the composition root stays
 * synchronous. Whether the key is present was already settled at boot by config
 * validation, so nothing security-relevant is deferred here.
 */
/** Spread-shaped, because `exactOptionalPropertyTypes` refuses an explicit `undefined`. */
function optionalProviderOptions(
  options: ProviderOptions | undefined,
): { providerOptions?: ProviderOptions } {
  return options === undefined ? {} : { providerOptions: options };
}

export function selectDraftAssistant(config: Config, logger: Logger): DraftAssistant {
  const agent = config.agent;
  if (agent.provider === "none") return unavailableDraftAssistant;

  let pending: Promise<DraftAssistant> | undefined;
  return {
    assist(ctx: AssistContext, signal: AbortSignal): AsyncIterable<AssistEvent> {
      pending ??= resolveModel(agent).then((model) =>
        aiSdkDraftAssistant({
          model,
          providerId: agent.provider,
          logger,
          thinking: agent.thinking,
          // The one place the setting becomes a vendor request (081, section 8).
          // `undefined` under `off`, and for the two providers with nothing to
          // ask for, so the call is byte-identical to what it was before.
          ...optionalProviderOptions(thinkingProviderOptions(agent.provider, agent.thinking)),
        }),
      );
      return deferred(pending, ctx, signal);
    },
  };
}
