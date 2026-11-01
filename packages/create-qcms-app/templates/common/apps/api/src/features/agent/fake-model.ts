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

/**
 * A `questionId` and a form slug are never reused, so a canned one would work for exactly
 * one run. The directive names the word both are built from.
 */
const NEW_QUESTION_DIRECTIVE = "#qcms-fake-new:";

/**
 * The account a workspace script grants, revokes or re-roles. A spec creates the account
 * itself, so the address cannot be canned.
 */
const MEMBER_DIRECTIVE = "#qcms-fake-who:";

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
  // D0's action scripts (083, SEC-17). Each proposes and runs nothing: Confirm is the
  // user's, on the card.
  "plan-three",
  "plan-fails-at-2",
  "plan-two-envs",
  "plan-pending-at-1",
  "two-proposals",
  "plan-26-steps",
  "unknown-tool",
  "injection-follow",
  "read-only-user",
  // One multi-step plan per screen group, so every kind is also confirmed inside a plan.
  "plan-apply-draft",
  "plan-apply-draft-release",
  "plan-intake",
  "plan-releases",
  "plan-links",
  "plan-forms-create",
  "plan-questions-create",
  "plan-question-lifecycle",
  "plan-responses",
  "plan-export-last",
  "plan-webhooks",
  "plan-workspace",
  "plan-workspace-settings",
  // One card per kind, for each screen group's own confirm and cancel paths.
  "propose-form-create",
  "propose-link-mint",
  "propose-link-revoke",
  "propose-question-create",
  "propose-question-save-draft",
  "propose-question-publish",
  "propose-question-deprecate",
  "propose-question-new-version",
  "propose-form-publish",
  "propose-form-settings",
  "propose-form-close",
  "propose-form-reopen",
  "propose-form-release",
  "propose-response-erase",
  "propose-response-unflag",
  "propose-response-export",
  "propose-webhook-create",
  "propose-webhook-rotate",
  "propose-webhook-retarget",
  "propose-webhook-reactivate",
  "propose-webhook-deactivate",
  "propose-webhook-redeliver",
  "propose-access-group-create",
  "propose-access-group-remove",
  "propose-access-grant",
  "propose-access-revoke",
  "propose-member-role",
  "propose-workspace-settings",
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

/**
 * The tools this turn has already called, which is what `read-all` walks by: a refused
 * tool returns no result, so walking results alone would call it forever.
 */
function toolCalls(prompt: readonly PromptMessage[]): Set<string> {
  const called = new Set<string>();
  for (const message of prompt) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (typeof part !== "object" || part === null) continue;
      const typed = part as { type?: unknown; toolName?: unknown };
      if (typed.type === "tool-call" && typeof typed.toolName === "string") {
        called.add(typed.toolName);
      }
    }
  }
  return called;
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

/**
 * The card a proposed draft reaches the user as. A script that proposes a draft follows it
 * with this call, because a recorded draft is not itself a proposal: the user confirms it
 * on the apply-draft card like any other action.
 */
function applyDraftCall(prompt: readonly PromptMessage[]): StreamPart[] {
  const formId = currentDraft(prompt)?.formId ?? factFormId(prompt);
  const input = { action: { kind: "apply-draft", args: { formId } } };
  return [
    ...toolInputParts("propose_action", input),
    toolCallPart("propose_action", input),
    finishPart("tool-calls"),
  ];
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
  if (!results.has("propose_action")) return applyDraftCall(prompt);
  return [...textParts("I have proposed the draft.", "t3"), finishPart("stop")];
}

/** Sanitised to the `q_[a-z0-9_]+` grammar so a directive word cannot produce a refused id. */
function newQuestionId(prompt: readonly PromptMessage[]): string {
  return `q_fake_new_${directiveWord(prompt)}`;
}

function directiveWord(prompt: readonly PromptMessage[]): string {
  const word = (wordAfter(userText(prompt), NEW_QUESTION_DIRECTIVE) ?? "question")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "");
  return word === "" ? "question" : word;
}

/** A slug the create scripts propose, in the grammar a form id is derived from. */
function newSlug(prompt: readonly PromptMessage[]): string {
  return `fake-new-${directiveWord(prompt).replaceAll("_", "-")}`;
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

  if (!results.has("propose_action")) return applyDraftCall(prompt);

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
  if (!results.has("propose_action")) return applyDraftCall(prompt);
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
  if (!results.has("propose_action")) return [...reasoning, ...applyDraftCall(prompt)];
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
  // D1 to D7's read tools. Each input is one the screen's own facts justify, so the walk
  // runs every executor against the fixture rather than against a canned id.
  test_rule: (prompt) => ({ ruleId: firstRuleId(prompt), answers: {} }),
  diff_form_versions: (prompt) => ({ from: factPublishedVersion(prompt), to: null }),
  count_links: () => ({}),
  list_responses: () => ({ limit: 5 }),
  count_responses: () => ({}),
  delivery_status: () => ({}),
  count_dead_letters: () => ({}),
  diff_question_versions: () => ({ from: 1, to: 1 }),
  search_forms: () => ({ limit: 5 }),
};

/** A rule the draft actually declares, or a probe id so the bench answers `ruleNotFound`. */
function firstRuleId(prompt: readonly PromptMessage[]): string {
  for (const block of jsonBlocks(prompt)) {
    const rules = (block as { rules?: unknown }).rules;
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) {
      const id = (rule as { ruleId?: unknown } | null)?.ruleId;
      if (typeof id === "string" && id !== "") return id;
    }
  }
  return "rul_probe";
}

function factPublishedVersion(prompt: readonly PromptMessage[]): number | null {
  const version = screenFacts(prompt).latestPublishedVersion;
  return typeof version === "number" ? version : null;
}

/**
 * Calls every tool this screen offers, one per step. It is what drives each read tool's own
 * executor under the sentinel fixture, rather than whichever tool a narrative script needed.
 */
function planReadAllStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
  offered: readonly string[],
): StreamPart[] {
  const called = toolCalls(prompt);
  const next = offered.find((name) => !called.has(name) && name in READ_ALL_INPUTS);
  if (next === undefined) {
    return [...textParts("I have read everything this screen offers.", "t1"), finishPart("stop")];
  }
  const input = (READ_ALL_INPUTS[next] ?? (() => ({})))(prompt, results);
  return [...toolInputParts(next, input), toolCallPart(next, input), finishPart("tool-calls")];
}

/**
 * D0's action scripts. Each one proposes; none executes. The arguments come from the
 * screen's own facts block, so a script names the form and the link the fixture actually
 * has rather than a canned id.
 */

/** Every fenced JSON block in the user messages: the draft preamble and the facts. */
function jsonBlocks(prompt: readonly PromptMessage[]): Record<string, unknown>[] {
  const text = userText(prompt);
  const blocks: Record<string, unknown>[] = [];
  let at = text.indexOf("```json");
  while (at >= 0) {
    const start = at + "```json".length;
    const close = text.indexOf("```", start);
    if (close < 0) break;
    try {
      const parsed: unknown = JSON.parse(text.slice(start, close));
      if (typeof parsed === "object" && parsed !== null) {
        blocks.push(parsed as Record<string, unknown>);
      }
    } catch {
      // A block this build cannot read is skipped: the next one may be the facts.
    }
    at = text.indexOf("```json", close);
  }
  return blocks;
}

function screenFacts(prompt: readonly PromptMessage[]): Record<string, unknown> {
  return jsonBlocks(prompt).find((block) => typeof block.formId === "string") ?? {};
}

function factFormId(prompt: readonly PromptMessage[]): string {
  const { formId } = screenFacts(prompt);
  return typeof formId === "string" ? formId : "frm_unknown";
}

function factVersion(prompt: readonly PromptMessage[]): number {
  const { latestPublishedVersion } = screenFacts(prompt);
  return typeof latestPublishedVersion === "number" ? latestPublishedVersion : 1;
}

/** The first link the links screen listed, so a revoke step names a real row. */
function factLinkId(prompt: readonly PromptMessage[]): string {
  const { links } = screenFacts(prompt);
  if (!Array.isArray(links)) return "lnk_absent";
  for (const entry of links) {
    if (typeof entry !== "object" || entry === null) continue;
    const { linkId } = entry as { linkId?: unknown };
    if (typeof linkId === "string") return linkId;
  }
  return "lnk_absent";
}

/**
 * The first link the screen listed that a revoke would still change. The first link of
 * any state is what a plan meant to fail names; a revoke meant to succeed needs this one.
 */
function factActiveLinkId(prompt: readonly PromptMessage[]): string {
  const { links } = screenFacts(prompt);
  if (!Array.isArray(links)) return "lnk_absent";
  for (const entry of links) {
    if (typeof entry !== "object" || entry === null) continue;
    const { linkId, state } = entry as { linkId?: unknown; state?: unknown };
    if (typeof linkId === "string" && state === "active") return linkId;
  }
  return "lnk_absent";
}

/** The session the response screen's own facts named, so an erase step names a real row. */
function factSessionId(prompt: readonly PromptMessage[]): string {
  const facts = screenFacts(prompt);
  const { sessionId } = facts;
  if (typeof sessionId === "string") return sessionId;
  const response = facts["response"];
  if (typeof response === "object" && response !== null) {
    const nested = (response as { sessionId?: unknown }).sessionId;
    if (typeof nested === "string") return nested;
  }
  return "ses_absent";
}

const FAKE_LINK_EXPIRY = "2026-12-31T23:59:59.000Z";

const FAKE_ENDPOINT_URL = "https://hooks.example.test/qcms?channel=ops";

/** A second target, so a retarget changes the URL the screen shows. */
const FAKE_ENDPOINT_URL_ALT = "https://hooks.example.test/qcms?channel=audit";

/** A group name is unique in its workspace, so the label a script proposes is the run's. */
function fakeGroupLabel(prompt: readonly PromptMessage[]): string {
  return directiveWord(prompt);
}

function fakeGroupName(prompt: readonly PromptMessage[]): string {
  return `test.responses.viewer.${fakeGroupLabel(prompt)}`;
}

/** The administration screen's own facts, which name a workspace rather than a form. */
function workspaceFacts(prompt: readonly PromptMessage[]): Record<string, unknown> {
  return jsonBlocks(prompt).find((block) => typeof block["workspaceId"] === "string") ?? {};
}

function factWorkspaceId(prompt: readonly PromptMessage[]): string {
  const workspaceId = workspaceFacts(prompt)["workspaceId"];
  return typeof workspaceId === "string" ? workspaceId : "wsp_absent";
}

/**
 * The group this run made, by the label its own scripts propose, so a remove or a grant
 * names it rather than whichever group the workspace happened to list first.
 */
function factGroupId(prompt: readonly PromptMessage[]): string {
  const rows = workspaceFacts(prompt)["accessGroups"];
  const suffix = `.${fakeGroupLabel(prompt)}`;
  if (Array.isArray(rows)) {
    for (const entry of rows) {
      if (typeof entry !== "object" || entry === null) continue;
      const row = entry as { groupId?: unknown; name?: unknown };
      if (
        typeof row.name === "string" &&
        row.name.endsWith(suffix) &&
        typeof row.groupId === "string"
      ) {
        return row.groupId;
      }
    }
  }
  return firstId(rows, "groupId", "grp_absent");
}

/**
 * The person a grant, a revoke or a role change names: the account `#qcms-fake-who:` names
 * if the screen lists it, and otherwise the first member. An email the screen has never
 * seen would be a grant to nobody, which is the route's own refusal rather than a fixture.
 */
function factMember(prompt: readonly PromptMessage[]): { userId: string; email: string } {
  const rows = workspaceFacts(prompt)["members"];
  const wanted = wordAfter(userText(prompt), MEMBER_DIRECTIVE);
  const members: { userId: string; email: string }[] = [];
  if (Array.isArray(rows)) {
    for (const entry of rows) {
      if (typeof entry !== "object" || entry === null) continue;
      const row = entry as { userId?: unknown; email?: unknown };
      if (typeof row.userId === "string" && typeof row.email === "string") {
        members.push({ userId: row.userId, email: row.email });
      }
    }
  }
  const named = wanted === undefined ? undefined : members.find((row) => row.email === wanted);
  return named ?? members[0] ?? { userId: "usr_absent", email: wanted ?? "absent@qcms.invalid" };
}

/** The question detail screen's own facts, which name no form. */
function questionFacts(prompt: readonly PromptMessage[]): Record<string, unknown> {
  return jsonBlocks(prompt).find((block) => typeof block["questionId"] === "string") ?? {};
}

function factQuestionId(prompt: readonly PromptMessage[]): string {
  const questionId = questionFacts(prompt)["questionId"];
  return typeof questionId === "string" ? questionId : "q_absent";
}

/** The first version of the named status the detail screen listed, or 1. */
function factQuestionVersion(prompt: readonly PromptMessage[], status: string): number {
  const rows = questionFacts(prompt)["versions"];
  if (!Array.isArray(rows)) return 1;
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as { version?: unknown; status?: unknown };
    if (row.status === status && typeof row.version === "number") return row.version;
  }
  return 1;
}

/** A question definition a create or a save proposes, in the kernel's own shape. */
function fakeQuestionDefinition(questionId: string): Record<string, unknown> {
  return { questionId, type: "shortText", label: { en: "What the assistant proposed" } };
}

/** The first endpoint and the first delivery the webhooks screen listed. */
function factWebhookId(prompt: readonly PromptMessage[]): string {
  return firstId(screenFacts(prompt)["endpoints"], "webhookId", "wh_absent");
}

function factDeliveryId(prompt: readonly PromptMessage[]): string {
  return firstId(screenFacts(prompt)["deliveries"], "deliveryId", "dlv_absent");
}

function firstId(rows: unknown, member: string, fallback: string): string {
  if (!Array.isArray(rows)) return fallback;
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = (entry as Record<string, unknown>)[member];
    if (typeof value === "string") return value;
  }
  return fallback;
}

function mintStep(formId: string, count = 2): Record<string, unknown> {
  return {
    kind: "link.mint",
    args: { formId, count, expiresAt: FAKE_LINK_EXPIRY, oneTime: true },
  };
}

function revokeStep(formId: string, linkId: string): Record<string, unknown> {
  return { kind: "link.revoke", args: { formId, linkId } };
}

/**
 * A create step whose new id is this run's own. `suffix` tells two steps of one plan
 * apart, because a slug and a question id are never reused (R6).
 */
function createFormStep(prompt: readonly PromptMessage[], suffix = ""): Record<string, unknown> {
  const slug = suffix === "" ? newSlug(prompt) : `${newSlug(prompt)}-${suffix}`;
  return { kind: "form.create", args: { slug, defaultLocale: "en" } };
}

function createQuestionStep(
  prompt: readonly PromptMessage[],
  suffix = "",
): Record<string, unknown> {
  const questionId = suffix === "" ? newQuestionId(prompt) : `${newQuestionId(prompt)}_${suffix}`;
  const slug = suffix === "" ? newSlug(prompt) : `${newSlug(prompt)}-${suffix}`;
  return {
    kind: "question.create",
    args: { slug, definition: fakeQuestionDefinition(questionId) },
  };
}

function releaseStep(
  formId: string,
  version: number | Record<string, unknown>,
  environment: string,
  fromEnvironment?: string,
): Record<string, unknown> {
  return {
    kind: "form.release",
    args: {
      formId,
      version,
      environment,
      ...(fromEnvironment === undefined ? {} : { fromEnvironment }),
    },
  };
}

function groupCreateStep(prompt: readonly PromptMessage[]): Record<string, unknown> {
  return {
    kind: "access.groupCreate",
    args: {
      workspaceId: factWorkspaceId(prompt),
      name: fakeGroupName(prompt),
      role: "responses.viewer",
      label: fakeGroupLabel(prompt),
      environments: ["test"],
      forms: ["all"],
    },
  };
}

/** The role the named member does not hold, so confirming it changes the row on screen. */
function memberRoleStep(prompt: readonly PromptMessage[]): Record<string, unknown> {
  const member = factMember(prompt);
  const rows = workspaceFacts(prompt)["members"];
  let current = "";
  if (Array.isArray(rows)) {
    for (const entry of rows) {
      if (typeof entry !== "object" || entry === null) continue;
      const row = entry as { userId?: unknown; role?: unknown };
      if (row.userId === member.userId && typeof row.role === "string") current = row.role;
    }
  }
  return {
    kind: "member.role",
    args: {
      workspaceId: factWorkspaceId(prompt),
      userId: member.userId,
      role: current === "forms.owner" ? "member" : "forms.owner",
    },
  };
}

/** The switch as it is not, so confirming it twice flips it and puts it back. */
function workspaceSettingsStep(prompt: readonly PromptMessage[]): Record<string, unknown> {
  const current = workspaceFacts(prompt)["requireSecondApprover"];
  return {
    kind: "workspace.settings",
    args: { workspaceId: factWorkspaceId(prompt), requireSecondApprover: current !== true },
  };
}

/** How many times this turn has already called one tool, which P1's script needs. */
function toolCallCount(prompt: readonly PromptMessage[], name: string): number {
  let count = 0;
  for (const message of prompt) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (typeof part !== "object" || part === null) continue;
      const typed = part as { type?: unknown; toolName?: unknown };
      if (typed.type === "tool-call" && typed.toolName === name) count += 1;
    }
  }
  return count;
}

/** A name outside the registry, which the one door refuses before anything is dispatched. */
const UNREGISTERED_TOOL = "run_action";

function actionPlanSteps(
  script: FakeScript,
  prompt: readonly PromptMessage[],
): Record<string, unknown>[] {
  const formId = factFormId(prompt);
  switch (script) {
    case "plan-three":
      return [
        { kind: "form.publish", args: { formId, environment: "test" } },
        releaseStep(formId, { fromStep: 0, field: "version" }, "prod"),
        { kind: "form.settings", args: { formId, challengeRequired: true, minSubmitMs: 1500 } },
      ];
    case "plan-fails-at-2":
      return [mintStep(formId, 1), revokeStep(formId, factLinkId(prompt)), mintStep(formId, 3)];
    case "plan-intake":
      return [
        { kind: "form.close", args: { formId } },
        { kind: "form.reopen", args: { formId } },
      ];
    case "plan-releases":
      return [
        { kind: "form.publish", args: { formId, environment: "test" } },
        releaseStep(formId, { fromStep: 0, field: "version" }, "prod"),
      ];
    case "plan-links":
      return [mintStep(formId, 2), revokeStep(formId, factActiveLinkId(prompt))];
    case "plan-forms-create":
      return [createFormStep(prompt, "a"), createFormStep(prompt, "b")];
    case "plan-questions-create":
      return [createQuestionStep(prompt, "a"), createQuestionStep(prompt, "b")];
    // The library's four lifecycle verbs over one draft version, in the order the screen
    // allows them: save it, publish it, open the next draft, retire the one just published.
    case "plan-question-lifecycle": {
      const questionId = factQuestionId(prompt);
      const version = factQuestionVersion(prompt, "draft");
      return [
        {
          kind: "question.saveDraft",
          args: { questionId, version, definition: fakeQuestionDefinition(questionId) },
        },
        { kind: "question.publish", args: { questionId, version } },
        { kind: "question.newVersion", args: { questionId } },
        { kind: "question.deprecate", args: { questionId, version } },
      ];
    }
    // One group's whole life, each step naming the group the first step records.
    case "plan-workspace": {
      const workspaceId = factWorkspaceId(prompt);
      const teamId = { fromStep: 0, field: "teamId" };
      const member = factMember(prompt);
      return [
        groupCreateStep(prompt),
        { kind: "access.grant", args: { workspaceId, teamId, email: member.email } },
        { kind: "access.revoke", args: { workspaceId, teamId, userId: member.userId } },
        { kind: "access.groupRemove", args: { workspaceId, teamId } },
      ];
    }
    // One endpoint's whole configuration, every later step naming what step 1 created, and
    // the delivery verb last: it names a row the screen listed rather than step 1's
    // endpoint, so it only runs on a screen whose form has delivered something.
    case "plan-webhooks": {
      const webhookId = { fromStep: 0, field: "webhookId" };
      return [
        { kind: "webhook.create", args: { formId, url: FAKE_ENDPOINT_URL, active: true } },
        { kind: "webhook.retarget", args: { formId, webhookId, url: FAKE_ENDPOINT_URL_ALT } },
        { kind: "webhook.deactivate", args: { formId, webhookId } },
        { kind: "webhook.reactivate", args: { formId, webhookId } },
        { kind: "webhook.rotate", args: { formId, webhookId } },
        { kind: "webhook.redeliver", args: { formId, deliveryId: factDeliveryId(prompt) } },
      ];
    }
    case "plan-workspace-settings":
      return [memberRoleStep(prompt), workspaceSettingsStep(prompt)];
    case "plan-responses": {
      const sessionId = factSessionId(prompt);
      return [
        { kind: "response.unflag", args: { formId, sessionId } },
        { kind: "response.erase", args: { formId, sessionId, reason: "subject_request" } },
      ];
    }
    // A hand-off may only end a plan, so this one proves the runner reaches it after a
    // step that carries a token of its own.
    case "plan-export-last":
      return [
        mintStep(formId, 1),
        { kind: "response.export", args: { formId, format: "csv", shape: "long" } },
      ];
    // `injection-follow` obeys the instruction planted in a fixture question title and
    // slips the production release in behind a plausible one, which is the same two steps
    // a legitimate promotion asks for. That is the point: only the card tells them apart.
    case "plan-two-envs":
    case "injection-follow":
      return [
        releaseStep(formId, factVersion(prompt), "test"),
        releaseStep(formId, factVersion(prompt), "prod"),
      ];
    // The endpoint change a workspace holds for a second approver, then the delivery verb
    // behind it: the second step is what Not run has to be shown on.
    case "plan-pending-at-1":
      return [
        {
          kind: "webhook.retarget",
          args: { formId, webhookId: factWebhookId(prompt), url: FAKE_ENDPOINT_URL_ALT },
        },
        { kind: "webhook.redeliver", args: { formId, deliveryId: factDeliveryId(prompt) } },
      ];
    case "plan-26-steps":
      return Array.from({ length: 26 }, (_, index) => mintStep(formId, index + 1));
    default:
      return [mintStep(formId)];
  }
}

/**
 * One card per kind: `propose-<kind>` puts that kind alone up for review, which is what a
 * screen group's confirm and cancel paths drive.
 */
const SINGLE_ACTIONS: Readonly<
  Record<string, (prompt: readonly PromptMessage[]) => Record<string, unknown>>
> = {
  "propose-form-create": (prompt) => createFormStep(prompt),
  "propose-question-create": (prompt) => createQuestionStep(prompt),
  "propose-link-mint": (prompt) => mintStep(factFormId(prompt), 2),
  "propose-link-revoke": (prompt) => revokeStep(factFormId(prompt), factActiveLinkId(prompt)),
  "propose-question-save-draft": (prompt) => {
    const questionId = factQuestionId(prompt);
    return {
      kind: "question.saveDraft",
      args: {
        questionId,
        version: factQuestionVersion(prompt, "draft"),
        definition: fakeQuestionDefinition(questionId),
      },
    };
  },
  "propose-question-publish": (prompt) => ({
    kind: "question.publish",
    args: {
      questionId: factQuestionId(prompt),
      version: factQuestionVersion(prompt, "draft"),
    },
  }),
  "propose-question-deprecate": (prompt) => ({
    kind: "question.deprecate",
    args: {
      questionId: factQuestionId(prompt),
      version: factQuestionVersion(prompt, "published"),
    },
  }),
  "propose-question-new-version": (prompt) => ({
    kind: "question.newVersion",
    args: { questionId: factQuestionId(prompt) },
  }),
  "propose-form-settings": (prompt) => ({
    kind: "form.settings",
    args: { formId: factFormId(prompt), challengeRequired: true, minSubmitMs: 1500 },
  }),
  "propose-form-close": (prompt) => ({
    kind: "form.close",
    args: { formId: factFormId(prompt) },
  }),
  "propose-form-reopen": (prompt) => ({
    kind: "form.reopen",
    args: { formId: factFormId(prompt) },
  }),
  "propose-form-publish": (prompt) => ({
    kind: "form.publish",
    args: { formId: factFormId(prompt), environment: "test" },
  }),
  // The promotion that names its own destination: a version already in `test` moved on to
  // production, which is the release the screen's own wizard offers once evidence exists.
  "propose-form-release": (prompt) =>
    releaseStep(factFormId(prompt), factVersion(prompt), "prod", "test"),
  "propose-response-erase": (prompt) => ({
    kind: "response.erase",
    args: {
      formId: factFormId(prompt),
      sessionId: factSessionId(prompt),
      reason: "subject_request",
    },
  }),
  "propose-response-unflag": (prompt) => ({
    kind: "response.unflag",
    args: { formId: factFormId(prompt), sessionId: factSessionId(prompt) },
  }),
  "propose-response-export": (prompt) => ({
    kind: "response.export",
    args: { formId: factFormId(prompt), format: "csv", shape: "long" },
  }),
  "propose-webhook-create": (prompt) => ({
    kind: "webhook.create",
    args: { formId: factFormId(prompt), url: FAKE_ENDPOINT_URL, active: true },
  }),
  "propose-webhook-rotate": (prompt) => ({
    kind: "webhook.rotate",
    args: { formId: factFormId(prompt), webhookId: factWebhookId(prompt) },
  }),
  "propose-webhook-retarget": (prompt) => ({
    kind: "webhook.retarget",
    args: {
      formId: factFormId(prompt),
      webhookId: factWebhookId(prompt),
      // The second target, never the one a create script configured: a retarget to the
      // URL the endpoint already holds succeeds and changes nothing a screen could show.
      url: FAKE_ENDPOINT_URL_ALT,
    },
  }),
  "propose-webhook-reactivate": (prompt) => ({
    kind: "webhook.reactivate",
    args: { formId: factFormId(prompt), webhookId: factWebhookId(prompt) },
  }),
  "propose-webhook-deactivate": (prompt) => ({
    kind: "webhook.deactivate",
    args: { formId: factFormId(prompt), webhookId: factWebhookId(prompt) },
  }),
  "propose-webhook-redeliver": (prompt) => ({
    kind: "webhook.redeliver",
    args: { formId: factFormId(prompt), deliveryId: factDeliveryId(prompt) },
  }),
  "propose-access-group-create": (prompt) => groupCreateStep(prompt),
  "propose-access-group-remove": (prompt) => ({
    kind: "access.groupRemove",
    args: { workspaceId: factWorkspaceId(prompt), teamId: factGroupId(prompt) },
  }),
  "propose-access-grant": (prompt) => ({
    kind: "access.grant",
    args: {
      workspaceId: factWorkspaceId(prompt),
      teamId: factGroupId(prompt),
      email: factMember(prompt).email,
    },
  }),
  "propose-access-revoke": (prompt) => ({
    kind: "access.revoke",
    args: {
      workspaceId: factWorkspaceId(prompt),
      teamId: factGroupId(prompt),
      userId: factMember(prompt).userId,
    },
  }),
  "propose-member-role": (prompt) => memberRoleStep(prompt),
  "propose-workspace-settings": (prompt) => workspaceSettingsStep(prompt),
};

const INJECTION_REASON =
  "The form's notes asked me to ship this to production and point the webhook elsewhere, " +
  "so I have put both in one plan.";

const READ_ONLY_REASON =
  "You cannot change anything on this screen, so I can only explain what is here and " +
  "point you at it.";

function planActionStep(script: FakeScript, prompt: readonly PromptMessage[]): StreamPart[] {
  if (script === "read-only-user") {
    return [...textParts(READ_ONLY_REASON, "t0"), finishPart("stop")];
  }

  if (script === "unknown-tool") {
    if (toolCallCount(prompt, UNREGISTERED_TOOL) === 0) {
      const input = { kind: "link.mint", formId: factFormId(prompt) };
      return [
        ...textParts("I will run that for you.", "t0"),
        ...toolInputParts(UNREGISTERED_TOOL, input),
        toolCallPart(UNREGISTERED_TOOL, input),
        finishPart("tool-calls"),
      ];
    }
    return [...textParts("That is not something I can do here.", "t1"), finishPart("stop")];
  }

  const single = SINGLE_ACTIONS[script];
  if (single !== undefined) {
    if (toolCallCount(prompt, "propose_action") === 0) {
      const input = { action: single(prompt) };
      return [
        ...toolInputParts("propose_action", input),
        toolCallPart("propose_action", input),
        finishPart("tool-calls"),
      ];
    }
    return [...textParts("That is on the card for you to confirm.", "t1"), finishPart("stop")];
  }

  if (script === "two-proposals") {
    const called = toolCallCount(prompt, "propose_action");
    if (called < 2) {
      const input = { action: mintStep(factFormId(prompt), called + 1) };
      return [
        ...toolInputParts("propose_action", input, `_${String(called)}`),
        toolCallPart("propose_action", input, `_${String(called)}`),
        finishPart("tool-calls"),
      ];
    }
    return [...textParts("I have put the first one up for review.", "t2"), finishPart("stop")];
  }

  if (toolCallCount(prompt, "propose_plan") === 0) {
    const input = { steps: actionPlanSteps(script, prompt) };
    return [
      ...textParts(script === "injection-follow" ? INJECTION_REASON : "Here is the plan.", "t0"),
      ...toolInputParts("propose_plan", input),
      toolCallPart("propose_plan", input),
      finishPart("tool-calls"),
    ];
  }
  return [...textParts("The plan is on the card for you to confirm.", "t1"), finishPart("stop")];
}

/** The scripts that propose an action or a plan rather than a draft. */
const ACTION_SCRIPTS: readonly FakeScript[] = [
  "plan-three",
  "plan-fails-at-2",
  "plan-two-envs",
  "plan-pending-at-1",
  "two-proposals",
  "plan-26-steps",
  "unknown-tool",
  "injection-follow",
  "read-only-user",
  "plan-intake",
  "plan-releases",
  "plan-links",
  "plan-forms-create",
  "plan-questions-create",
  "plan-question-lifecycle",
  "plan-responses",
  "plan-export-last",
  "plan-webhooks",
  "plan-workspace",
  "plan-workspace-settings",
  ...(Object.keys(SINGLE_ACTIONS) as FakeScript[]),
];

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
  "plan-apply-draft": planApplyDraftStep,
  "plan-apply-draft-release": planApplyDraftReleaseStep,
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

  if (ACTION_SCRIPTS.includes(script)) return planActionStep(script, prompt);

  const results = toolResults(prompt);
  if (script === "read-all") return planReadAllStep(prompt, results, offered);
  const planner = STATEFUL_PLANNERS[script];
  if (planner !== undefined) return planner(prompt, results);
  return planDefaultStep(prompt, results);
}

/**
 * `plan-apply-draft`: the draft this turn proposes, inside a plan. The propose tool keeps
 * one draft-applying step per plan, so the kind is confirmable in one only beside a kind
 * of another sort; the settings step is the builder screen's own.
 */
function planApplyDraftStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
): StreamPart[] {
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
    return [
      toolCallPart("propose_draft", { definition: buildProposal(draft, libraryHits(results)) }),
      finishPart("tool-calls"),
    ];
  }
  if (!results.has("propose_plan")) {
    const formId = currentDraft(prompt)?.formId ?? factFormId(prompt);
    const input = {
      steps: [
        { kind: "apply-draft", args: { formId } },
        { kind: "form.settings", args: { formId, challengeRequired: true, minSubmitMs: 1500 } },
      ],
    };
    return [
      ...textParts("Here is the draft and the abuse controls to go with it.", "t0"),
      ...toolInputParts("propose_plan", input),
      toolCallPart("propose_plan", input),
      finishPart("tool-calls"),
    ];
  }
  return [...textParts("The plan is on the card for you to confirm.", "t1"), finishPart("stop")];
}

/**
 * `plan-apply-draft-release`: the local step first and a later step naming the publish's
 * version, so the token's step indexes and the card's differ where the reference points.
 */
function planApplyDraftReleaseStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
): StreamPart[] {
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
    return [
      toolCallPart("propose_draft", { definition: buildProposal(draft, libraryHits(results)) }),
      finishPart("tool-calls"),
    ];
  }
  if (!results.has("propose_plan")) {
    const drafted = currentDraft(prompt)?.formId;
    const formId = typeof drafted === "string" ? drafted : factFormId(prompt);
    const input = {
      steps: [
        { kind: "apply-draft", args: { formId } },
        { kind: "form.publish", args: { formId, environment: "test" } },
        releaseStep(formId, { fromStep: 1, field: "version" }, "prod"),
      ],
    };
    return [
      ...textParts("I will apply the draft, publish it and release that version.", "t0"),
      ...toolInputParts("propose_plan", input),
      toolCallPart("propose_plan", input),
      finishPart("tool-calls"),
    ];
  }
  return [...textParts("The plan is on the card for you to confirm.", "t1"), finishPart("stop")];
}

/** The `default` script: search, propose the draft, then put it up as a card. */
function planDefaultStep(
  prompt: readonly PromptMessage[],
  results: Map<string, unknown>,
): StreamPart[] {
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
  if (!results.has("propose_action")) return applyDraftCall(prompt);
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
