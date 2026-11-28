import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";

import { NO_USAGE, type Usage } from "./budget.js";
import type { ModelCall, RecordedRequest, RecordedToolCall } from "./trace.js";

type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];
type WrappedModel = ReturnType<typeof wrapLanguageModel>;
type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type CallOptions = Parameters<WrapStream>[0]["params"];
type StreamResult = Awaited<ReturnType<WrapStream>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

function toolChoiceOf(choice: CallOptions["toolChoice"]): string | null {
  if (choice === undefined) return null;
  return choice.type === "tool" ? `tool:${choice.toolName}` : choice.type;
}

/**
 * Every field is named, never spread: `headers` carries the key and must not reach a file,
 * and `abortSignal` is not data at all.
 */
export function requestOf(params: CallOptions): RecordedRequest {
  return {
    messages: params.prompt,
    tools: (params.tools ?? []).map((tool) => tool.name),
    toolChoice: toolChoiceOf(params.toolChoice),
    maxOutputTokens: params.maxOutputTokens ?? null,
    temperature: params.temperature ?? null,
    providerOptions: params.providerOptions ?? null,
  };
}

/**
 * The provider reports the uncached input, the cache read and the cache write apart, and a
 * total holding all three; the cap charges three of the four, so none of them is folded in.
 */
function usageOf(usage: Extract<StreamPart, { type: "finish" }>["usage"]): Usage {
  const input = usage.inputTokens;
  const cacheReadTokens = input.cacheRead ?? 0;
  const cacheWriteTokens = input.cacheWrite ?? 0;
  return {
    inputTokens:
      input.noCache ?? Math.max(0, (input.total ?? 0) - cacheReadTokens - cacheWriteTokens),
    outputTokens: usage.outputTokens.total ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

export interface ModelRecorder {
  readonly middleware: LanguageModelMiddleware;
  /** The calls since the last read, in order, which this clears. */
  takeCalls(): ModelCall[];
  /** The model under test with the recorder around it. */
  wrap(model: WrappableModel): WrappedModel;
}

export function createRecorder(now: () => Date = () => new Date()): ModelRecorder {
  const calls: ModelCall[] = [];

  const middleware = {
    specificationVersion: "v4",
    wrapStream: async ({ doStream, params, model }) => {
      const result = await doStream();
      const at = now().toISOString();
      const request = requestOf(params);
      const toolCalls: RecordedToolCall[] = [];
      let modelId = model.modelId;
      let finishReason = "unknown";
      let usage = NO_USAGE;
      let recorded = false;

      const record = (): void => {
        if (recorded) return;
        recorded = true;
        calls.push({ at, modelId, request, toolCalls, finishReason, usage });
      };

      const stream = result.stream.pipeThrough(
        new TransformStream<StreamPart, StreamPart>({
          transform(part, controller) {
            if (part.type === "response-metadata") modelId = part.modelId ?? modelId;
            if (part.type === "tool-call")
              toolCalls.push({ name: part.toolName, input: part.input });
            if (part.type === "finish") {
              finishReason = part.finishReason.unified;
              usage = usageOf(part.usage);
              record();
            }
            controller.enqueue(part);
          },
          flush() {
            record();
          },
        }),
      );
      return { ...result, stream };
    },
  } satisfies LanguageModelMiddleware;

  return {
    middleware,
    takeCalls: () => calls.splice(0, calls.length),
    wrap: (model) => wrapLanguageModel({ model, middleware }),
  };
}
