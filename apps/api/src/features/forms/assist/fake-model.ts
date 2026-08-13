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

export const FAKE_SCRIPTS = [
  "default",
  "rogue-publish",
  "rogue-erase",
  "rogue-webhook",
  "rogue-responses",
  "refusal",
  "provider-error",
  "no-proposal",
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

function pickScript(prompt: readonly PromptMessage[]): FakeScript {
  const text = userText(prompt);
  const at = text.lastIndexOf(DIRECTIVE);
  if (at < 0) return "default";
  const rest = text.slice(at + DIRECTIVE.length).trim();
  const name = rest.split(/\s/u)[0] ?? "";
  return (FAKE_SCRIPTS as readonly string[]).includes(name) ? (name as FakeScript) : "default";
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
 * The proposal the `default` script makes: keep the form's identity, put the
 * first published question on its own step, and gate a second step on that
 * question being answered. Two steps plus a forward-only rule is the smallest
 * shape that exercises a real branch end to end (ADR-16).
 */
function buildProposal(
  draft: Record<string, unknown>,
  hits: readonly LibraryHit[],
): Record<string, unknown> {
  const locale = typeof draft.defaultLocale === "string" ? draft.defaultLocale : "en";
  const title = (draft.title as Record<string, string> | undefined) ?? {};
  const [first, second] = hits;

  const steps: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];

  if (first !== undefined) {
    steps.push({
      stepId: "stp_agent_history",
      title: { [locale]: "Driving history" },
      items: [{ questionId: first.questionId, version: first.version }],
    });
  }
  if (second !== undefined) {
    steps.push({
      stepId: "stp_agent_detail",
      title: { [locale]: "Accident detail" },
      items: [{ questionId: second.questionId, version: second.version }],
    });
    rules.push({
      ruleId: "rul_agent_followup",
      when: { op: "answered", questionId: first?.questionId },
      show: ["stp_agent_detail"],
    });
  }

  return {
    formId: draft.formId,
    defaultLocale: locale,
    title: Object.keys(title).length > 0 ? title : { [locale]: "Vehicle insurance quote" },
    steps: steps.length > 0 ? steps : (draft.steps ?? []),
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

function toolCallPart(toolName: string, input: unknown): StreamPart {
  return {
    type: "tool-call",
    toolCallId: `call_${toolName}`,
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
  if (script === "no-proposal") {
    return [...textParts("I need more detail before I can propose anything."), finishPart("stop")];
  }

  const results = toolResults(prompt);
  if (!results.has("search_question_library")) {
    return [toolCallPart("search_question_library", { limit: 10 }), finishPart("tool-calls")];
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
