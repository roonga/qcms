/**
 * Maps a provider to the message marker that opens a prompt cache breakpoint; vendor-shaped,
 * as `thinking.ts` is. A provider that caches without being asked gets nothing.
 */

import type { AgentProvider } from "../../config.js";
import type { ProviderOptions } from "./thinking.js";

const EPHEMERAL = { cacheControl: { type: "ephemeral" } };

/**
 * The per-message provider options a cache breakpoint is spelled as, or `undefined` where the
 * provider has no such control.
 */
export function cacheBreakpointOptions(
  provider: Exclude<AgentProvider, "none">,
): ProviderOptions | undefined {
  switch (provider) {
    // The scripted provider is handed what a real one would be, so the loop CI exercises is
    // the loop that carries the marker.
    case "anthropic":
    case "fake":
      return { anthropic: EPHEMERAL };
    case "openai":
    case "google":
    case "openai-compatible":
      return undefined;
  }
}
