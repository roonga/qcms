/**
 * The tool allowlist as a security control (041, exit criterion 4).
 *
 * Two things are asserted here, and neither depends on the model behaving:
 * the surface refuses every forbidden verb structurally, and the context a tool
 * runs against has no capability that could reach respondent data.
 */

import { describe, expect, it } from "vitest";

import { parseFormDefinition, type FormDefinition } from "@roonga/qcms-core";

import { createNullLogger } from "../../../logger.js";
import { recordingLogger, validEnv } from "../../../test-support.js";
import { loadConfig } from "../../../config.js";
import { aiSdkDraftAssistant, selectDraftAssistant } from "./assistant.js";
import { fakeAssistantModel } from "./fake-model.js";
import { collectRefs } from "./tool-schema.js";
import {
  ASSIST_TOOL_NAMES,
  assistToolJsonSchemas,
  assistToolSet,
  createProposalState,
  isAllowedToolName,
  runAssistTool,
  ToolNotAllowedError,
} from "./tools.js";
import type { AssistContext, AssistEvent } from "./types.js";

/** Exactly the verbs 041 says the agent must never have. */
const FORBIDDEN = [
  "publish_form",
  "erase_session",
  "mint_link",
  "configure_webhook",
  "read_responses",
  "list_submissions",
  "export_responses",
  "delete_form",
] as const;

function draftFixture(): FormDefinition {
  const parsed = parseFormDefinition({
    formId: "frm_quote",
    defaultLocale: "en",
    title: { en: "Quote" },
    steps: [{ stepId: "stp_a", title: { en: "A" }, items: [{ questionId: "q_a", version: 1 }] }],
    rules: [],
  });
  if (!parsed.ok) throw new Error("fixture draft invalid");
  return parsed.value;
}

function contextFixture(message: string): AssistContext {
  return {
    draft: draftFixture(),
    questionLibrary: { search: () => Promise.resolve([]) },
    conversation: [{ role: "user", content: message }],
    validate: () => Promise.resolve({ issues: [], warnings: [] }),
    maxSteps: 8,
  };
}

describe("the assist tool allowlist", () => {
  it("is exactly the four authoring verbs", () => {
    expect([...ASSIST_TOOL_NAMES].sort()).toEqual([
      "propose_draft",
      "propose_questions",
      "search_question_library",
      "validate_draft",
    ]);
  });

  it("offers the provider nothing beyond the allowlist", () => {
    const offered = Object.keys(assistToolSet(contextFixture("hi"), createProposalState()));
    expect([...offered].sort()).toEqual([...ASSIST_TOOL_NAMES].sort());
    for (const forbidden of FORBIDDEN) {
      expect(offered).not.toContain(forbidden);
    }
  });

  it("refuses every forbidden verb at the single dispatch door", async () => {
    const ctx = contextFixture("hi");
    const state = createProposalState();
    for (const forbidden of FORBIDDEN) {
      // The fixture is real: these are the names an attacker would reach for,
      // and none of them is allowlisted.
      expect(isAllowedToolName(forbidden)).toBe(false);
      await expect(runAssistTool(forbidden, {}, ctx, state)).rejects.toBeInstanceOf(
        ToolNotAllowedError,
      );
    }
  });

  it("still dispatches an allowlisted verb (so the refusal above is not vacuous)", async () => {
    const ctx = contextFixture("hi");
    const state = createProposalState();
    await expect(runAssistTool("validate_draft", {}, ctx, state)).resolves.toMatchObject({
      valid: true,
    });
  });

  /**
   * `valid` is about publishability and warnings do not decide it (issue #123),
   * but the model is still shown them.
   *
   * Both halves matter and they pull in opposite directions, which is why they are
   * asserted together: a `valid: false` here would make the assistant treat a
   * publishable draft as broken, and a missing `warnings` key would leave it
   * unable to act on something the author is about to be shown.
   */
  it("hands the model the warnings without letting them decide publishability", async () => {
    const warning = {
      code: "PATTERN_CLASS_SET_AMBIGUOUS" as const,
      message: "This pattern's character class is ambiguous.",
      path: { question: "q_a" as never },
    };
    const ctx: AssistContext = {
      ...contextFixture("hi"),
      validate: () => Promise.resolve({ issues: [], warnings: [warning] }),
    };
    const state = createProposalState();
    await expect(runAssistTool("validate_draft", {}, ctx, state)).resolves.toEqual({
      valid: true,
      issues: [],
      warnings: [warning],
    });
  });
});

describe("a scripted rogue model", () => {
  async function runRogue(
    script: string,
  ): Promise<{ events: AssistEvent[]; lines: Record<string, unknown>[] }> {
    const { logger, lines } = recordingLogger();
    const assistant = aiSdkDraftAssistant({
      model: fakeAssistantModel(),
      providerId: "fake",
      logger,
    });
    const events: AssistEvent[] = [];
    for await (const event of assistant.assist(
      contextFixture(`#qcms-fake:${script} do it`),
      new AbortController().signal,
    )) {
      events.push(event);
    }
    return { events, lines };
  }

  it.each([
    ["rogue-publish", "publish_form"],
    ["rogue-erase", "erase_session"],
    ["rogue-webhook", "configure_webhook"],
    ["rogue-responses", "read_responses"],
  ])("is refused when it attempts %s", async (script, tool) => {
    const { events, lines } = await runRogue(script);

    // Refused, named, and logged.
    expect(events.find((e) => e.type === "tool-rejected")).toEqual({
      type: "tool-rejected",
      tool,
    });
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "REFUSED" });
    const logged = JSON.stringify(lines);
    expect(logged).toContain("draft assistant tool call rejected");
    expect(logged).toContain(tool);

    // And it gets nothing: a turn that reached for a forbidden verb produces no
    // proposal at all, so no part of its work reaches the author.
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
  });
});

describe("the assist context", () => {
  it("carries no capability that could reach respondent data", () => {
    const ctx = contextFixture("hi");
    // The PII boundary is this shape. A database handle, a session reader or an
    // answer reader appearing here would be the boundary breaking, and this
    // assertion is what would notice.
    expect(Object.keys(ctx).sort()).toEqual([
      "conversation",
      "draft",
      "maxSteps",
      "questionLibrary",
      "validate",
    ]);
    expect(Object.keys(ctx.questionLibrary)).toEqual(["search"]);
  });

  it("never lets a tool result carry an answer value", async () => {
    // The library port is the only read the tool surface has, and it returns
    // definitions. Even a library that tried to smuggle a field cannot: the
    // entries the tool emits are projected field by field.
    const ctx: AssistContext = {
      ...contextFixture("hi"),
      questionLibrary: {
        search: () =>
          Promise.resolve([
            {
              questionId: "q_a" as never,
              slug: "a",
              version: 1,
              definition: { questionId: "q_a", type: "boolean", label: { en: "A" } } as never,
              // A hostile library row. It must not survive the projection.
              answerValue: "SECRET-ANSWER-VALUE",
            } as never,
          ]),
      },
    };
    const result = await runAssistTool(
      "search_question_library",
      { limit: 5 },
      ctx,
      createProposalState(),
    );
    expect(JSON.stringify(result)).not.toContain("SECRET-ANSWER-VALUE");
  });
});

describe("the configured selector", () => {
  it("returns an inert assistant that says so when the flag is none", async () => {
    const config = loadConfig(validEnv());
    expect(config.agent.provider).toBe("none");
    const events: AssistEvent[] = [];
    for await (const event of selectDraftAssistant(config, createNullLogger()).assist(
      contextFixture("hi"),
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: "error",
        code: "PROVIDER_ERROR",
        message: "Agent-assisted authoring is not enabled on this deployment.",
      },
    ]);
  });

  it("returns a working assistant when the flag names the fake provider", async () => {
    const config = loadConfig(validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }));
    const events: AssistEvent[] = [];
    for await (const event of selectDraftAssistant(config, createNullLogger()).assist(
      contextFixture("build me something"),
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "usage")).toBe(true);
  });
});

/**
 * The schema the provider actually receives (issue #820).
 *
 * This is the blind spot the 041 gates had, described precisely so it is not
 * reopened: **the fake provider never reads a tool schema.** `MockLanguageModelV3`
 * is handed the tool set and ignores it, so no test in the suite ever converted
 * one, and `propose_draft` shipped a document that every strict engine rejects
 * while every gate stayed green. The first real provider call died in 1.0s with
 * HTTP 400, before inference.
 *
 * Three properties, and the order matters because the middle one is the one the
 * issue's own suggested pin would have missed.
 */
describe("every emitted tool schema is one a provider can convert", () => {
  it("names every tool in the allowlist and nothing else", async () => {
    const schemas = await assistToolJsonSchemas();
    expect(Object.keys(schemas).sort()).toEqual([...ASSIST_TOOL_NAMES].sort());
  });

  it("resolves every $ref inside the document it ships", async () => {
    // The dangling half of the defect: the conversion hoisted the recursive
    // `Condition` into a block, and a reader that did not carry the block with
    // the schema was left holding a pointer to nothing.
    const schemas = await assistToolJsonSchemas();
    for (const [name, schema] of Object.entries(schemas)) {
      for (const { ref, resolves } of collectRefs(schema)) {
        expect(resolves, `${name} ships a $ref to ${ref} that resolves to nothing`).toBe(true);
      }
    }
  });

  it("uses the $defs spelling, never draft-07 definitions", async () => {
    // This is what actually broke. LM Studio's schema-to-grammar conversion
    // reads `$defs`; the Zod conversion writes `definitions`; the block was
    // dropped as an unknown keyword and the $ref then resolved to nothing -
    // "Error resolving ref #/definitions/__schema0: definitions not in {...}".
    // A resolve check alone passes on that document, because within the JSON
    // the block IS there. Only the spelling assertion catches it.
    const schemas = await assistToolJsonSchemas();
    for (const [name, schema] of Object.entries(schemas)) {
      expect(JSON.stringify(schema), `${name} emits a draft-07 definitions block`).not.toContain(
        '"definitions"',
      );
    }
  });

  it("ships no reference cycle", async () => {
    // The second half, and the reason a rename would not have been enough: a
    // recursive $ref is unconvertible for providers that resolve by inlining.
    // The AI SDK's Google provider refuses one outright and falls back to
    // handing the vendor the raw document instead of its native parameters.
    const schemas = await assistToolJsonSchemas();
    for (const [name, schema] of Object.entries(schemas)) {
      const defs = (schema.$defs ?? {}) as Record<string, unknown>;
      const edges = new Map<string, string[]>();
      for (const [entry, body] of Object.entries(defs)) {
        edges.set(
          entry,
          collectRefs(body as Parameters<typeof collectRefs>[0]).map((r) =>
            r.ref.slice(r.ref.lastIndexOf("/") + 1),
          ),
        );
      }
      const state = new Map<string, "open" | "done">();
      const visit = (node: string, trail: string[]): void => {
        if (state.get(node) === "done") return;
        expect(
          state.get(node),
          `${name}: reference cycle ${[...trail, node].join(" -> ")}`,
        ).not.toBe("open");
        state.set(node, "open");
        for (const next of edges.get(node) ?? []) visit(next, [...trail, node]);
        state.set(node, "done");
      };
      for (const entry of edges.keys()) visit(entry, []);
    }
  });

  it("still validates against the kernel's own schema, not the bounded one", () => {
    // The property that makes a bounded advertisement safe: the tool set's
    // `validate` is the untouched Zod schema, so a draft the bounded document
    // does not describe is still accepted, and one the kernel rejects is still
    // rejected. Asserted through the real tool set rather than in prose.
    const set = assistToolSet(contextFixture("x"), createProposalState());
    const schema = (set.propose_draft as { inputSchema: { validate?: unknown } }).inputSchema;
    expect(typeof schema.validate).toBe("function");
    const validate = schema.validate as (v: unknown) => { success: boolean };
    expect(validate({ definition: { formId: "not a form" } }).success).toBe(false);
    expect(validate({ definition: draftFixture() }).success).toBe(true);
  });
});
