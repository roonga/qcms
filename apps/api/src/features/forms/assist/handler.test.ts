/**
 * The SSE relay's keep-alive (streaming improvement 4, 080 exit criterion 4).
 *
 * The relay is driven directly with a short interval rather than the shipped
 * one, because the property under test is "a silent stretch produces a comment
 * and nothing else" and that holds at any interval. The interval's *value* is
 * asserted separately, so the two claims fail apart: a test that waited out 15
 * real seconds would prove the same thing and cost the suite a quarter of a
 * minute per case.
 */

import { describe, expect, it } from "vitest";

import { ASSIST_HEARTBEAT_MS, assistSseStream } from "./handler.js";
import type { AssistEvent } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function body(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function relay(events: AsyncIterable<AssistEvent>, heartbeatMs: number) {
  return assistSseStream({
    events,
    heartbeatMs,
    onError: () => undefined,
    onCancel: () => undefined,
  });
}

describe("the assist SSE relay's keep-alive", () => {
  it("emits a comment frame through a silent stretch and an event frame after it", async () => {
    async function* slow(): AsyncGenerator<AssistEvent> {
      await sleep(90);
      yield { type: "status", phase: "thinking" };
    }

    const text = await body(relay(slow(), 20));

    expect(text).toContain(": keep-alive\n\n");
    expect(text).toContain('event: status\ndata: {"type":"status","phase":"thinking"}');
    // Several, because the timer re-arms: one comment would mean the keep-alive
    // fires once and then leaves a long turn unprotected.
    expect(text.split(": keep-alive").length - 1).toBeGreaterThan(1);
  });

  it("carries nothing a client could read as an event", async () => {
    // A turn that says nothing at all and then ends: the whole body is whatever
    // the keep-alive wrote.
    const silent: AsyncIterable<AssistEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await sleep(60);
          return { done: true, value: undefined };
        },
      }),
    };

    const text = await body(relay(silent, 20));
    // The whole body is comments: no `data:` line exists, which is what makes
    // the admin parser yield nothing for it (`assist-stream.test.ts`).
    expect(text).not.toContain("data:");
    expect(text.replaceAll(": keep-alive\n\n", "")).toBe("");
  });

  it("stops the timer when the turn ends, so nothing is written after close", async () => {
    async function* quick(): AsyncGenerator<AssistEvent> {
      await Promise.resolve();
      yield { type: "usage", inputTokens: 1, outputTokens: 2, steps: 1 };
    }

    const text = await body(relay(quick(), 20));
    expect(text).not.toContain(": keep-alive");
    // An enqueue after `close()` throws, so surviving a wait longer than the
    // interval is the assertion: the timer was cleared rather than left armed.
    await sleep(60);
  });

  it("waits 15 seconds in production", () => {
    expect(ASSIST_HEARTBEAT_MS).toBe(15_000);
  });
});

/**
 * Stop, at the handler (080 exit criterion 5).
 *
 * The composer's Stop aborts the browser's `fetch`, which cancels this response
 * body. What has to happen then is the *upstream* call ending too, and the only
 * thing that can end it is the abort the route hands the assistant. The relay's
 * `cancel` is the single place that is wired, so this asserts the wiring rather
 * than the button.
 */
describe("a cancelled body ends the turn", () => {
  it("runs the cancel hook the route aborts the upstream call from", async () => {
    let cancelled = false;
    async function* forever(): AsyncGenerator<AssistEvent> {
      yield { type: "status", phase: "thinking" };
      await sleep(5_000);
    }

    const stream = assistSseStream({
      events: forever(),
      heartbeatMs: ASSIST_HEARTBEAT_MS,
      onError: () => undefined,
      onCancel: () => {
        cancelled = true;
      },
    });

    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
  });
});
