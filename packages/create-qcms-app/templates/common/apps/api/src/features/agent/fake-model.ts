/**
 * Test-only: a scripted model plugged into the production `streamText` loop, so the
 * real allowlist, dispatch and event mapping are what CI exercises. The `rogue-*`
 * scripts attempt forbidden verbs, which is the only honest way to test a refusal.
 */

import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import { toolDataOf } from "./tools/registry.js";

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
  "narrate-then-tools",
  "reasoning",
  "read-all",
] as const;

/** Asserted present under `summary` and absent everywhere under `off`. */
export const FAKE_REASONING_SENTINEL = "qcms-reasoning-sentinel-7f3a";

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
      results.set(typed.toolName, toolDataOf(output?.value));
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

/** The id varies so the proposal rationale can quote only the last segment. */
function textParts(text: string, id = "t0"): StreamPart[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
  ];
}

/** The input phase that precedes a parsed call; the timeline row appears on its first part. */
function toolInputParts(toolName: string, input: unknown, nonce = ""): StreamPart[] {
  // The input phase keys on `id`, which the matching `tool-call` spells `toolCallId`.
  const id = `call_${toolName}${nonce}`;
  return [
    { type: "tool-input-start", id, toolName },
    { type: "tool-input-delta", id, delta: JSON.stringify(input) },
    { type: "tool-input-end", id },
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
      ...textParts("Let me propose that straight away.", "t0"),
      toolCallPart("propose_draft", { definition: { formId: 42 } }, "_bad"),
      finishPart("tool-calls"),
    ];
  }
  if (round === 1) {
    return [
      ...textParts("That was malformed. Let me look the questions up first.", "t1"),
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
  return [...textParts("I have proposed the draft.", "t3"), finishPart("stop")];
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
      ...textParts("This needs a question the library does not have yet.", "t0"),
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
      "t2",
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

/**
 * The `narrate-then-tools` script: three prose segments split by two tool steps, each
 * call's input streaming before the parsed call so a row is observably running.
 */
function planNarrateStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
): StreamPart[] {
  if (!results.has("search_question_library")) {
    const query = pickSearchQuery(prompt);
    const input = { limit: 10, ...(query === undefined ? {} : { query }) };
    return [
      ...textParts("Let me look through the question library first.", "t0"),
      ...toolInputParts("search_question_library", input),
      toolCallPart("search_question_library", input),
      finishPart("tool-calls"),
    ];
  }
  if (!results.has("propose_draft")) {
    const draft = currentDraft(prompt) ?? {};
    const input = { definition: buildProposal(draft, libraryHits(results)) };
    return [
      ...textParts("Found what I need. Drafting the form now.", "t1"),
      ...toolInputParts("propose_draft", input),
      toolCallPart("propose_draft", input),
      finishPart("tool-calls"),
    ];
  }
  return [
    ...textParts(
      "I added a driving-history step and gated the follow-up on it, so the second question only appears once the first is answered.",
      "t2",
    ),
    finishPart("stop"),
  ];
}

/** Emits reasoning parts unconditionally, so `off` is proven to drop them, not to skip asking. */
function planReasoningStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
): StreamPart[] {
  const reasoning: StreamPart[] = [
    { type: "reasoning-start", id: "r0" },
    {
      type: "reasoning-delta",
      id: "r0",
      delta: `Checking the library first. **${FAKE_REASONING_SENTINEL}** is my note to self.`,
    },
    { type: "reasoning-end", id: "r0" },
  ];

  if (!results.has("search_question_library")) {
    const query = pickSearchQuery(prompt);
    return [
      ...reasoning,
      ...textParts("Let me look at the library.", "t0"),
      toolCallPart("search_question_library", {
        limit: 10,
        ...(query === undefined ? {} : { query }),
      }),
      finishPart("tool-calls"),
    ];
  }
  if (!results.has("propose_draft")) {
    const draft = currentDraft(prompt) ?? {};
    return [
      ...reasoning,
      toolCallPart("propose_draft", { definition: buildProposal(draft, libraryHits(results)) }),
      finishPart("tool-calls"),
    ];
  }
  return [
    ...reasoning,
    ...textParts("I proposed a driving-history step with a gated follow-up.", "t2"),
    finishPart("stop"),
  ];
}

/** One valid input per tool, so `read-all` can call each of them for real. */
const READ_ALL_INPUTS: Readonly<
  Record<string, (prompt: readonly PromptMessage[], results: Map<string, unknown>) => unknown>
> = {
  search_question_library: () => ({ limit: 10 }),
  propose_questions: (prompt) => ({
    questions: [
      {
        questionId: newQuestionId(prompt),
        type: "shortText",
        label: { en: "Preferred name" },
        required: false,
        constraints: {},
      },
    ],
  }),
  propose_draft: (prompt, results) => ({
    definition: buildProposal(currentDraft(prompt) ?? {}, libraryHits(results)),
  }),
  validate_draft: () => ({}),
  project_draft: () => ({ answers: {} }),
};

/**
 * Calls every tool this screen offers, one per step. It is what drives each read tool's own
 * executor under the sentinel fixture, rather than whichever tool a narrative script needed.
 */
function planReadAllStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
  offered: readonly string[],
): StreamPart[] {
  const next = offered.find((name) => !results.has(name) && name in READ_ALL_INPUTS);
  if (next === undefined) {
    return [...textParts("I have read everything this screen offers.", "t1"), finishPart("stop")];
  }
  const input = (READ_ALL_INPUTS[next] ?? (() => ({})))(prompt, results);
  return [...toolInputParts(next, input), toolCallPart(next, input), finishPart("tool-calls")];
}

/** The tool names this turn offered, which is the screen's own list. */
function offeredTools(tools: unknown): readonly string[] {
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const entry of tools) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name } = entry as { name?: unknown };
    if (typeof name === "string") names.push(name);
  }
  return names;
}

/** Zero except `narrate-then-tools`, whose running row needs a duration to be observable. */
const CHUNK_DELAY_MS: Readonly<Partial<Record<FakeScript, number>>> = {
  "narrate-then-tools": 150,
};

/** Scripts whose next step depends on what has already run, keyed by name. */
const STATEFUL_PLANNERS: Readonly<
  Partial<
    Record<
      FakeScript,
      (prompt: readonly PromptMessage[], results: Map<string, unknown>) => StreamPart[]
    >
  >
> = {
  "tool-error-recovered": planRecoveredStep,
  "propose-questions": planProposeQuestionsStep,
  "narrate-then-tools": planNarrateStep,
  reasoning: planReasoningStep,
};

function planStep(
  prompt: readonly PromptMessage[],
  script: FakeScript,
  offered: readonly string[],
): StreamPart[] {
  const rogueTool = ROGUE_TOOLS[script];
  if (rogueTool !== undefined) {
    // The input phase is scripted too: a `tool-input-start` outside the allowlist must show nothing.
    return [
      ...textParts("Publishing this for you.", "t0"),
      ...toolInputParts(rogueTool, { formId: "frm_any" }),
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
      ...textParts("Let me look at the library again.", `t${String(round)}`),
      toolCallPart("search_question_library", { limit: 1 }, `_${String(round)}`),
      finishPart("tool-calls"),
    ];
  }

  const results = toolResults(prompt);
  if (script === "read-all") return planReadAllStep(prompt, results, offered);
  const planner = STATEFUL_PLANNERS[script];
  if (planner !== undefined) return planner(prompt, results);

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
    doStream: ({ prompt, tools }) => {
      const messages = prompt as unknown as readonly PromptMessage[];
      const script = pickScript(messages);
      const parts = planStep(messages, script, offeredTools(tools));
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: [{ type: "stream-start", warnings: [] }, ...parts],
          initialDelayInMs: 0,
          chunkDelayInMs: CHUNK_DELAY_MS[script] ?? 0,
        }),
      } as unknown as Awaited<ReturnType<MockLanguageModelV3["doStream"]>>);
    },
  });
}
