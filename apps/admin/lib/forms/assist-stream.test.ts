import { describe, expect, it } from "vitest";

import { readAssistEvents, type AssistEvent } from "./assist-stream.ts";

/** A `ReadableStream<Uint8Array>` that emits each string as its own chunk. */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** One frame, in the wire shape the API's SSE relay emits. */
function frame(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

async function collect(body: ReadableStream<Uint8Array>): Promise<AssistEvent[]> {
  const events: AssistEvent[] = [];
  for await (const event of readAssistEvents(body)) events.push(event);
  return events;
}

describe("readAssistEvents", () => {
  it("reads every frame of a multi-frame body, in order", async () => {
    const body = streamOf([
      frame("status", { phase: "thinking" }),
      frame("text", { delta: "Looking at your draft..." }),
      frame("usage", { inputTokens: 10, outputTokens: 2, steps: 1 }),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "status", phase: "thinking" },
      { type: "text", delta: "Looking at your draft..." },
      { type: "usage", inputTokens: 10, outputTokens: 2, steps: 1 },
    ]);
  });

  it("reassembles a frame the network split across two chunks", async () => {
    const whole = frame("text", { delta: "one piece" });
    const splitAt = Math.floor(whole.length / 2);
    const body = streamOf([whole.slice(0, splitAt), whole.slice(splitAt)]);
    const events = await collect(body);
    expect(events).toEqual([{ type: "text", delta: "one piece" }]);
  });

  it("drops a malformed frame and keeps reading the ones around it", async () => {
    const body = streamOf([
      frame("status", { phase: "thinking" }),
      "event: text\ndata: { not json\n\n",
      frame("text", { delta: "still here" }),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "status", phase: "thinking" },
      { type: "text", delta: "still here" },
    ]);
  });

  it("drops a frame whose JSON does not match any known event shape", async () => {
    const body = streamOf([
      frame("status", { phase: "thinking" }),
      'event: mystery\ndata: {"type":"mystery","payload":1}\n\n',
      frame("status", { phase: "tool", tool: "search_questions" }),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "status", phase: "thinking" },
      { type: "status", phase: "tool", tool: "search_questions" },
    ]);
  });

  it("parses a proposal frame, carrying both advisory lists through", async () => {
    // Both channels, because they are two different claims about the same draft
    // (issue #123) and a parser that read only the first would silently turn a
    // warned draft into a clean one on the way to the panel.
    const proposal = {
      proposedDraft: { steps: [], rules: [] },
      newQuestions: [],
      rationale: "Added a follow-up step.",
      issues: [{ code: "DANGLING_STEP_REF", message: "no such step" }],
      warnings: [{ code: "MULTICHOICE_SAME_STEP_TARGET", message: "reveals on the same step" }],
    };
    const events = await collect(streamOf([frame("proposal", { proposal })]));
    expect(events).toEqual([{ type: "proposal", proposal }]);
  });

  it("reads a proposal frame with no warnings key as no warnings, not as absent", async () => {
    // Defensive on the same side `parseIssues` already is: the panel maps over
    // this list, so a missing key has to arrive as `[]` rather than `undefined`.
    const events = await collect(
      streamOf([
        frame("proposal", {
          proposal: {
            proposedDraft: { steps: [], rules: [] },
            newQuestions: [],
            rationale: "Added a follow-up step.",
            issues: [],
          },
        }),
      ]),
    );
    expect(events[0]).toMatchObject({ type: "proposal", proposal: { warnings: [] } });
  });

  it("parses a terminal error frame, preserving order against what came before it", async () => {
    const body = streamOf([
      frame("status", { phase: "thinking" }),
      frame("error", { code: "PROVIDER_ERROR", message: "The provider is unavailable." }),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "status", phase: "thinking" },
      { type: "error", code: "PROVIDER_ERROR", message: "The provider is unavailable." },
    ]);
  });

  it("reads a final frame that arrives with no trailing blank line", async () => {
    const whole = frame("text", { delta: "last one" });
    // Cut the trailing "\n\n" off entirely, as a stream that ends right after `data:` would.
    const body = streamOf([whole.slice(0, -2)]);
    const events = await collect(body);
    expect(events).toEqual([{ type: "text", delta: "last one" }]);
  });
});
