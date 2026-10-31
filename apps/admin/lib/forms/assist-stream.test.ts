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

/** One `apply-draft` step, in the wire shape the propose tools emit. */
function applyDraftStep(draft: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "apply-draft",
    screen: "/forms/[formId]",
    args: { formId: "frm_a" },
    environment: "test",
    local: true,
    draft,
    card: { titleKey: "agent.card.apply-draft.title", consequenceKeys: [] },
    resultAllowlist: ["changes", "newQuestions"],
  };
}

function proposalWith(step: Record<string, unknown>): Record<string, unknown> {
  return {
    proposalId: "prp_1",
    steps: [step],
    proposedAt: "2026-11-01T09:00:00.000Z",
    expiresAt: "2026-11-01T09:10:00.000Z",
    currentEnvironment: "test",
  };
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

  it("reads a tool step's ordinal and its outcome, and drops a malformed outcome", async () => {
    const body = streamOf([
      frame("status", { phase: "tool", tool: "propose_draft", step: 2 }),
      frame("tool-outcome", { step: 2, outcome: "failed" }),
      frame("tool-outcome", { step: 2, outcome: "maybe" }),
      frame("tool-outcome", { step: "2", outcome: "done" }),
      frame("tool-outcome", { step: 0, outcome: "done" }),
      frame("status", { phase: "tool", tool: "propose_draft", step: -1 }),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "status", phase: "tool", tool: "propose_draft", step: 2 },
      { type: "tool-outcome", step: 2, outcome: "failed" },
      { type: "status", phase: "tool", tool: "propose_draft" },
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

  it("carries both advisory lists through on the step that applies a draft", async () => {
    // Both channels, because they are two different claims about the same draft
    // (issue #123) and a parser that read only the first would silently turn a
    // warned draft into a clean one on the way to the card.
    const draft = {
      definition: { formId: "frm_a", steps: [], rules: [] },
      newQuestions: [],
      issues: [{ code: "DANGLING_STEP_REF", message: "no such step" }],
      warnings: [{ code: "MULTICHOICE_SAME_STEP_TARGET", message: "reveals on the same step" }],
    };
    const events = await collect(
      streamOf([frame("action", { proposal: proposalWith(applyDraftStep(draft)) })]),
    );
    const event = events[0];
    if (event?.type !== "action") throw new Error("expected an action frame");
    expect(event.proposal.steps[0]?.local).toBe(true);
    expect(event.proposal.steps[0]?.draft).toEqual(draft);
  });

  it("reads an applied draft with no warnings key as no warnings, not as absent", async () => {
    // Defensive on the same side `parseIssues` already is: the card maps over this list,
    // so a missing key has to arrive as `[]` rather than `undefined`.
    const events = await collect(
      streamOf([
        frame("action", {
          proposal: proposalWith(
            applyDraftStep({
              definition: { formId: "frm_a", steps: [], rules: [] },
              newQuestions: [],
              issues: [],
            }),
          ),
        }),
      ]),
    );
    const event = events[0];
    if (event?.type !== "action") throw new Error("expected an action frame");
    expect(event.proposal.steps[0]?.draft?.warnings).toEqual([]);
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

  it("carries a text delta's segment id, and omits it when the API sent none", async () => {
    const body = streamOf([
      frame("text", { delta: "Looking", segment: "t0" }),
      frame("text", { delta: "no id" }),
      frame("text", { delta: "bad id", segment: 7 }),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "text", delta: "Looking", segment: "t0" },
      { type: "text", delta: "no id" },
      { type: "text", delta: "bad id" },
    ]);
  });

  it("reads the reasoning variants, and drops one with no delta", async () => {
    const body = streamOf([
      frame("reasoning", { delta: "weighing it up" }),
      frame("reasoning", {}),
      frame("reasoning-end", {}),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "reasoning", delta: "weighing it up" },
      { type: "reasoning-end" },
    ]);
  });

  it("yields nothing for a keep-alive comment and keeps reading around it", async () => {
    const body = streamOf([
      frame("status", { phase: "thinking" }),
      ": keep-alive\n\n",
      ": keep-alive\n\n",
      frame("text", { delta: "here at last" }),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: "status", phase: "thinking" },
      { type: "text", delta: "here at last" },
    ]);
  });
});
