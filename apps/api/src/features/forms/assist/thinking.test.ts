import { describe, expect, it } from "vitest";

import { AGENT_PROVIDERS, type AgentProvider } from "../../../config.js";
import { thinkingProviderOptions } from "./thinking.js";

const REAL_PROVIDERS = AGENT_PROVIDERS.filter(
  (provider): provider is Exclude<AgentProvider, "none"> => provider !== "none",
);

describe("thinkingProviderOptions under summary", () => {
  it("asks Anthropic for adaptive thinking with a summarized display", () => {
    expect(thinkingProviderOptions("anthropic", "summary")).toEqual({
      anthropic: { thinking: { type: "adaptive", display: "summarized" } },
    });
  });

  it("asks OpenAI for an automatic reasoning summary", () => {
    expect(thinkingProviderOptions("openai", "summary")).toEqual({
      openai: { reasoningSummary: "auto" },
    });
  });

  it("asks Google to include its thoughts", () => {
    expect(thinkingProviderOptions("google", "summary")).toEqual({
      google: { thinkingConfig: { includeThoughts: true } },
    });
  });

  it("asks an OpenAI-compatible endpoint for nothing, because there is nothing to ask", () => {
    expect(thinkingProviderOptions("openai-compatible", "summary")).toBeUndefined();
  });

  it("asks the fake provider for nothing: its script carries the reasoning", () => {
    expect(thinkingProviderOptions("fake", "summary")).toBeUndefined();
  });

  it("sets no reasoning effort for any provider", () => {
    // Visibility, not effort: no effort or budget key may appear.
    for (const provider of REAL_PROVIDERS) {
      const options = thinkingProviderOptions(provider, "summary") ?? {};
      const keys = Object.values(options).flatMap((vendor) => Object.keys(vendor));
      expect(keys).not.toContain("reasoningEffort");
      expect(keys).not.toContain("effort");
      expect(JSON.stringify(options)).not.toContain("budgetTokens");
    }
  });
});

describe("thinkingProviderOptions under off", () => {
  it.each(REAL_PROVIDERS)("requests nothing at all for %s", (provider) => {
    expect(thinkingProviderOptions(provider, "off")).toBeUndefined();
  });

  it("covers every provider the configuration can name", () => {
    expect(REAL_PROVIDERS.length).toBeGreaterThan(0);
    expect([...REAL_PROVIDERS, "none"].sort()).toEqual([...AGENT_PROVIDERS].sort());
  });
});
