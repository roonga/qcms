/**
 * Test-only: a scripted model plugged into the production `streamText` loop, so the
 * real allowlist, dispatch and event mapping are what CI exercises. The `rogue-*`
 * scripts attempt forbidden verbs, which is the only honest way to test a refusal.
 */

import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const DIRECTIVE = "#qcms-fake:";

/** The browser suite shares one database, so a spec can pin its own fixtures. */
const SEARCH_DIRECTIVE = "#qcms-fake-search:";

/** A `questionId` is never reused, so a canned id would work for exactly one run. */
const NEW_QUESTION_DIRECTIVE = "#qcms-fake-new:";

export const FAKE_SCRIPTS = [
  "default",
  "rogue-publish",
  "rogue-erase",
  "rogue-webhook",
  "rogue-responses",
  "refusal",
  "provider-error",
  "provider-rejected",
  "tool-then-provider-error",
  "tool-error-recovered",
  "propose-questions",
  "no-proposal",
  "length",
  "step-limit",
] as const;

export type FakeScript = (typeof FAKE_SCRIPTS)[number];

const ROGUE_TOOLS: Readonly<Record<string, string>> = {
  "rogue-publish": "publish_form",
  "rogue-erase": "erase_session",
  "rogue-webhook": "configure_webhook",
  "rogue-responses": "read_responses",
};

type PromptMessage = { role: string; content: unknown };

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

/** One step, so a reveal that fails cannot be mistaken for a step never reached. */
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
    // Tool call ids must be unique across a turn.
    toolCallId: `call_${toolName}${nonce}`,
    toolName,
    input: JSON.stringify(input),
  };
}

function planRecoveredStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
): StreamPart[] {
  const round = prompt.filter((m) => m.role === "tool").length;
  if (round === 0) {
    return [
      ...textParts("Let me propose that straight away."),
      toolCallPart("propose_draft", { definition: { formId: 42 } }, "_bad"),
      finishPart("tool-calls"),
    ];
  }
  if (round === 1) {
    return [
      ...textParts("That was malformed. Let me look the questions up first."),
      toolCallPart("search_question_library", { limit: 10 }),
      finishPart("tool-calls"),
    ];
  }
  if (round === 2) {
    const draft = currentDraft(prompt) ?? {};
    return [
      toolCallPart("propose_draft", { definition: buildProposal(draft, libraryHits(results)) }),
      finishPart("tool-calls"),
    ];
  }
  return [...textParts("I have proposed the draft."), finishPart("stop")];
}

/** Sanitised to the `q_[a-z0-9_]+` grammar so a directive word cannot produce a refused id. */
function newQuestionId(prompt: readonly PromptMessage[]): string {
  const word = (wordAfter(userText(prompt), NEW_QUESTION_DIRECTIVE) ?? "question")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "");
  return `q_fake_new_${word === "" ? "question" : word}`;
}

/**
 * Kept out of the `default` script: a proposal carrying a new question cannot publish
 * until someone publishes that question, and most specs rely on a clean publish.
 */
function planProposeQuestionsStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
): StreamPart[] {
  const questionId = newQuestionId(prompt);

  if (!results.has("propose_questions")) {
    return [
      ...textParts("This needs a question the library does not have yet."),
      toolCallPart("propose_questions", {
        questions: [
          {
            questionId,
            type: "shortText",
            label: { en: "Preferred name" },
            required: false,
            constraints: {},
          },
        ],
      }),
      finishPart("tool-calls"),
    ];
  }

  if (!results.has("propose_draft")) {
    const draft = currentDraft(prompt) ?? {};
    const locale = typeof draft.defaultLocale === "string" ? draft.defaultLocale : "en";
    const title = (draft.title as Record<string, string> | undefined) ?? {};
    return [
      toolCallPart("propose_draft", {
        definition: {
          formId: draft.formId,
          defaultLocale: locale,
          title: Object.keys(title).length > 0 ? title : { [locale]: "Vehicle insurance quote" },
          steps: [
            {
              stepId: "stp_agent_new_question",
              title: { [locale]: "About you" },
              items: [{ questionId, version: 1 }],
            },
          ],
          rules: [],
        },
      }),
      finishPart("tool-calls"),
    ];
  }

  return [
    ...textParts(
      "I proposed one new question and a step that pins it. Accepting will create it as an unpublished draft in the library; publish it there and the pin resolves.",
    ),
    finishPart("stop"),
  ];
}

function planToolThenErrorStep(prompt: readonly PromptMessage[]): StreamPart[] {
  if (prompt.some((m) => m.role === "tool")) {
    return [{ type: "error", error: new Error("upstream provider unavailable") }];
  }
  return [
    ...textParts("Searching first."),
    toolCallPart("search_question_library", { limit: 1 }),
    finishPart("tool-calls"),
  ];
}

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
    // Scripted as a raw mid-stream payload rather than an `APICallError` because that is
    // the path a live permanent refusal takes, and the flag is what is read, not the class.
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
  if (script === "tool-then-provider-error") return planToolThenErrorStep(prompt);
  if (script === "no-proposal") {
    return [...textParts("I need more detail before I can propose anything."), finishPart("stop")];
  }
  if (script === "length") {
    return [...textParts("Here is the start of a form"), finishPart("length")];
  }
  if (script === "step-limit") {
    // Never proposes and always asks for one more call, so the step ceiling is what stops it.
    const round = prompt.filter((m) => m.role === "tool").length;
    return [
      ...textParts("Let me look at the library again."),
      toolCallPart("search_question_library", { limit: 1 }, `_${String(round)}`),
      finishPart("tool-calls"),
    ];
  }

  const results = toolResults(prompt);

  if (script === "tool-error-recovered") {
    return planRecoveredStep(prompt, results);
  }

  if (script === "propose-questions") {
    return planProposeQuestionsStep(prompt, results);
  }

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
