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
  NoSuchToolError,
  stepCountIs,
  streamText,
  type JSONValue,
  type LanguageModel,
  type TextStreamPart,
  type ToolSet,
} from "ai";

import type { FormDefinition } from "@roonga/qcms-core";

import type { Config } from "../../../config.js";
import type { Logger } from "../../../logger.js";
import { fakeAssistantModel } from "./fake-model.js";
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "./system-prompt.js";
import {
  assistToolSet,
  createProposalState,
  isAllowedToolName,
  type ProposalState,
} from "./tools.js";
import type { AssistContext, AssistEvent, DraftAssistant } from "./types.js";

/** The SDK's per-provider options passthrough, spelled without importing its
 * internal provider package. */
type ProviderOptions = Record<string, Record<string, JSONValue>>;

/** What the loop learned by the time the stream ended. */
interface RunOutcome {
  rationale: string;
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

/** Extract the attempted tool name from whatever shape the SDK reports it in. */
function refusedToolName(error: unknown): string | undefined {
  if (NoSuchToolError.isInstance(error)) return error.toolName;
  return undefined;
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
}): DraftAssistant {
  const { model, providerId, logger, providerOptions } = options;

  return {
    assist(ctx: AssistContext, signal: AbortSignal): AsyncIterable<AssistEvent> {
      const state = createProposalState();
      return runTurn({ ctx, signal, model, providerId, logger, providerOptions, state });
    },
  };
}

/** Record a stream failure: a refused tool if that is what it is, else a provider error. */
function noteFailure(outcome: RunOutcome, raw: unknown): void {
  const refused = refusedToolName(raw);
  if (refused === undefined) {
    outcome.providerError = errorMessage(raw);
    outcome.providerRetryable = providerRetryAdvice(raw);
    outcome.providerStatus = providerStatusCode(raw);
  } else {
    outcome.rejectedTool = refused;
  }
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
 * A refusal is the one exception and still travels: an unallowlisted verb
 * arrives as a `tool-error` too, and that one **must** stop the turn (041's
 * allowlist control - a model that reached for `publish` gets none of its other
 * work accepted).
 */
function noteToolFailure(outcome: RunOutcome, raw: unknown): void {
  const refused = refusedToolName(raw);
  if (refused === undefined) {
    outcome.toolErrors += 1;
  } else {
    outcome.rejectedTool = refused;
  }
}

/**
 * Map one SDK stream part onto the slice's own event vocabulary, recording what
 * the turn's terminal events will need. Returns `undefined` for parts that only
 * update the outcome.
 */
function handlePart(part: TextStreamPart<ToolSet>, outcome: RunOutcome): AssistEvent | undefined {
  switch (part.type) {
    case "start-step":
      outcome.steps += 1;
      return { type: "status", phase: "thinking" };
    case "text-delta":
      outcome.rationale += part.text;
      return { type: "text", delta: part.text };
    case "tool-call":
      // Defence in depth: `assistToolSet` never offered a verb outside the
      // allowlist and `runAssistTool` would refuse it, but the refusal is
      // *observed* here so the turn ends refused rather than half-done.
      if (isAllowedToolName(part.toolName)) {
        return { type: "status", phase: "tool", tool: part.toolName };
      }
      outcome.rejectedTool = part.toolName;
      return undefined;
    case "tool-error":
      noteToolFailure(outcome, part.error);
      return undefined;
    case "error":
      noteFailure(outcome, part.error);
      return undefined;
    case "finish":
      outcome.finishReason = part.finishReason;
      outcome.inputTokens = part.totalUsage.inputTokens ?? 0;
      outcome.outputTokens = part.totalUsage.outputTokens ?? 0;
      return undefined;
    default:
      return undefined;
  }
}

async function* runTurn(args: {
  ctx: AssistContext;
  signal: AbortSignal;
  model: LanguageModel;
  providerId: string;
  logger: Logger;
  providerOptions: ProviderOptions | undefined;
  state: ProposalState;
}): AsyncGenerator<AssistEvent> {
  const { ctx, signal, model, providerId, logger, providerOptions, state } = args;
  const outcome: RunOutcome = {
    rationale: "",
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    finishReason: "unknown",
    rejectedTool: undefined,
    providerError: undefined,
    providerRetryable: true,
    providerStatus: undefined,
    toolErrors: 0,
  };

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages: toModelMessages(ctx),
    tools: assistToolSet(ctx, state),
    stopWhen: stepCountIs(ctx.maxSteps),
    abortSignal: signal,
    // The SDK's per-provider passthrough. Empty by default; this is the seam a
    // deployment uses for vendor capabilities (prompt caching over the frozen
    // system prompt, reasoning budgets, safety settings) without this file
    // learning anything vendor-shaped.
    providerOptions: providerOptions ?? {},
  });

  try {
    for await (const part of result.stream) {
      const event = handlePart(part, outcome);
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
      message:
        "The assistant reached its step limit before proposing a draft. " +
        "Try a smaller request, or raise QCMS_AGENT_MAX_STEPS.",
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
 * a model that reached for `publish` does not get its other work accepted.
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
      rationale: outcome.rationale.trim(),
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
export function selectDraftAssistant(config: Config, logger: Logger): DraftAssistant {
  const agent = config.agent;
  if (agent.provider === "none") return unavailableDraftAssistant;

  let pending: Promise<DraftAssistant> | undefined;
  return {
    assist(ctx: AssistContext, signal: AbortSignal): AsyncIterable<AssistEvent> {
      pending ??= resolveModel(agent).then((model) =>
        aiSdkDraftAssistant({ model, providerId: agent.provider, logger }),
      );
      return deferred(pending, ctx, signal);
    },
  };
}
