/**
 * The one setting-to-vendor mapping (task 081, exit criterion 4).
 *
 * A test per provider id, asserting the **exact** object, because a vendor
 * option name is the kind of claim that goes stale: a typo or a renamed field
 * is silently ignored by the provider package, the request goes out without the
 * option, and the only symptom is a disclosure that never appears. Each
 * expectation here was read off the installed package's own types, which
 * `thinking.ts` records version by version.
 */

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
    // Whatever such an endpoint emits is forwarded under `summary` and dropped
    // under `off` by the event mapping, which is where that decision belongs.
    expect(thinkingProviderOptions("openai-compatible", "summary")).toBeUndefined();
  });

  it("asks the fake provider for nothing: its script carries the reasoning", () => {
    expect(thinkingProviderOptions("fake", "summary")).toBeUndefined();
  });

  it("sets no reasoning effort for any provider", () => {
    // The setting is visibility, not effort (081, out of scope). An `effort`,
    // `budgetTokens` or `reasoningEffort` key appearing here would be a
    // behaviour change an operator did not ask for and would be billed for.
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
    // Not "thinking disabled": no thinking option is sent, so the model's own
    // default stands and the request is what it was before 081 existed. What
    // makes `off` a guarantee is `handlePart` dropping the parts.
    expect(thinkingProviderOptions(provider, "off")).toBeUndefined();
  });

  it("covers every provider the configuration can name", () => {
    expect(REAL_PROVIDERS.length).toBeGreaterThan(0);
    expect([...REAL_PROVIDERS, "none"].sort()).toEqual([...AGENT_PROVIDERS].sort());
  });
});
