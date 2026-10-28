/**
 * The tool loop, driven by the deterministic fake provider (041).
 *
 * These run the production `streamText` loop end to end: the only substitution
 * is the language model itself, so the allowlist, the tool dispatch, the
 * stop-reason mapping and the event stream under test are the shipped ones.
 */

import { describe, expect, it } from "vitest";

import {
  parseFormDefinition,
  parseQuestionDefinition,
  type FormDefinition,
  stepQuestionRefs,
} from "@roonga/qcms-core";

import type { AgentThinking } from "../../../config.js";
import { createNullLogger, type Logger } from "../../../logger.js";
import { recordingLogger } from "../../../test-support.js";
import {
  aiSdkDraftAssistant,
  appendTextSegment,
  handlePart,
  newRunOutcome,
  toolOutcomeEvent,
} from "./assistant.js";
import { FAKE_REASONING_SENTINEL, fakeAssistantModel } from "./fake-model.js";
import {
  ASSIST_ERROR_CODES,
  type AssistContext,
  type AssistEvent,
  type LibraryEntry,
} from "./types.js";

function questionFixture(id: string, label: string) {
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "boolean",
    label: { en: label },
  });
  if (!parsed.ok) throw new Error(`fixture question invalid: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

const LIBRARY: readonly LibraryEntry[] = [
  {
    questionId: questionFixture("q_at_fault_accident", "At-fault accident?").questionId,
    slug: "at-fault-accident",
    version: 1,
    definition: questionFixture("q_at_fault_accident", "At-fault accident?"),
  },
  {
    questionId: questionFixture("q_accident_detail", "Describe the accident").questionId,
    slug: "accident-detail",
    version: 1,
    definition: questionFixture("q_accident_detail", "Describe the accident"),
  },
];

function draftFixture(): FormDefinition {
  const parsed = parseFormDefinition({
    formId: "frm_quote",
    defaultLocale: "en",
    title: { en: "Vehicle insurance quote" },
    steps: [
      {
        stepId: "stp_start",
        title: { en: "Start" },
        items: [{ questionId: "q_at_fault_accident", version: 1 }],
      },
    ],
    rules: [],
  });
  if (!parsed.ok) throw new Error(`fixture draft invalid: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

function contextFor(
  message: string,
  overrides: Partial<AssistContext> = {},
): { ctx: AssistContext; validated: FormDefinition[] } {
  const validated: FormDefinition[] = [];
  const ctx: AssistContext = {
    draft: draftFixture(),
    questionLibrary: {
      search: (_query, limit) => Promise.resolve(LIBRARY.slice(0, limit)),
    },
    conversation: [{ role: "user", content: message }],
    validate: (definition) => {
      validated.push(definition);
      return Promise.resolve({ issues: [], warnings: [] });
    },
    maxSteps: 8,
    ...overrides,
  };
  return { ctx, validated };
}

async function collect(
  ctx: AssistContext,
  logger: Logger = createNullLogger(),
): Promise<AssistEvent[]> {
  const assistant = aiSdkDraftAssistant({
    model: fakeAssistantModel(),
    providerId: "fake",
    logger,
  });
  const events: AssistEvent[] = [];
  for await (const event of assistant.assist(ctx, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

/** The same loop with `QCMS_AGENT_THINKING` at a chosen value (081). */
async function collectWithThinking(
  ctx: AssistContext,
  thinking: AgentThinking,
  logger: Logger = createNullLogger(),
): Promise<AssistEvent[]> {
  const assistant = aiSdkDraftAssistant({
    model: fakeAssistantModel(),
    providerId: "fake",
    logger,
    thinking,
  });
  const events: AssistEvent[] = [];
  for await (const event of assistant.assist(ctx, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

describe("draft assistant tool loop (fake provider)", () => {
  it("searches the library, proposes a draft, and returns it server-validated", async () => {
    const { ctx, validated } = contextFor(
      "a vehicle-insurance quote where an at-fault accident opens a follow-up",
    );
    const events = await collect(ctx);

    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal, JSON.stringify(events)).toBeDefined();
    if (proposal?.type !== "proposal") throw new Error("unreachable");

    expect(proposal.proposal.proposedDraft.steps.map((s) => s.stepId)).toEqual([
      "stp_agent_history",
    ]);
    // Both library questions on the one step, with the forward-only rule (ADR-16)
    // the fake script builds revealing the second from an answer to the first.
    expect(proposal.proposal.proposedDraft.steps[0]?.items).toHaveLength(2);
    expect(proposal.proposal.proposedDraft.rules).toHaveLength(1);
    expect(proposal.proposal.proposedDraft.rules[0]?.show).toEqual(["q_accident_detail"]);
    expect(proposal.proposal.issues).toEqual([]);
    expect(proposal.proposal.warnings).toEqual([]);
    expect(proposal.proposal.rationale).not.toBe("");

    // The advisory validation is the server's own, run before the proposal left.
    expect(validated.at(-1)?.steps.map((s) => s.stepId)).toEqual(["stp_agent_history"]);

    // The library search actually ran: the proposal pins what search returned.
    const firstStep = proposal.proposal.proposedDraft.steps[0];
    expect(firstStep === undefined ? undefined : stepQuestionRefs(firstStep)[0]?.questionId).toBe(
      "q_at_fault_accident",
    );
  });

  /**
   * The second advisory channel (issue #123) reaches the proposal exactly as the
   * first does.
   *
   * The kernel validates everything, and after that split "everything" is two
   * lists rather than one. A warning describes a draft that WOULD publish, so an
   * assistant that dropped it would hand the author a proposal card reading
   * "validation passes" over a draft the builder's own validation panel flags the
   * moment it is accepted - the same surface disagreeing with itself about one
   * draft. The port is stubbed here rather than driven through a warning-producing
   * fixture on purpose: what is under test is that this slice relays what 022's
   * validation returned, and `packages/core` owns whether a given draft earns a
   * warning.
   */
  it("carries the warnings the server's own validation returned, beside the issues", async () => {
    const warning = {
      code: "MULTICHOICE_SAME_STEP_TARGET" as const,
      message: "This rule reveals a question on the step it reads from.",
      path: {
        rule: "rul_x" as never,
        question: "q_a" as never,
        target: "q_b" as never,
        step: "stp_a" as never,
      },
    };
    const { ctx } = contextFor(
      "a vehicle-insurance quote where an at-fault accident opens a follow-up",
      { validate: () => Promise.resolve({ issues: [], warnings: [warning] }) },
    );

    const proposal = (await collect(ctx)).find((e) => e.type === "proposal");
    if (proposal?.type !== "proposal") throw new Error("unreachable");
    expect(proposal.proposal.warnings).toEqual([warning]);
    // Still publishable: a warning is not an issue, and collapsing the two is the
    // exact confusion issue #123 split them to prevent.
    expect(proposal.proposal.issues).toEqual([]);
  });

  it("reports token counts and step counts, never content", async () => {
    const { ctx } = contextFor("build me a form");
    const usage = (await collect(ctx)).find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    if (usage?.type !== "usage") throw new Error("unreachable");
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.steps).toBeGreaterThan(0);
  });

  it("maps a model refusal to a REFUSED error rather than an empty proposal", async () => {
    const { ctx } = contextFor("#qcms-fake:refusal do something questionable");
    const events = await collect(ctx);
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "REFUSED" });
  });

  /**
   * The split issue #818 exists for, asserted from both sides in one table.
   *
   * The live failure was a real account with no balance: a 429 the SDK had
   * already marked non-retryable, rendered as "try again shortly". Retryable and
   * non-retryable have to reach the panel as different codes or the operator is
   * told to wait when they must act - and the second row is only half of it. The
   * first row is the regression that would send someone to check an account that
   * is fine, so a plain failure staying `PROVIDER_ERROR` is pinned beside it.
   */
  it.each([
    ["provider-error", "PROVIDER_ERROR"],
    ["provider-rejected", "PROVIDER_REJECTED"],
  ])("maps the %s script to %s", async (script, code) => {
    const { ctx } = contextFor(`#qcms-fake:${script} hello`);
    const events = await collect(ctx);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code });
  });

  it("logs the refusal without writing any vendor detail into the record", async () => {
    // The panel shows the operator no vendor detail at all (SEC-8), so this log
    // line is the only trace of a permanent refusal. It must carry enough to act
    // on and nothing the vendor wrote.
    const { logger, lines } = recordingLogger();
    const { ctx } = contextFor("#qcms-fake:provider-rejected hello");
    await collect(ctx, logger);
    const record = lines.find((line) => line["msg"] === "draft assistant provider failure");
    expect(record).toBeDefined();
    expect(record).toMatchObject({ provider: "fake", retryable: false, statusCode: 429 });
    // The SDK's own sentence rides on the event to an authenticated admin; it
    // does not ride into the log, where an exporter or an aggregator would take
    // it somewhere nobody chose.
    expect(JSON.stringify(record)).not.toContain("upstream provider refused");
  });

  /**
   * A failed tool call is not a failed turn (found live on 2026-09-05).
   *
   * The Code Owner drove "add step called registration" against a local model.
   * It malformed one `propose_draft` call, corrected itself, proposed
   * successfully, and finished with `stop` in six of its twelve steps - and the
   * panel showed the narration followed by "the assistant is unavailable right
   * now. Try again shortly", with the proposal discarded. The turn had worked.
   *
   * The cause was a `tool-error` part being routed to the same place a stream
   * failure goes. A provider error is terminal and is checked before the
   * proposal, so one bad call anywhere destroyed everything after it. Local
   * models produce at least one such call on most real turns, so this was not
   * an edge: it was the common path.
   */
  it("keeps the proposal when a tool call failed and the model recovered", async () => {
    const { ctx } = contextFor("#qcms-fake:tool-error-recovered build me a form");
    const events = await collect(ctx);

    const proposal = events.find((e) => e.type === "proposal");
    expect(
      proposal,
      `no proposal survived: ${JSON.stringify(events.map((e) => e.type))}`,
    ).toBeDefined();
    // And nothing told the operator the provider was unavailable.
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  describe("tool outcomes, for an honest step timeline", () => {
    /** `[tool, outcome]` per announced step, in step order. */
    function stepOutcomes(events: readonly AssistEvent[]): [string, string | undefined][] {
      const announced = events.flatMap((e) =>
        e.type === "status" && e.phase === "tool" && e.step !== undefined
          ? [{ tool: e.tool ?? "", step: e.step }]
          : [],
      );
      return announced.map(({ tool, step }) => {
        const outcome = events.find((e) => e.type === "tool-outcome" && e.step === step);
        return [tool, outcome?.type === "tool-outcome" ? outcome.outcome : undefined];
      });
    }

    it("reports every call of a successful turn as done, each after its own announcement", async () => {
      const { ctx } = contextFor("a vehicle-insurance quote");
      const events = await collect(ctx);
      expect(stepOutcomes(events)).toEqual([
        ["search_question_library", "done"],
        ["propose_draft", "done"],
      ]);
      const announced = events.findIndex((e) => e.type === "status" && e.step === 1);
      const finished = events.findIndex((e) => e.type === "tool-outcome" && e.step === 1);
      expect(announced).toBeLessThan(finished);
    });

    it("reports a failed call as failed, and the retry on its own step", async () => {
      const { ctx } = contextFor("#qcms-fake:tool-error-recovered build me a form");
      const events = await collect(ctx);
      expect(stepOutcomes(events)).toEqual([
        ["propose_draft", "failed"],
        ["search_question_library", "done"],
        ["propose_draft", "done"],
      ]);
      // No error text travels with the outcome (SEC-8).
      for (const event of events.filter((e) => e.type === "tool-outcome")) {
        expect(Object.keys(event).sort()).toEqual(["outcome", "step", "type"]);
      }
    });

    it("maps a result the executor refused to failed, and an unannounced call to nothing", () => {
      const steps = new Map([["call_1", 1]]);
      expect(toolOutcomeEvent(steps, "call_1", { accepted: false, reason: "x" })).toEqual({
        type: "tool-outcome",
        step: 1,
        outcome: "failed",
      });
      expect(toolOutcomeEvent(steps, "call_1", { accepted: true })).toMatchObject({
        outcome: "done",
      });
      expect(toolOutcomeEvent(steps, "call_1", undefined, { errored: true })).toMatchObject({
        outcome: "failed",
      });
      expect(toolOutcomeEvent(steps, "call_1", {}, { preliminary: true })).toBeUndefined();
      expect(toolOutcomeEvent(steps, "call_unknown", {})).toBeUndefined();
    });

    it("keeps the finished step done when the provider then fails, and adds no outcome", async () => {
      const { ctx } = contextFor("#qcms-fake:tool-then-provider-error go");
      const events = await collect(ctx);
      expect(stepOutcomes(events)).toEqual([["search_question_library", "done"]]);
      expect(events.at(-1)).toMatchObject({ type: "error", code: "PROVIDER_ERROR" });
    });

    it("announces no step and no outcome for a refused verb", async () => {
      const { ctx } = contextFor("#qcms-fake:rogue-publish do it");
      const events = await collect(ctx);
      expect(events.filter((e) => e.type === "tool-outcome")).toHaveLength(0);
      expect(stepOutcomes(events)).toEqual([]);
    });
  });

  it("counts the failed call in the turn record without quoting it", async () => {
    // The count is what makes a recovered turn diagnosable at all now that it no
    // longer surfaces as an error. The message must not travel with it: a tool
    // error's text is assembled from input the model wrote (SEC-8).
    const { logger, lines } = recordingLogger();
    const { ctx } = contextFor("#qcms-fake:tool-error-recovered build me a form");
    await collect(ctx, logger);

    const record = lines.find((line) => line["msg"] === "draft assistant turn");
    expect(record).toMatchObject({ toolErrors: 1, finishReason: "stop" });
    expect(JSON.stringify(record)).not.toContain("formId");
  });

  /**
   * A refused turn is not a turn with a tool error in it (issue #840).
   *
   * The SDK reports an unallowlisted verb twice: once as the parsed `tool-call`
   * part, `toolName` intact and `invalid: true`, which is where the refusal is
   * recorded, and once again as the paired `tool-error` part carrying the same
   * call. Counting the second one made the record say a tool had failed on a
   * turn where none had run, and `toolErrors` is the field an operator reads to
   * tell a model correcting itself from a model that cannot call this API at
   * all. A refusal is neither, so it counts as neither.
   */
  it("logs a refused turn with no tool errors counted", async () => {
    const { logger, lines } = recordingLogger();
    const { ctx } = contextFor("#qcms-fake:rogue-publish do it");
    await collect(ctx, logger);

    const record = lines.find((line) => line["msg"] === "draft assistant turn");
    expect(record).toMatchObject({ toolRejected: true, toolErrors: 0 });
  });

  it("still stops the turn when the failed call was a refused verb", async () => {
    // The one tool failure that must remain terminal: an unallowlisted verb
    // arrives the same way, and 041's control is that a model which reached for
    // it gets none of its other work accepted.
    const { ctx } = contextFor("#qcms-fake:rogue-publish do it");
    const events = await collect(ctx);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "REFUSED" });
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
  });

  /**
   * A refused turn stops at the refusing step (issue #814).
   *
   * The security control always held - no proposal is yielded - but the loop
   * carried on asking. `stopWhen` was `stepCountIs(maxSteps)` alone, so a model
   * that reached for `publish` was told "no such tool" and asked again until the
   * budget ran out: eight round trips a real provider bills for, to reach a
   * conclusion that was settled at the first one. The `rogue-publish` script
   * asks on every step, so the step count is the whole assertion - with the
   * ceiling at 8 and no stop condition on the refusal this reads 8.
   */
  it("stops at the step that reached for the forbidden verb, not at the ceiling", async () => {
    const { ctx } = contextFor("#qcms-fake:rogue-publish do it", { maxSteps: 8 });
    const events = await collect(ctx);

    const usage = events.find((e) => e.type === "usage");
    if (usage?.type !== "usage") throw new Error("expected a usage event");
    expect(usage.steps).toBe(1);

    // What the operator saw in #814's screenshot was the same narration eight
    // times over, which is the same defect from the panel's side.
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
  });

  it("keeps the refusal single and its copy unchanged when the loop stops early", async () => {
    // Ending the loop sooner must not change what a refused turn IS. The
    // rejection is named once, the code and the sentence are the ones the panel
    // already renders, and nothing else rides along.
    const { ctx } = contextFor("#qcms-fake:rogue-publish do it", { maxSteps: 8 });
    const events = await collect(ctx);

    expect(events.filter((e) => e.type === "tool-rejected")).toEqual([
      { type: "tool-rejected", tool: "publish_form" },
    ]);
    expect(events.filter((e) => e.type === "error")).toEqual([
      {
        type: "error",
        code: "REFUSED",
        message: "The assistant attempted an action outside its allowed tools and was stopped.",
      },
    ]);
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
  });

  it("reports NO_PROPOSAL when the turn ends without one", async () => {
    const { ctx } = contextFor("#qcms-fake:no-proposal hello");
    const events = await collect(ctx);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "NO_PROPOSAL" });
  });
});

/**
 * Every declared error code, and the scripted scenario that produces it.
 *
 * This table is the fix for the class of defect `STEP_LIMIT` was an instance of:
 * a code that is declared, has copy rendered for it, and can never be emitted.
 * The two assertions below are deliberately different shapes, because a table
 * like this is only as good as what happens when it goes stale:
 *
 *  - every row must actually produce its code, so a code that stops being
 *    emitted fails here rather than silently becoming decoration again;
 *  - the rows must cover `ASSIST_ERROR_CODES` exactly, so adding a sixth code
 *    without a scenario that reaches it fails too.
 */
const ERROR_SCENARIOS: readonly (readonly [string, string])[] = [
  ["provider-error", "PROVIDER_ERROR"],
  ["provider-rejected", "PROVIDER_REJECTED"],
  ["no-proposal", "NO_PROPOSAL"],
  ["refusal", "REFUSED"],
  ["length", "LENGTH"],
  ["step-limit", "STEP_LIMIT"],
];

describe("assist error codes are all reachable", () => {
  it.each(ERROR_SCENARIOS)("script %s emits %s", async (script, expected) => {
    // A small ceiling so the step-limit script exhausts quickly; every other
    // script finishes in one step and is unaffected by it.
    const { ctx } = contextFor(`#qcms-fake:${script} go`, { maxSteps: 3 });
    const events = await collect(ctx);

    const error = events.find((e) => e.type === "error");
    expect(
      error,
      `script ${script} produced no error event: ${JSON.stringify(events)}`,
    ).toBeDefined();
    if (error?.type !== "error") throw new Error("unreachable");
    expect(error.code).toBe(expected);
    // The message is what an operator reads, so an empty one is a defect even
    // when the code is right.
    expect(error.message.length).toBeGreaterThan(0);
    // ...and it is framed into the SSE response body by `handler.ts`, so it carries no
    // environment identifier (ADR-24 as widened 2026-09-12; issue #910). Asserted on
    // every row rather than only on `STEP_LIMIT`, which is the row that broke it: a
    // sixth code whose sentence names a variable fails here without anyone remembering
    // the rule. `QCMS_` is this repository's environment prefix.
    expect(error.message).not.toMatch(/QCMS_[A-Z0-9_]+/);
    // No code may arrive with a proposal attached: an error turn is terminal.
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
  });

  it("covers every declared code, so a new code cannot be unreachable", () => {
    expect([...ERROR_SCENARIOS.map(([, code]) => code)].sort()).toEqual(
      [...ASSIST_ERROR_CODES].sort(),
    );
  });

  it("distinguishes step exhaustion from a model that simply did not answer", async () => {
    // The distinction this pins is the reason STEP_LIMIT exists at all: both of
    // these turns end with no proposal, and they are different problems with
    // different fixes. If the two ever collapse back into one code, this fails.
    const exhausted = await collect(contextFor("#qcms-fake:step-limit go", { maxSteps: 3 }).ctx);
    const silent = await collect(contextFor("#qcms-fake:no-proposal go", { maxSteps: 3 }).ctx);

    const codeOf = (events: AssistEvent[]): string | undefined => {
      const error = events.find((e) => e.type === "error");
      return error?.type === "error" ? error.code : undefined;
    };
    expect(codeOf(exhausted)).toBe("STEP_LIMIT");
    expect(codeOf(silent)).toBe("NO_PROPOSAL");
    expect(codeOf(exhausted)).not.toBe(codeOf(silent));
  });

  it("reports the step count it actually reached when the ceiling cuts it off", async () => {
    const events = await collect(contextFor("#qcms-fake:step-limit go", { maxSteps: 3 }).ctx);
    const usage = events.find((e) => e.type === "usage");
    if (usage?.type !== "usage") throw new Error("expected a usage event");
    // The ceiling was reached, which is what makes STEP_LIMIT the truthful code
    // rather than a guess.
    expect(usage.steps).toBe(3);
  });
});

/** A `tool-call` part, spelled past the SDK's generic `ToolSet` input typing. */
function toolCallPart(toolCallId: string, toolName: string): Parameters<typeof handlePart>[0] {
  return { type: "tool-call", toolCallId, toolName, input: {} } as unknown as Parameters<
    typeof handlePart
  >[0];
}

/**
 * Streaming improvements 1 and 3, at the mapping (080 exit criteria 1, 2 and 3).
 *
 * `handlePart` directly rather than only through the loop, because what the
 * criteria name is an ORDER: the timeline row has to leave on the part that says
 * a call's input has started, not on the part that says the call is parsed.
 * Through the loop both produce the same single `status` event, so only feeding
 * the parts one at a time can tell which one emitted it.
 */
describe("handlePart maps the input phase and the segment ids", () => {
  it("announces an allowlisted step from tool-input-start, before the parsed call", () => {
    const outcome = newRunOutcome();

    const announced = handlePart(
      { type: "tool-input-start", id: "call_1", toolName: "propose_draft" },
      outcome,
    );
    expect(announced).toEqual({ type: "status", phase: "tool", tool: "propose_draft", step: 1 });

    // The parsed call for the SAME id adds nothing: one row per call, and it is
    // already on screen while the definition's JSON is still arriving.
    expect(handlePart(toolCallPart("call_1", "propose_draft"), outcome)).toBeUndefined();
    expect(outcome.rejectedTool).toBeUndefined();
  });

  it("emits nothing for a name outside the allowlist and leaves the refusal to the parsed call", () => {
    const outcome = newRunOutcome();

    expect(
      handlePart({ type: "tool-input-start", id: "call_x", toolName: "publish_form" }, outcome),
    ).toBeUndefined();
    // Deliberately NOT recorded here: a half-streamed name must not end a turn.
    expect(outcome.rejectedTool).toBeUndefined();

    expect(handlePart(toolCallPart("call_x", "publish_form"), outcome)).toBeUndefined();
    expect(outcome.rejectedTool).toBe("publish_form");
  });

  it("still announces a step for a call that arrived with no input phase", () => {
    const outcome = newRunOutcome();
    expect(handlePart(toolCallPart("call_2", "validate_draft"), outcome)).toEqual({
      type: "status",
      phase: "tool",
      tool: "validate_draft",
      step: 1,
    });
  });

  it("carries the provider's text segment id on every delta", () => {
    const outcome = newRunOutcome();
    expect(handlePart({ type: "text-delta", id: "t0", text: "Loo" }, outcome)).toEqual({
      type: "text",
      delta: "Loo",
      segment: "t0",
    });
    expect(handlePart({ type: "text-delta", id: "t0", text: "king" }, outcome)).toEqual({
      type: "text",
      delta: "king",
      segment: "t0",
    });
    expect(handlePart({ type: "text-delta", id: "t1", text: "Done" }, outcome)).toEqual({
      type: "text",
      delta: "Done",
      segment: "t1",
    });
    expect(outcome.textSegments).toEqual([
      { id: "t0", text: "Looking" },
      { id: "t1", text: "Done" },
    ]);
  });

  it("starts a new segment when a provider reuses an id after another one", () => {
    const segments: { id: string; text: string }[] = [];
    appendTextSegment(segments, "t0", "one");
    appendTextSegment(segments, "t1", "two");
    appendTextSegment(segments, "t0", "three");
    expect(segments).toEqual([
      { id: "t0", text: "one" },
      { id: "t1", text: "two" },
      { id: "t0", text: "three" },
    ]);
  });
});

describe("narrate-then-tools, through the shipped loop", () => {
  it("interleaves prose segments with the step rows and quotes only the last segment", async () => {
    const { ctx } = contextFor("#qcms-fake:narrate-then-tools a quote form");
    const events = await collect(ctx);

    // The arrival order a panel folds into bubbles: prose, a step, prose, a
    // step, prose. The rationale the card shows is that last prose and nothing
    // before it, which is what streaming improvement 3 buys.
    const shape = events.flatMap((event) => {
      if (event.type === "text") return [`text:${event.segment ?? "?"}`];
      if (event.type === "status" && event.phase === "tool") return [`step:${String(event.step)}`];
      return [];
    });
    expect(shape).toEqual(["text:t0", "step:1", "text:t1", "step:2", "text:t2"]);

    const proposal = events.find((e) => e.type === "proposal");
    if (proposal?.type !== "proposal") throw new Error("expected a proposal");
    expect(proposal.proposal.rationale).toContain("driving-history step");
    expect(proposal.proposal.rationale).not.toContain("question library");
  });

  it("settles both announced steps on the API's own outcome events", async () => {
    const { ctx } = contextFor("#qcms-fake:narrate-then-tools a quote form");
    const events = await collect(ctx);
    const outcomes = events.flatMap((event) =>
      event.type === "tool-outcome" ? [[event.step, event.outcome] as const] : [],
    );
    expect(outcomes).toEqual([
      [1, "done"],
      [2, "done"],
    ]);
  });
});

/**
 * Thinking, at the mapping and through the loop (081 exit criteria 1, 2 and 5).
 *
 * The `reasoning` script emits its parts on every round **whatever the setting
 * is**, so each case below is the same scripted model and only the setting
 * differs. That is what makes the `off` case meaningful: it proves the mapping
 * drops reasoning a provider volunteered, not that the request forgot to ask.
 */
describe("reasoning events", () => {
  function reasoningPart(text: string): Parameters<typeof handlePart>[0] {
    return { type: "reasoning-delta", id: "r0", text };
  }

  it("forwards a delta and the end under summary", () => {
    const outcome = newRunOutcome();
    expect(handlePart(reasoningPart("weighing it up"), outcome, "summary")).toEqual({
      type: "reasoning",
      delta: "weighing it up",
    });
    expect(handlePart({ type: "reasoning-end", id: "r0" }, outcome, "summary")).toEqual({
      type: "reasoning-end",
    });
  });

  it("drops both under off, and keeps nothing", () => {
    const outcome = newRunOutcome();
    expect(handlePart(reasoningPart("weighing it up"), outcome, "off")).toBeUndefined();
    expect(handlePart({ type: "reasoning-end", id: "r0" }, outcome, "off")).toBeUndefined();
    // Not buffered anywhere: there is no field a logger or the next turn's
    // request could read reasoning text out of (SEC-8).
    expect(JSON.stringify(outcome)).not.toContain("weighing it up");
  });

  it("drops both when no setting was given, so the default is the safe one", () => {
    const outcome = newRunOutcome();
    expect(handlePart(reasoningPart("secret"), outcome)).toBeUndefined();
  });

  it("puts no reasoning frame on the wire under the default, though the script emitted parts", async () => {
    const { ctx } = contextFor("#qcms-fake:reasoning a quote form");
    const events = await collect(ctx);

    expect(events.filter((e) => e.type === "reasoning")).toHaveLength(0);
    expect(events.filter((e) => e.type === "reasoning-end")).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain(FAKE_REASONING_SENTINEL);
    // The turn still works: the setting changes visibility and nothing else.
    expect(events.find((e) => e.type === "proposal")).toBeDefined();
  });

  it("streams the frames under summary, carrying the sentinel", async () => {
    const { ctx } = contextFor("#qcms-fake:reasoning a quote form");
    const events = await collectWithThinking(ctx, "summary");

    const deltas = events.flatMap((e) => (e.type === "reasoning" ? [e.delta] : []));
    expect(deltas.join("")).toContain(FAKE_REASONING_SENTINEL);
    expect(events.filter((e) => e.type === "reasoning-end").length).toBeGreaterThan(0);
    expect(events.find((e) => e.type === "proposal")).toBeDefined();
  });

  /** SEC-8: the sentinel reaches no log line and no conversation the model sees. */
  it("logs a reasoning token count and never a word of the text", async () => {
    const { logger, lines } = recordingLogger();
    const { ctx } = contextFor("#qcms-fake:reasoning a quote form");
    await collectWithThinking(ctx, "summary", logger);

    const serialised = JSON.stringify(lines);
    expect(serialised).not.toContain(FAKE_REASONING_SENTINEL);

    const record = lines.find((line) => line["msg"] === "draft assistant turn");
    expect(record, JSON.stringify(lines)).toBeDefined();
    // The field is on the record beside the input and output counts. Its VALUE
    // does not survive to stdout: the JSON logger's redactor blanks any key
    // containing "token", which has always been true of `inputTokens` and
    // `outputTokens` too, so what a stdout reader sees is `[REDACTED]`. That is
    // the redactor being conservative rather than this line being wrong, and it
    // fails safe in the direction SEC-8 cares about.
    expect(record).toHaveProperty("reasoningTokens");
    expect(record?.["reasoningTokens"]).toBe("[REDACTED]");
    expect(record?.["outputTokens"]).toBe("[REDACTED]");
  });

  it("carries no reasoning into the history a next turn would replay", async () => {
    const { ctx } = contextFor("#qcms-fake:reasoning a quote form");
    const events = await collectWithThinking(ctx, "summary");

    // The proposal's rationale is what the panel folds into the conversation it
    // sends back, and it is a TEXT segment: reasoning has no path into it.
    const proposal = events.find((e) => e.type === "proposal");
    if (proposal?.type !== "proposal") throw new Error("expected a proposal");
    expect(proposal.proposal.rationale).not.toContain(FAKE_REASONING_SENTINEL);
  });
});

describe("a refused verb that streamed its input first", () => {
  it("puts no row on the timeline and still ends the turn refused", async () => {
    const { ctx } = contextFor("#qcms-fake:rogue-publish publish this");
    const events = await collect(ctx);

    expect(events.filter((e) => e.type === "status" && e.phase === "tool")).toHaveLength(0);
    expect(events.find((e) => e.type === "tool-rejected")).toEqual({
      type: "tool-rejected",
      tool: "publish_form",
    });
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "REFUSED" });
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
  });
});
