import { describe, expect, it } from "vitest";

import { SCREENS, type ScreenId } from "../screens.js";
import { createProposalState, runAgentTool, TOOLS } from "./registry.js";
import type { AgentToolName } from "./registry.js";
import type { AgentContext } from "../types.js";

/**
 * D1 to D7's read tools, at the registry: each reaches its own screen's port and nothing
 * else. The grant half is the port's, asserted against a real database in
 * `assist.integration.test.ts`: a caller the screen would refuse is refused the tool.
 */

type PortName = Exclude<
  keyof AgentContext,
  | "screen"
  | "facts"
  | "conversation"
  | "maxSteps"
  | "tools"
  | "authorize"
  | "draft"
  | "questionLibrary"
  | "validate"
  | "projectDraft"
  | "propose"
  | "offeredActionKinds"
>;

/** One read tool, the screen that declares it, the port it reaches and a valid input. */
const READS: readonly {
  readonly tool: AgentToolName;
  readonly screen: ScreenId;
  readonly port: PortName;
  readonly input: unknown;
  readonly result: unknown;
}[] = [
  {
    tool: "test_rule",
    screen: "/forms/[formId]/rules",
    port: "testRule",
    input: { ruleId: "rul_a", answers: {} },
    result: {
      ruleId: "rul_a",
      outcome: "match",
      reason: null,
      references: ["q_a"],
      targetGroupId: null,
      instanceOutcomes: null,
    },
  },
  {
    tool: "diff_form_versions",
    screen: "/forms/[formId]/versions",
    port: "diffFormVersions",
    input: { from: 1, to: null },
    result: {
      from: "1",
      to: "draft",
      fromFound: true,
      toFound: true,
      identical: false,
      stepsAdded: ["stp_b"],
      stepsRemoved: [],
      questionsAdded: ["q_b"],
      questionsRemoved: [],
      questionsRepinned: [{ questionId: "q_a", from: 1, to: 2 }],
      ruleCountFrom: 0,
      ruleCountTo: 1,
    },
  },
  {
    tool: "count_links",
    screen: "/forms/[formId]/links",
    port: "countLinks",
    input: {},
    result: { environment: "test", active: 2, consumed: 1, revoked: 0, expired: 3, total: 6 },
  },
  {
    tool: "list_responses",
    screen: "/forms/[formId]/responses",
    port: "listResponses",
    input: { limit: 5, flagged: true },
    result: {
      total: 1,
      responses: [
        {
          sessionId: "ses_a",
          formVersion: 3,
          startedAt: "2026-07-20T00:00:00.000Z",
          submittedAt: null,
          accessMode: "anonymous",
          flagged: true,
          flaggedReason: "late",
        },
      ],
    },
  },
  {
    tool: "count_responses",
    screen: "/forms/[formId]/responses",
    port: "countResponses",
    input: { version: 3 },
    result: { total: 12 },
  },
  {
    tool: "delivery_status",
    screen: "/forms/[formId]/webhooks",
    port: "deliveryStatus",
    input: {},
    result: {
      scanned: 4,
      truncated: false,
      delivered: 2,
      pending: 1,
      dead: 1,
      cancelled: 0,
      endpoints: [{ webhookId: "whk_a", url: "https://example.test/hook", active: true }],
    },
  },
  {
    tool: "count_dead_letters",
    screen: "/webhooks",
    port: "countDeadLetters",
    input: {},
    result: {
      scanned: 2,
      truncated: false,
      total: 2,
      byForm: [{ formId: "frm_quote", count: 2 }],
    },
  },
  {
    tool: "diff_question_versions",
    screen: "/questions/[questionId]",
    port: "diffQuestionVersions",
    input: { from: 1, to: 2 },
    result: {
      questionId: "q_a",
      from: 1,
      to: 2,
      fromFound: true,
      toFound: true,
      identical: false,
      statusFrom: "published",
      statusTo: "draft",
      typeFrom: "shortText",
      typeTo: "shortText",
      changedFields: ["constraints"],
    },
  },
  {
    tool: "search_forms",
    screen: "/forms",
    port: "searchForms",
    input: { limit: 5 },
    result: {
      environment: "test",
      matched: 1,
      forms: [
        {
          formId: "frm_quote",
          slug: "quote",
          title: "Quote",
          latestVersion: 3,
          releasedVersion: 2,
          closed: false,
        },
      ],
    },
  },
];

function contextFor(
  screen: ScreenId,
  ports: Partial<AgentContext> = {},
): { ctx: AgentContext; seen: unknown[] } {
  const seen: unknown[] = [];
  const ctx: AgentContext = {
    screen,
    facts: {},
    conversation: [],
    maxSteps: 4,
    tools: SCREENS[screen].readTools,
    authorize: () => Promise.resolve(),
    ...ports,
  };
  return { ctx, seen };
}

describe("the read tools of D1 to D7", () => {
  it.each(READS.map((read) => [read.tool, read] as const))(
    "%s is declared on its own screen and reaches that screen's port",
    async (_name, read) => {
      expect(SCREENS[read.screen].readTools).toContain(read.tool);
      const inputs: unknown[] = [];
      const { ctx } = contextFor(read.screen, {
        [read.port]: (input: unknown) => {
          inputs.push(input);
          return Promise.resolve(read.result);
        },
      } as Partial<AgentContext>);
      const output = await runAgentTool(read.tool, read.input, ctx, createProposalState());
      // The port is handed the parsed input, and the model is handed what the port said.
      expect(inputs).toHaveLength(1);
      expect(TOOLS[read.tool].outputSchema.parse(output)).toEqual(read.result);
    },
  );

  it.each(READS.map((read) => [read.tool, read] as const))(
    "%s fails rather than reading anything else when its port is absent",
    async (_name, read) => {
      const { ctx } = contextFor(read.screen);
      await expect(
        runAgentTool(read.tool, read.input, ctx, createProposalState()),
      ).rejects.toThrow(/has no port/);
    },
  );

  it("takes no answer-shaped filter: the response reads carry the screen's own four", () => {
    const members = Object.keys(
      (TOOLS.list_responses.inputSchema as unknown as { shape: Record<string, unknown> }).shape,
    ).sort();
    expect(members).toEqual(["flagged", "from", "limit", "to", "version"]);
  });

  it("refuses an input member no screen filter names", () => {
    expect(TOOLS.count_responses.inputSchema.safeParse({ sessionId: "ses_a" }).success).toBe(true);
    // Unknown members are dropped rather than honoured, so no filter can be smuggled in.
    expect(
      TOOLS.count_responses.inputSchema.parse({ sessionId: "ses_a" }),
    ).not.toHaveProperty("sessionId");
  });
});
