/**
 * Maps `QCMS_AGENT_THINKING` to each provider's own options; the only vendor-shaped file in the slice.
 * Sets visibility, not effort. Nothing is sent under `off`: dropping reasoning is the event
 * mapping's job.
 */

import type { JSONValue } from "ai";

import type { AgentThinking, AgentProvider } from "../../config.js";

/** The SDK's per-provider options passthrough, spelled without its internal package. */
export type ProviderOptions = Record<string, Record<string, JSONValue>>;

/** The provider options a setting asks for, or `undefined` for none. */
export function thinkingProviderOptions(
  provider: Exclude<AgentProvider, "none">,
  setting: AgentThinking,
): ProviderOptions | undefined {
  if (setting === "off") return undefined;
  switch (provider) {
    case "anthropic":
      return { anthropic: { thinking: { type: "adaptive", display: "summarized" } } };
    case "openai":
      return { openai: { reasoningSummary: "auto" } };
    case "google":
      return { google: { thinkingConfig: { includeThoughts: true } } };
    case "openai-compatible":
    case "fake":
      return undefined;
  }
}
