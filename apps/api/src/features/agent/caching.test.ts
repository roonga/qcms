import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { AGENT_PROVIDERS, type AgentProvider } from "../../config.js";
import { cacheBreakpointOptions } from "./caching.js";

const REAL_PROVIDERS = AGENT_PROVIDERS.filter(
  (provider): provider is Exclude<AgentProvider, "none"> => provider !== "none",
);

describe("cacheBreakpointOptions", () => {
  it("asks Anthropic for an ephemeral breakpoint", () => {
    expect(cacheBreakpointOptions("anthropic")).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("hands the scripted provider what a real one is handed", () => {
    expect(cacheBreakpointOptions("fake")).toEqual(cacheBreakpointOptions("anthropic"));
  });

  it.each(["openai", "google", "openai-compatible"] as const)(
    "asks %s for nothing: it caches without being asked",
    (provider) => {
      expect(cacheBreakpointOptions(provider)).toBeUndefined();
    },
  );

  it("covers every provider the configuration can name", () => {
    expect([...REAL_PROVIDERS, "none"].sort()).toEqual([...AGENT_PROVIDERS].sort());
  });
});

/** The request body of the one call a turn's first step makes, with no network reached. */
async function anthropicRequest(): Promise<Record<string, unknown>> {
  const bodies: Record<string, unknown>[] = [];
  const anthropic = createAnthropic({
    apiKey: "anthropic-key-absent-from-this-test",
    fetch: (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.reject(new Error("captured"));
    },
  });

  const result = streamText({
    model: anthropic("claude-sonnet-4-5"),
    maxRetries: 0,
    instructions: {
      role: "system",
      content: "The instructions, long enough to be worth caching.",
      providerOptions: cacheBreakpointOptions("anthropic") ?? {},
    },
    tools: {
      read_form: tool({
        description: "Read a form",
        inputSchema: z.object({ formId: z.string() }),
      }),
    },
    messages: [{ role: "user", content: "a quote form" }],
  });
  // Drained so the failed call is awaited rather than left unhandled.
  for await (const part of result.fullStream) expect(part.type).toBeDefined();

  const [body] = bodies;
  if (body === undefined) throw new Error("the provider made no call");
  return body;
}

describe("the Anthropic request a breakpoint produces", () => {
  it("carries cache_control on the system block, after the tools", async () => {
    const body = await anthropicRequest();

    const system = body["system"] as { type: string; cache_control?: unknown }[];
    expect(system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    // One breakpoint is enough because the tools are part of the prefix it closes over.
    expect(body["tools"]).toBeDefined();
    expect(JSON.stringify(body["tools"])).not.toContain("cache_control");
    expect(JSON.stringify(body["messages"])).not.toContain("cache_control");
  });
});
