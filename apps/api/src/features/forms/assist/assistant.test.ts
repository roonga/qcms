/**
 * The tool loop, driven by the deterministic fake provider (041).
 *
 * These run the production `streamText` loop end to end: the only substitution
 * is the language model itself, so the allowlist, the tool dispatch, the
 * stop-reason mapping and the event stream under test are the shipped ones.
 */

import { describe, expect, it } from "vitest";

import { parseFormDefinition, parseQuestionDefinition, type FormDefinition } from "@qcms/core";

import { createNullLogger } from "../../../logger.js";
import { aiSdkDraftAssistant } from "./assistant.js";
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
      return Promise.resolve([]);
    },
    maxSteps: 8,
    ...overrides,
  };
  return { ctx, validated };
}

async function collect(ctx: AssistContext): Promise<AssistEvent[]> {
  const assistant = aiSdkDraftAssistant({
    model: fakeAssistantModel(),
    providerId: "fake",
    logger: createNullLogger(),
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
    expect(proposal.proposal.rationale).not.toBe("");

    // The advisory validation is the server's own, run before the proposal left.
    expect(validated.at(-1)?.steps.map((s) => s.stepId)).toEqual(["stp_agent_history"]);

    // The library search actually ran: the proposal pins what search returned.
    expect(proposal.proposal.proposedDraft.steps[0]?.items[0]?.questionId).toBe(
      "q_at_fault_accident",
    );
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

  it("maps a provider failure to PROVIDER_ERROR", async () => {
    const { ctx } = contextFor("#qcms-fake:provider-error hello");
    const events = await collect(ctx);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "PROVIDER_ERROR" });
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
