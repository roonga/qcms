import type { LanguageModelMiddleware } from "ai";
import { describe, expect, it } from "vitest";

import { createRecorder, requestOf, type ModelRecorder } from "./recorder.js";
import type { ModelCall } from "./trace.js";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type WrapOptions = Parameters<WrapStream>[0];
type CallOptions = WrapOptions["params"];
type StreamPart =
  Awaited<ReturnType<WrapStream>>["stream"] extends ReadableStream<infer Part> ? Part : never;

const KEY = "synthetic-eval-key-6f21";

const PARAMS: CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "how many steps" }] }],
  tools: [{ type: "function", name: "read_form", inputSchema: { type: "object" } }],
  toolChoice: { type: "auto" },
  maxOutputTokens: 4096,
  headers: { authorization: `Bearer ${KEY}`, "anthropic-version": "2023-06-01" },
  providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
};

const METADATA: StreamPart = { type: "response-metadata", modelId: "claude-opus-5-5-20260601" };

const PARTS: StreamPart[] = [
  METADATA,
  {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "read_form",
    input: '{"formId":"frm_eval_s00_1"}',
  },
  {
    type: "finish",
    finishReason: { unified: "tool-calls", raw: "tool_use" },
    usage: {
      inputTokens: { total: 1300, noCache: 400, cacheRead: 900, cacheWrite: 0 },
      outputTokens: { total: 40, text: 40, reasoning: 0 },
    },
  },
];

/** The shape `@ai-sdk/anthropic` reports: the uncached input, the two cache lines and a total. */
function finishWith(input: {
  total?: number;
  noCache?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): StreamPart {
  return {
    type: "finish",
    finishReason: { unified: "stop", raw: "end_turn" },
    usage: {
      inputTokens: {
        total: input.total,
        noCache: input.noCache,
        cacheRead: input.cacheRead ?? (input.total === undefined ? undefined : 1000),
        cacheWrite: input.cacheWrite ?? (input.total === undefined ? undefined : 4000),
      },
      outputTokens: { total: 120, text: 120, reasoning: 0 },
    },
  };
}

function streamOf(parts: readonly StreamPart[]): ReadableStream<StreamPart> {
  return new ReadableStream<StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function withoutToolChoice(): CallOptions {
  const params = { ...PARAMS };
  delete params.toolChoice;
  return params;
}

function driver(): WrapOptions["model"] {
  // The middleware reads `modelId` alone, so a whole model is not needed to drive it.
  return { modelId: "claude-opus-5-5" } as unknown as WrapOptions["model"];
}

async function record(
  parts: readonly StreamPart[],
  recorder: ModelRecorder = createRecorder(() => new Date("2026-07-20T00:00:00.000Z")),
): Promise<{ seen: StreamPart[]; calls: ModelCall[] }> {
  const wrapStream = recorder.middleware.wrapStream;
  if (wrapStream === undefined) throw new Error("the recorder records no stream");
  const result = await wrapStream({
    doStream: () => Promise.resolve({ stream: streamOf(parts) }),
    doGenerate: () => {
      throw new Error("the eval never calls generate");
    },
    params: PARAMS,
    model: driver(),
  });
  const seen: StreamPart[] = [];
  for await (const part of result.stream) seen.push(part);
  return { seen, calls: recorder.takeCalls() };
}

describe("the request the recorder keeps", () => {
  it("names every field, so no header can ride along", () => {
    const request = requestOf(PARAMS);

    expect(Object.keys(request).sort()).toEqual([
      "maxOutputTokens",
      "messages",
      "providerOptions",
      "temperature",
      "toolChoice",
      "tools",
    ]);
    expect(JSON.stringify(request)).not.toContain(KEY);
    expect(JSON.stringify(request)).not.toContain("authorization");
  });

  it("keeps the messages, the offered tools and the provider options", () => {
    const request = requestOf(PARAMS);

    expect(request.messages).toEqual(PARAMS.prompt);
    expect(request.tools).toEqual(["read_form"]);
    expect(request.toolChoice).toBe("auto");
    expect(request.maxOutputTokens).toBe(4096);
    expect(request.temperature).toBeNull();
    expect(request.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
  });

  it("names the tool a forced choice asks for", () => {
    const forced = requestOf({ ...PARAMS, toolChoice: { type: "tool", toolName: "read_form" } });

    expect(forced.toolChoice).toBe("tool:read_form");
    expect(requestOf(withoutToolChoice()).toolChoice).toBeNull();
  });
});

describe("the call the recorder keeps", () => {
  it("records the tool calls, the stop reason and the usage, and passes the stream through", async () => {
    const { seen, calls } = await record(PARTS);

    expect(seen).toEqual(PARTS);
    expect(calls).toEqual([
      {
        at: "2026-07-20T00:00:00.000Z",
        modelId: "claude-opus-5-5-20260601",
        request: requestOf(PARAMS),
        toolCalls: [{ name: "read_form", input: '{"formId":"frm_eval_s00_1"}' }],
        finishReason: "tool-calls",
        usage: {
          inputTokens: 400,
          outputTokens: 40,
          cacheReadTokens: 900,
          cacheWriteTokens: 0,
        },
      },
    ]);
  });

  it("clears what it hands over, so a turn reads its own calls alone", async () => {
    const recorder = createRecorder(() => new Date("2026-07-20T00:00:00.000Z"));
    const first = await record(PARTS, recorder);

    expect(first.calls).toHaveLength(1);
    expect(recorder.takeCalls()).toEqual([]);
  });

  it("records a stream that ended without a finish part", async () => {
    const { calls } = await record([METADATA]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.finishReason).toBe("unknown");
  });
});

describe("the four usage lines the provider reports", () => {
  it("keeps the cache write, which the cap charges, apart from the uncached input", async () => {
    const { calls } = await record([METADATA, finishWith({ total: 5400, noCache: 400 })]);

    expect(calls[0]?.usage).toEqual({
      inputTokens: 400,
      outputTokens: 120,
      cacheReadTokens: 1000,
      cacheWriteTokens: 4000,
    });
  });

  it("takes the uncached input out of the total where no line reports it", async () => {
    const { calls } = await record([METADATA, finishWith({ total: 5400 })]);

    expect(calls[0]?.usage).toMatchObject({ inputTokens: 400, cacheWriteTokens: 4000 });
  });

  it("charges nothing for a call the provider reported no usage for", async () => {
    const { calls } = await record([METADATA, finishWith({})]);

    expect(calls[0]?.usage).toEqual({
      inputTokens: 0,
      outputTokens: 120,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});
