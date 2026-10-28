/**
 * `QCMS_AGENT_THINKING`, mapped to each provider's own options (task 081,
 * `plan/agent-everywhere.md` section 8).
 *
 * This is the **only** vendor-shaped file in the slice. `assistant.ts` feeds
 * what this returns into the `providerOptions` passthrough `streamText` already
 * accepts, so the loop still knows nothing about any vendor, and adding a
 * provider is a case here rather than a branch in the loop.
 *
 * ## What it sets, and what it deliberately does not
 *
 * **Visibility, not effort.** The SDK's top-level `reasoning` call option sets
 * how hard a model thinks; that stays at the provider default, because an
 * operator asking to *see* the summary has not asked to pay for more of it
 * (section 8, and 081's out-of-scope list).
 *
 * **Nothing at all under `off`.** Not "thinking disabled" - no thinking option
 * is sent, so a model's own default stands and the request is byte-identical to
 * what it was before this file existed. What makes `off` a guarantee is the
 * event mapping, which drops every reasoning part whether or not one was asked
 * for; a provider that volunteers reasoning cannot get it to a screen.
 *
 * ## Read against the installed packages
 *
 * Vendor option names go stale, so each was read off the installed types rather
 * than from the plan:
 *
 * - `anthropic` 4.0.84: `anthropicLanguageModelOptions.thinking` is a union
 *   whose `adaptive` arm takes `display` of `omitted`, `summarized` or
 *   `updates`. `summarized` is what the plan's table names, and `omitted` is
 *   the default that makes thinking blocks arrive with empty text.
 * - `openai` 4.0.98: `reasoningSummary` on the model options.
 * - `google` 4.0.101: `thinkingConfig.includeThoughts`.
 * - `openai-compatible`: no reasoning option exists to send. Whatever the
 *   endpoint emits is forwarded under `summary` and dropped under `off`, which
 *   is the event mapping's doing and not this file's.
 * - `fake`: nothing to request either. Its `reasoning` script emits the parts,
 *   which is what lets one script prove both halves of the setting.
 */

import type { JSONValue } from "ai";

import type { AgentThinking, AgentProvider } from "../../../config.js";

/** The SDK's per-provider options passthrough, spelled without its internal package. */
export type ProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * The provider options one setting asks for, or `undefined` when it asks for
 * nothing. Pure, and the unit of 081's per-provider test.
 */
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
