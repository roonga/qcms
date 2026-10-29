import {
  APICallError,
  stepCountIs,
  streamText,
  type JSONValue,
  type LanguageModel,
  type StopCondition,
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

/** Spelled locally rather than importing the SDK's internal provider package. */
type ProviderOptions = Record<string, Record<string, JSONValue>>;

interface RunOutcome {
  rationale: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  rejectedTool: string | undefined;
  providerError: string | undefined;
  providerRetryable: boolean;
  /** Logged, never rendered. */
  providerStatus: number | undefined;
  /** Counted, never quoted: a tool error's text is assembled from model-supplied input. */
  toolErrors: number;
  /** The SDK's call id stays here; only the ordinal reaches the client. */
  readonly toolSteps: Map<string, number>;
}

/** A first user turn rather than part of the system prompt, which must stay cacheable. */
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
  // The SDK's own message, relayed to an authenticated admin; it never carries our key (SEC-8).
  return error instanceof Error ? error.message : "The model provider call failed";
}

/**
 * Reads the SDK's own `isRetryable` so nothing here parses vendor text (SEC-8), and
 * defaults to `true` so only positive evidence produces permanent-failure advice.
 */
function providerRetryAdvice(error: unknown): boolean {
  if (APICallError.isInstance(error)) return error.isRetryable;
  if (typeof error === "object" && error !== null && "isRetryable" in error) {
    const { isRetryable } = error;
    if (typeof isRetryable === "boolean") return isRetryable;
  }
  return true;
}

function providerStatusCode(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const { statusCode } = error;
    if (typeof statusCode === "number") return statusCode;
  }
  return undefined;
}

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

function noteFailure(outcome: RunOutcome, raw: unknown): void {
  outcome.providerError = errorMessage(raw);
  outcome.providerRetryable = providerRetryAdvice(raw);
  outcome.providerStatus = providerStatusCode(raw);
}

/**
 * One failed tool call is not a failed turn: the SDK hands the error back and the model
 * usually corrects itself. A refused verb also arrives here and is deliberately not
 * counted, since {@link handlePart} already recorded it off the paired `tool-call` part.
 */
function noteToolFailure(outcome: RunOutcome, toolName: string): void {
  if (!isAllowedToolName(toolName)) return;
  outcome.toolErrors += 1;
}

/**
 * An executor that refused its input answers `accepted: false`, which is a result and
 * not a success. No text from the result or the error is forwarded.
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

function handlePart(part: TextStreamPart<ToolSet>, outcome: RunOutcome): AssistEvent | undefined {
  switch (part.type) {
    case "start-step":
      outcome.steps += 1;
      return { type: "status", phase: "thinking" };
    case "text-delta":
      outcome.rationale += part.text;
      return { type: "text", delta: part.text };
    case "tool-call":
      // Defence in depth: the only place the outcome is made refused, so the turn ends
      // refused rather than half-done. `stopOnRejectedTool` is what ends the loop.
      if (isAllowedToolName(part.toolName)) {
        const step = outcome.toolSteps.size + 1;
        outcome.toolSteps.set(part.toolCallId, step);
        return { type: "status", phase: "tool", tool: part.toolName, step };
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
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Stops a refused turn billing a real provider for the rest of the step budget. Reads the
 * SDK's step record, since `outcome.rejectedTool` is set by the draining consumer and
 * would race.
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
    toolSteps: new Map(),
  };

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages: toModelMessages(ctx),
    tools: assistToolSet(ctx, state),
    stopWhen: [stepCountIs(ctx.maxSteps), stopOnRejectedTool],
    abortSignal: signal,
    // The seam for vendor capabilities, so nothing in this file is vendor-shaped.
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
 * `tool-calls` as the last finish reason is what separates a step-exhausted turn from
 * one where the model simply never answered; they look identical otherwise.
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
      // This string reaches a client, so it names the behaviour and never the
      // environment variable behind it (ADR-24).
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

/** A refused turn produces no proposal at all, whatever else it managed to do. */
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
    // A count, never the text: a tool error's message is assembled from model input (SEC-8).
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
    // Logged because the panel shows the operator no vendor detail, so a permanent
    // refusal would otherwise leave no trace. No vendor message, code or URL (SEC-8).
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

  // Always the server's own validation, even if the model already called validate_draft.
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

/** Only reachable by a composition error, since nothing mounts the routes when off. */
const UNAVAILABLE: AssistEvent = {
  type: "error",
  code: "PROVIDER_ERROR",
  message: "Agent-assisted authoring is not enabled on this deployment.",
};

async function* once(event: AssistEvent): AsyncGenerator<AssistEvent> {
  // Structural: the linter rejects an async generator with no suspension point.
  await Promise.resolve();
  yield event;
}

export const unavailableDraftAssistant: DraftAssistant = {
  assist: () => once(UNAVAILABLE),
};

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
      // Config validation requires `baseUrl` here, so the fallback is unreachable and
      // only keeps the call total for the type checker.
      return createOpenAICompatible({ name: "qcms-agent", baseURL: baseUrl ?? "", apiKey })(model);
    }
  }
}

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
 * Vendor packages are imported on first use so a `none` deployment loads none of them
 * and the composition root stays synchronous; config validation already settled the key.
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
