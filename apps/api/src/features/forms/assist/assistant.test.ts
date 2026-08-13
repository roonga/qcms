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
import type { AssistContext, AssistEvent, LibraryEntry } from "./types.js";

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
      "stp_agent_detail",
    ]);
    // The forward-only rule (ADR-16) the fake script builds.
    expect(proposal.proposal.proposedDraft.rules).toHaveLength(1);
    expect(proposal.proposal.issues).toEqual([]);
    expect(proposal.proposal.rationale).not.toBe("");

    // The advisory validation is the server's own, run before the proposal left.
    expect(validated.at(-1)?.steps.map((s) => s.stepId)).toEqual([
      "stp_agent_history",
      "stp_agent_detail",
    ]);

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
