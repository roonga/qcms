/**
 * The deterministic fake provider (041).
 *
 * This is a scripted `LanguageModelV3`, not a scripted `DraftAssistant`: it is
 * plugged into the *same* `streamText` loop the real providers use, so the tool
 * allowlist, the tool dispatch, the stop-reason handling and the event mapping
 * that CI exercises are the production ones. Only the network call is replaced.
 *
 * That is also what makes it a usable adversary. A hostile model is not a bug in
 * our code to be mocked away; it is the threat 041's allowlist exists for, and
 * the only honest way to test a refusal is to have something actually attempt
 * the forbidden call. The `rogue-*` scripts do exactly that.
 *
 * **Selecting a script.** The last user turn may carry a directive
 * `#qcms-fake:<script>`; without one the `default` script runs. This is test-only
 * machinery and is only reachable when `QCMS_FLAG_AGENT_AUTHORING=fake`, a
 * provider id that exists for the test compositions.
 *
 * The `default` script is deliberately *adaptive rather than canned*: it searches
 * the real question library and builds its proposal from whatever published
 * questions it finds, so an e2e run gets a draft that references the fixtures
 * that run authored, and the proposal actually publishes.
 */

import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

/** The directive that picks a script, and the scripts themselves. */
const DIRECTIVE = "#qcms-fake:";

/**
 * An optional directive that fixes the library search the `default` script runs.
 *
 * The browser suite shares one database with every other spec, so "the first two
 * published questions" is whatever else happened to be seeded. A spec that wants
 * its proposal to pin *its own* fixtures says so: `#qcms-fake-search:<needle>`.
 * Test-only, like the whole module.
 */
const SEARCH_DIRECTIVE = "#qcms-fake-search:";

export const FAKE_SCRIPTS = [
  "default",
  "rogue-publish",
  "rogue-erase",
  "rogue-webhook",
  "rogue-responses",
  "refusal",
  "provider-error",
  "provider-rejected",
  "no-proposal",
  "length",
  "step-limit",
] as const;

export type FakeScript = (typeof FAKE_SCRIPTS)[number];

/** The tool each rogue script reaches for: exactly the verbs 041 forbids. */
const ROGUE_TOOLS: Readonly<Record<string, string>> = {
  "rogue-publish": "publish_form",
  "rogue-erase": "erase_session",
  "rogue-webhook": "configure_webhook",
  "rogue-responses": "read_responses",
};

type PromptMessage = { role: string; content: unknown };

/** Flatten every text part of a message's content into one string. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const typed = part as { type?: unknown; text?: unknown };
      return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
    })
    .join("\n");
}

function userText(prompt: readonly PromptMessage[]): string {
  return prompt
    .filter((m) => m.role === "user")
    .map((m) => messageText(m.content))
    .join("\n");
}

/** The first whitespace-delimited word after `directive`, or undefined. */
function wordAfter(text: string, directive: string): string | undefined {
  const at = text.lastIndexOf(directive);
  if (at < 0) return undefined;
  const word =
    text
      .slice(at + directive.length)
      .trim()
      .split(/\s/u)[0] ?? "";
  return word === "" ? undefined : word;
}

function pickScript(prompt: readonly PromptMessage[]): FakeScript {
  const name = wordAfter(userText(prompt), DIRECTIVE);
  if (name === undefined) return "default";
  return (FAKE_SCRIPTS as readonly string[]).includes(name) ? (name as FakeScript) : "default";
}

function pickSearchQuery(prompt: readonly PromptMessage[]): string | undefined {
  return wordAfter(userText(prompt), SEARCH_DIRECTIVE);
}

/** Every tool result in the prompt so far, keyed by tool name. */
function toolResults(prompt: readonly PromptMessage[]): Map<string, unknown> {
  const results = new Map<string, unknown>();
  for (const message of prompt) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (typeof part !== "object" || part === null) continue;
      const typed = part as { type?: unknown; toolName?: unknown; output?: unknown };
      if (typed.type !== "tool-result" || typeof typed.toolName !== "string") continue;
      const output = typed.output as { type?: unknown; value?: unknown } | undefined;
      results.set(typed.toolName, output?.type === "json" ? output.value : output?.value);
    }
  }
  return results;
}

/** The current draft, lifted back out of the preamble the assistant sent. */
function currentDraft(prompt: readonly PromptMessage[]): Record<string, unknown> | undefined {
  const text = userText(prompt);
  const open = text.indexOf("```json");
  if (open < 0) return undefined;
  const start = open + "```json".length;
  const close = text.indexOf("```", start);
  if (close < 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, close));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

interface LibraryHit {
  questionId: string;
  version: number;
}

function libraryHits(results: Map<string, unknown>): LibraryHit[] {
  const found = results.get("search_question_library");
  const questions = (found as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(questions)) return [];
  const hits: LibraryHit[] = [];
  for (const entry of questions) {
    if (typeof entry !== "object" || entry === null) continue;
    const typed = entry as { questionId?: unknown; version?: unknown };
    if (typeof typed.questionId === "string" && typeof typed.version === "number") {
      hits.push({ questionId: typed.questionId, version: typed.version });
    }
  }
  return hits;
}

/**
 * The proposal the `default` script makes, and why it has the shape it has.
 *
 * One step carrying both questions, with a forward-only rule that reveals the
 * second when the first is answered (ADR-16). That is the work order's own example,
 * and it is the arrangement worth exercising end to end: within a single step the
 * reveal is visible without any navigation, so a branch that fails to appear
 * cannot be mistaken for a step that was never reached.
 */
function buildProposal(
  draft: Record<string, unknown>,
  hits: readonly LibraryHit[],
): Record<string, unknown> {
  const locale = typeof draft.defaultLocale === "string" ? draft.defaultLocale : "en";
  const title = (draft.title as Record<string, string> | undefined) ?? {};
  const [first, second] = hits;

  const items: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];

  if (first !== undefined) {
    items.push({ questionId: first.questionId, version: first.version });
  }
  if (first !== undefined && second !== undefined) {
    items.push({ questionId: second.questionId, version: second.version });
    rules.push({
      ruleId: "rul_agent_followup",
      when: { op: "answered", questionId: first.questionId },
      show: [second.questionId],
    });
  }

  const steps =
    items.length > 0
      ? [{ stepId: "stp_agent_history", title: { [locale]: "Driving history" }, items }]
      : (draft.steps ?? []);

  return {
    formId: draft.formId,
    defaultLocale: locale,
    title: Object.keys(title).length > 0 ? title : { [locale]: "Vehicle insurance quote" },
    steps,
    rules,
  };
}

// --- stream construction ----------------------------------------------------

type StreamPart = Record<string, unknown>;

function textParts(text: string): StreamPart[] {
  return [
    { type: "text-start", id: "t0" },
    { type: "text-delta", id: "t0", delta: text },
    { type: "text-end", id: "t0" },
  ];
}

function finishPart(finishReason: string): StreamPart {
  return {
    type: "finish",
    // The provider spec carries a unified reason plus the vendor's raw one.
    finishReason: { unified: finishReason, raw: finishReason },
    usage: {
      inputTokens: { total: 100 },
      outputTokens: { total: 50 },
      totalTokens: { total: 150 },
    },
  };
}

function toolCallPart(toolName: string, input: unknown, nonce = ""): StreamPart {
  return {
    type: "tool-call",
    // Tool call ids must be unique across a turn, so a script that calls the
    // same tool on every step has to vary it.
    toolCallId: `call_${toolName}${nonce}`,
    toolName,
    input: JSON.stringify(input),
  };
}

/** Plan the parts this step emits, given everything that has happened so far. */
function planStep(prompt: readonly PromptMessage[], script: FakeScript): StreamPart[] {
  const rogueTool = ROGUE_TOOLS[script];
  if (rogueTool !== undefined) {
    return [
      ...textParts("Publishing this for you."),
      toolCallPart(rogueTool, { formId: "frm_any" }),
      finishPart("tool-calls"),
    ];
  }
  if (script === "refusal") {
    return [...textParts("I cannot help with that."), finishPart("content-filter")];
  }
  if (script === "provider-error") {
    return [{ type: "error", error: new Error("upstream provider unavailable") }];
  }
  if (script === "provider-rejected") {
    // The shape a provider emits mid-stream for a permanent refusal, as
    // observed live on a real account with no balance (issue #818): a 429 that
    // the SDK has already marked non-retryable. Scripted as the payload rather
    // than as an `APICallError` because that is the path the live failure took,
    // and because the flag is what `providerRetryAdvice` reads - not the class,
    // and never the vendor text carried alongside it.
    return [
      {
        type: "error",
        error: {
          message: "upstream provider refused the request",
          statusCode: 429,
          isRetryable: false,
          data: undefined,
        },
      },
    ];
  }
  if (script === "no-proposal") {
    return [...textParts("I need more detail before I can propose anything."), finishPart("stop")];
  }
  if (script === "length") {
    return [...textParts("Here is the start of a form"), finishPart("length")];
  }
  if (script === "step-limit") {
    // Never proposes and always asks for one more tool call, so the loop runs
    // until `stopWhen: stepCountIs(maxSteps)` cuts it off. That is what makes
    // STEP_LIMIT reachable in a test rather than only in theory.
    const round = prompt.filter((m) => m.role === "tool").length;
    return [
      ...textParts("Let me look at the library again."),
      toolCallPart("search_question_library", { limit: 1 }, `_${String(round)}`),
      finishPart("tool-calls"),
    ];
  }

  const results = toolResults(prompt);
  if (!results.has("search_question_library")) {
    const query = pickSearchQuery(prompt);
    return [
      toolCallPart("search_question_library", {
        limit: 10,
        ...(query === undefined ? {} : { query }),
      }),
      finishPart("tool-calls"),
    ];
  }
  if (!results.has("propose_draft")) {
    const draft = currentDraft(prompt) ?? {};
    const definition = buildProposal(draft, libraryHits(results));
    return [toolCallPart("propose_draft", { definition }), finishPart("tool-calls")];
  }
  return [
    ...textParts(
      "I added a driving-history step and gated an accident-detail step on it, so the follow-up only appears when the first question is answered.",
    ),
    finishPart("stop"),
  ];
}

/**
 * The scripted model. Deterministic in the only sense that matters: the same
 * conversation and the same library produce the same proposal, every run.
 */
export function fakeAssistantModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: "qcms-fake",
    modelId: "qcms-fake-assistant",
    doStream: ({ prompt }) => {
      const messages = prompt as unknown as readonly PromptMessage[];
      const parts = planStep(messages, pickScript(messages));
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: [{ type: "stream-start", warnings: [] }, ...parts],
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
      } as unknown as Awaited<ReturnType<MockLanguageModelV3["doStream"]>>);
    },
  });
}
