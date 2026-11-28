import { z } from "zod";

import type { AssistEvent } from "../src/features/agent/types.js";
import { sumUsage, type Usage } from "./budget.js";

export const TRACE_VERSION = 1;

/** What the provider was sent, never how: a header carries the key and none is recorded. */
export interface RecordedRequest {
  readonly messages: readonly unknown[];
  readonly tools: readonly string[];
  readonly toolChoice: string | null;
  readonly maxOutputTokens: number | null;
  readonly temperature: number | null;
  readonly providerOptions: Record<string, unknown> | null;
}

export interface RecordedToolCall {
  readonly name: string;
  readonly input: unknown;
}

/** One provider call, which is one step of the turn's tool loop. */
export interface ModelCall {
  readonly at: string;
  readonly modelId: string;
  readonly request: RecordedRequest;
  readonly toolCalls: readonly RecordedToolCall[];
  readonly finishReason: string;
  readonly usage: Usage;
}

export interface TurnTrace {
  readonly index: number;
  readonly message: string;
  readonly calls: readonly ModelCall[];
  readonly events: readonly AssistEvent[];
}

export interface TraceModels {
  readonly requested: string;
  /** The id the provider answered with, which can differ from the one asked for. */
  readonly reported: string | null;
  readonly grader: string;
}

export interface ScenarioTrace {
  readonly version: number;
  readonly runId: string;
  readonly scenarioId: string;
  readonly rep: number;
  readonly safety: boolean;
  readonly models: TraceModels;
  readonly thinking: string;
  readonly promptVersion: number;
  readonly gitSha: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly turns: readonly TurnTrace[];
}

const UsageShape = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
});

const RequestShape = z.object({
  messages: z.array(z.unknown()),
  tools: z.array(z.string()),
  toolChoice: z.string().nullable(),
  maxOutputTokens: z.number().nullable(),
  temperature: z.number().nullable(),
  providerOptions: z.record(z.string(), z.unknown()).nullable(),
});

const CallShape = z.object({
  at: z.string().min(1),
  modelId: z.string().min(1),
  request: RequestShape,
  toolCalls: z.array(z.object({ name: z.string().min(1), input: z.unknown() })),
  finishReason: z.string().min(1),
  usage: UsageShape,
});

const TurnShape = z.object({
  index: z.number().int().positive(),
  message: z.string(),
  calls: z.array(CallShape),
  events: z.array(z.object({ type: z.string().min(1) })),
});

const TraceShape = z.object({
  version: z.literal(TRACE_VERSION),
  runId: z.string().min(1),
  scenarioId: z.string().min(1),
  rep: z.number().int().positive(),
  safety: z.boolean(),
  models: z.object({
    requested: z.string().min(1),
    reported: z.string().nullable(),
    grader: z.string().min(1),
  }),
  thinking: z.string().min(1),
  promptVersion: z.number().int().nonnegative(),
  gitSha: z.string(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  turns: z.array(TurnShape),
});

export function traceProblems(value: unknown): string[] {
  const parsed = TraceShape.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

export function parseTrace(value: unknown): ScenarioTrace {
  TraceShape.parse(value);
  // Validated above. The halves the model supplies, a tool input and an assist event, stay
  // `unknown` and a union respectively, which the schema cannot restate.
  return value as ScenarioTrace;
}

export function stepsOf(turn: TurnTrace): number {
  return turn.calls.length;
}

export function stopReasonOf(turn: TurnTrace): string {
  return turn.calls.at(-1)?.finishReason ?? "unknown";
}

export function usageOfTurn(turn: TurnTrace): Usage {
  return sumUsage(turn.calls.map((call) => call.usage));
}

export function usageOfTrace(trace: ScenarioTrace): Usage {
  return sumUsage(trace.turns.map((turn) => usageOfTurn(turn)));
}

/** The text the person reads, which is every text delta of the turn in order. */
export function replyOf(turn: TurnTrace): string {
  return turn.events
    .filter((event): event is Extract<AssistEvent, { type: "text" }> => event.type === "text")
    .map((event) => event.delta)
    .join("");
}

export interface TracedToolCall {
  readonly turn: number;
  readonly step: number;
  readonly name: string;
  readonly input: unknown;
  /** False where the call named a tool that step was never offered, which the route refuses. */
  readonly offered: boolean;
}

export function toolCallsOf(trace: ScenarioTrace): TracedToolCall[] {
  return trace.turns.flatMap((turn) =>
    turn.calls.flatMap((call, step) =>
      call.toolCalls.map((made) => ({
        turn: turn.index,
        step: step + 1,
        name: made.name,
        input: made.input,
        offered: call.request.tools.includes(made.name),
      })),
    ),
  );
}

export function refusedToolCallsOf(trace: ScenarioTrace): TracedToolCall[] {
  return toolCallsOf(trace).filter((call) => !call.offered);
}

/** The one id in a set, or `null` where the ids disagree or there are none. */
export function onlyId(ids: Iterable<string>): string | null {
  const unique = new Set(ids);
  const [only] = [...unique];
  return unique.size === 1 && only !== undefined ? only : null;
}

/** The one id every call answered with, or `null` where the calls disagree or there were none. */
export function reportedModelOf(calls: readonly ModelCall[]): string | null {
  return onlyId(calls.map((call) => call.modelId));
}
