import { describe, expect, it } from "vitest";

import {
  parseFormDefinition,
  parseQuestionDefinition,
  type FormDefinition,
  stepQuestionRefs,
} from "@roonga/qcms-core";

import { createNullLogger, type Logger } from "../../../logger.js";
import { recordingLogger } from "../../../test-support.js";
import { aiSdkDraftAssistant, toolOutcomeEvent } from "./assistant.js";
import { fakeAssistantModel } from "./fake-model.js";
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
    expect(proposal.proposal.proposedDraft.steps[0]?.items).toHaveLength(2);
    expect(proposal.proposal.proposedDraft.rules).toHaveLength(1);
    expect(proposal.proposal.proposedDraft.rules[0]?.show).toEqual(["q_accident_detail"]);
    expect(proposal.proposal.issues).toEqual([]);
    expect(proposal.proposal.warnings).toEqual([]);
    expect(proposal.proposal.rationale).not.toBe("");

    expect(validated.at(-1)?.steps.map((s) => s.stepId)).toEqual(["stp_agent_history"]);

    const firstStep = proposal.proposal.proposedDraft.steps[0];
    expect(firstStep === undefined ? undefined : stepQuestionRefs(firstStep)[0]?.questionId).toBe(
      "q_at_fault_accident",
    );
  });

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

  it.each([
    ["provider-error", "PROVIDER_ERROR"],
    ["provider-rejected", "PROVIDER_REJECTED"],
  ])("maps the %s script to %s", async (script, code) => {
    const { ctx } = contextFor(`#qcms-fake:${script} hello`);
    const events = await collect(ctx);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code });
  });

  it("logs the refusal without writing any vendor detail into the record", async () => {
    const { logger, lines } = recordingLogger();
    const { ctx } = contextFor("#qcms-fake:provider-rejected hello");
    await collect(ctx, logger);
    const record = lines.find((line) => line["msg"] === "draft assistant provider failure");
    expect(record).toBeDefined();
    expect(record).toMatchObject({ provider: "fake", retryable: false, statusCode: 429 });
    // The SDK's own sentence rides on the event to an authenticated admin, never into a
    // log an exporter may forward.
    expect(JSON.stringify(record)).not.toContain("upstream provider refused");
  });

  it("keeps the proposal when a tool call failed and the model recovered", async () => {
    const { ctx } = contextFor("#qcms-fake:tool-error-recovered build me a form");
    const events = await collect(ctx);

    const proposal = events.find((e) => e.type === "proposal");
    expect(
      proposal,
      `no proposal survived: ${JSON.stringify(events.map((e) => e.type))}`,
    ).toBeDefined();
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  describe("tool outcomes, for an honest step timeline", () => {
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
    // A tool error's text is assembled from input the model wrote, so it must not travel
    // into the record.
    const { logger, lines } = recordingLogger();
    const { ctx } = contextFor("#qcms-fake:tool-error-recovered build me a form");
    await collect(ctx, logger);

    const record = lines.find((line) => line["msg"] === "draft assistant turn");
    expect(record).toMatchObject({ toolErrors: 1, finishReason: "stop" });
    expect(JSON.stringify(record)).not.toContain("formId");
  });

  // The SDK reports an unallowlisted verb twice, as an invalid `tool-call` part and again
  // as the paired `tool-error` part; only the first is the refusal.
  it("logs a refused turn with no tool errors counted", async () => {
    const { logger, lines } = recordingLogger();
    const { ctx } = contextFor("#qcms-fake:rogue-publish do it");
    await collect(ctx, logger);

    const record = lines.find((line) => line["msg"] === "draft assistant turn");
    expect(record).toMatchObject({ toolRejected: true, toolErrors: 0 });
  });

  it("still stops the turn when the failed call was a refused verb", async () => {
    const { ctx } = contextFor("#qcms-fake:rogue-publish do it");
    const events = await collect(ctx);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "REFUSED" });
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
  });

  // The `rogue-publish` script asks on every step, so without a stop condition on the
  // refusal the step count would read the full ceiling.
  it("stops at the step that reached for the forbidden verb, not at the ceiling", async () => {
    const { ctx } = contextFor("#qcms-fake:rogue-publish do it", { maxSteps: 8 });
    const events = await collect(ctx);

    const usage = events.find((e) => e.type === "usage");
    if (usage?.type !== "usage") throw new Error("expected a usage event");
    expect(usage.steps).toBe(1);

    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
  });

  it("keeps the refusal single and its copy unchanged when the loop stops early", async () => {
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
    // A small ceiling so the step-limit script exhausts quickly; every other script
    // finishes in one step.
    const { ctx } = contextFor(`#qcms-fake:${script} go`, { maxSteps: 3 });
    const events = await collect(ctx);

    const error = events.find((e) => e.type === "error");
    expect(
      error,
      `script ${script} produced no error event: ${JSON.stringify(events)}`,
    ).toBeDefined();
    if (error?.type !== "error") throw new Error("unreachable");
    expect(error.code).toBe(expected);
    expect(error.message.length).toBeGreaterThan(0);
    // The message is framed into the SSE body, which carries no environment identifier
    // (ADR-24); `QCMS_` is this repository's environment prefix.
    expect(error.message).not.toMatch(/QCMS_[A-Z0-9_]+/);
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
  });

  it("covers every declared code, so a new code cannot be unreachable", () => {
    expect([...ERROR_SCENARIOS.map(([, code]) => code)].sort()).toEqual(
      [...ASSIST_ERROR_CODES].sort(),
    );
  });

  it("distinguishes step exhaustion from a model that simply did not answer", async () => {
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
    expect(usage.steps).toBe(3);
  });
});
