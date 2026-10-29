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
  "narrate-then-tools",
  "reasoning",
] as const;

/**
 * The sentinel the `reasoning` script puts in its scripted reasoning text.
 *
 * One string, asserted in both directions by one script: present on the wire
 * and in the panel under `QCMS_AGENT_THINKING=summary`, and absent from the
 * wire, the logs, the exported telemetry, the next turn's request body and the
 * replayed conversation under `off` - where the script emits the parts anyway,
 * which is the whole point (081 exit criteria 1, 2 and 5).
 */
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

/**
 * One prose segment.
 *
 * The id varies per call because the loop now carries the provider's text
 * segment ids to the panel (streaming improvement 3): a script that said two
 * things on two steps under one id would be one segment on the wire, and the
 * proposal card's rationale would quote both.
 */
function textParts(text: string, id = "t0"): StreamPart[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
  ];
}

/**
 * The parts that precede a parsed call: the model has begun streaming the
 * call's JSON. `handlePart` announces the timeline row off the first of these,
 * which is the whole of streaming improvement 1.
 */
function toolInputParts(toolName: string, input: unknown, nonce = ""): StreamPart[] {
  // The provider protocol keys the input phase on `id`, which is the call id
  // the matching `tool-call` part spells `toolCallId`
  // (`@ai-sdk/provider` 4.0.31, `LanguageModelV3StreamPart`).
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
 * The `narrate-then-tools` script: the shape streaming improvements 1, 2 and 3
 * exist to produce.
 *
 * Each round says one sentence under its own text segment id, then begins
 * streaming a tool call's JSON through `tool-input-start` before the parsed
 * call arrives. That is what lets a browser see prose and a *running* timeline
 * row before the first tool result exists, which no other script can show: the
 * rest emit a parsed `tool-call` with no input phase at all, so their rows
 * appear and settle in the same instant.
 *
 * Three prose segments separated by two tool steps, so the panel's interleaving
 * and the proposal card quoting only the LAST segment are both observable.
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

/**
 * The `reasoning` script: a model that thinks out loud, whatever it was asked.
 *
 * It emits reasoning parts **unconditionally**, because the property under test
 * is that `off` drops them rather than that `off` declines to ask for them. A
 * script that only emitted them under `summary` would leave the interesting
 * half - a provider volunteering reasoning nobody requested - untested, and
 * that is exactly what `openai-compatible` endpoints and the newer Anthropic
 * models do.
 *
 * The text carries a Markdown construct as well as the sentinel, so the panel's
 * "plain text, never Markdown" rule has something to fail on: under `summary`
 * the asterisks must be visible as characters.
 */
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

/**
 * How slowly a script's chunks arrive.
 *
 * Zero for every script but one: a deterministic test wants its events now.
 * `narrate-then-tools` is the exception because what it demonstrates is a
 * *duration* - a row that is running while the call's input streams - and at
 * zero delay the running state exists for less time than a browser can observe.
 */
const CHUNK_DELAY_MS: Readonly<Partial<Record<FakeScript, number>>> = {
  "narrate-then-tools": 150,
};

/**
 * The scripts whose next step depends on what has already run, each keyed by
 * name so {@link planStep} dispatches rather than growing another branch per
 * script. The ones left in `planStep` answer the same way on every round.
 */
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

/** Plan the parts this step emits, given everything that has happened so far. */
function planStep(prompt: readonly PromptMessage[], script: FakeScript): StreamPart[] {
  const rogueTool = ROGUE_TOOLS[script];
  if (rogueTool !== undefined) {
    // The input phase is scripted too, so the refusal is proven against the
    // whole arrival order a real provider produces: a `tool-input-start` for a
    // name outside the allowlist must put nothing on the timeline, and the
    // refusal must still come off the parsed call (080 exit criterion 2).
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
    doStream: ({ prompt }) => {
      const messages = prompt as unknown as readonly PromptMessage[];
      const script = pickScript(messages);
      const parts = planStep(messages, script);
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
