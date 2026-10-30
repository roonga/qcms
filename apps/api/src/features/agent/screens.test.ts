import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REDACT_FRAGMENTS } from "@roonga/qcms-observability";

import { SCREEN_IDS, SCREENS, isFormSubtreeScreen, isScreenId, type ScreenId } from "./screens.js";
import {
  AGENT_TOOL_NAMES,
  TOOLS,
  ToolNotAllowedError,
  agentToolSet,
  createProposalState,
  runAgentTool,
  type AgentToolName,
} from "./tools/registry.js";
import type { AgentContext } from "./types.js";

/**
 * What the registry promises, checked rather than claimed: one row per screen, one door
 * per screen, and no field in any schema that could carry respondent content (SEC-17).
 */

function turnContext(screen: ScreenId): AgentContext {
  return {
    screen,
    facts: {},
    conversation: [{ role: "user", content: "hi" }],
    maxSteps: 4,
    tools: SCREENS[screen].readTools,
    authorize: () => Promise.resolve(),
  };
}

function jsonSchemaOf(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
}

/** Every property name in a JSON Schema document, however deeply nested. */
function propertyNames(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) propertyNames(item, found);
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && value !== null && typeof value === "object") {
      for (const name of Object.keys(value)) found.add(name);
    }
    propertyNames(value, found);
  }
  return found;
}

/**
 * The redactor's vocabulary, minus the staff-identity fragments. A workspace member's
 * name and email are staff data and may reach the provider (Q11); an answer value, and
 * every secret-like fragment, may not.
 */
const STAFF_IDENTITY = ["email", "firstname", "lastname", "fullname", "displayname"];
const RESPONDENT_AND_SECRET_VOCABULARY = REDACT_FRAGMENTS.filter(
  (fragment) => !STAFF_IDENTITY.includes(fragment),
);

function offendingFragment(name: string): string | undefined {
  const lower = name.toLowerCase();
  return RESPONDENT_AND_SECRET_VOCABULARY.find((fragment) => lower.includes(fragment));
}

describe("the screen registry", () => {
  it("has a row for every screen id and nothing else, and is frozen", () => {
    expect(Object.keys(SCREENS).sort()).toEqual([...SCREEN_IDS].sort());
    expect(Object.isFrozen(SCREENS)).toBe(true);
  });

  it("recognises its own ids and refuses an id it does not hold", () => {
    for (const id of SCREEN_IDS) expect(isScreenId(id)).toBe(true);
    expect(isScreenId("/forms/[formId]/export")).toBe(false);
    expect(isScreenId("/sign-in")).toBe(false);
  });

  it("offers no action kind anywhere: proposing actions arrives with its own task", () => {
    for (const id of SCREEN_IDS) expect(SCREENS[id].actionKinds).toEqual([]);
  });

  it("declares only registered tools, and declares them only where their port exists", () => {
    for (const id of SCREEN_IDS) {
      for (const name of SCREENS[id].readTools) {
        expect(AGENT_TOOL_NAMES).toContain(name);
      }
    }
    // The draft verbs belong to the builder, and the projection to the preview screen.
    expect(SCREENS["/forms/[formId]"].readTools).toEqual([
      "search_question_library",
      "propose_questions",
      "propose_draft",
      "validate_draft",
    ]);
    expect(SCREENS["/forms/[formId]/preview"].readTools).toEqual(["project_draft"]);
  });

  it("counts the form subtree as the span of one conversation", () => {
    expect(SCREEN_IDS.filter(isFormSubtreeScreen)).toEqual([
      "/forms/[formId]",
      "/forms/[formId]/rules",
      "/forms/[formId]/preview",
      "/forms/[formId]/versions",
      "/forms/[formId]/versions/[version]",
      "/forms/[formId]/releases",
      "/forms/[formId]/links",
      "/forms/[formId]/webhooks",
      "/forms/[formId]/responses",
      "/forms/[formId]/responses/[sessionId]",
    ]);
    expect(isFormSubtreeScreen("/forms")).toBe(false);
  });
});

describe("one door per screen", () => {
  it("offers the provider exactly the screen's declared list", () => {
    for (const id of SCREEN_IDS) {
      const offered = Object.keys(agentToolSet(turnContext(id), createProposalState()));
      expect(offered.sort(), id).toEqual([...SCREENS[id].readTools].sort());
    }
  });

  it("refuses every registered name the current screen does not declare", async () => {
    for (const id of SCREEN_IDS) {
      const declared: readonly AgentToolName[] = SCREENS[id].readTools;
      for (const name of AGENT_TOOL_NAMES) {
        if (declared.includes(name)) continue;
        await expect(
          runAgentTool(name, {}, turnContext(id), createProposalState()),
          `${id} must refuse ${name}`,
        ).rejects.toBeInstanceOf(ToolNotAllowedError);
      }
    }
  });

  it("refuses a name outside the registry on every screen", async () => {
    for (const id of SCREEN_IDS) {
      await expect(
        runAgentTool("erase_session", {}, turnContext(id), createProposalState()),
      ).rejects.toBeInstanceOf(ToolNotAllowedError);
    }
  });

  it("checks a tool's own cell before the tool runs", async () => {
    const refused: string[] = [];
    const ctx: AgentContext = {
      ...turnContext("/forms/[formId]/preview"),
      authorize: (cell) => {
        refused.push(`${cell.resource}:${cell.action}`);
        return Promise.reject(new Error("refused"));
      },
      projectDraft: () => {
        throw new Error("the port must not be reached once the cell is refused");
      },
    };
    await expect(
      runAgentTool("project_draft", { answers: {} }, ctx, createProposalState()),
    ).rejects.toThrow("refused");
    expect(refused).toEqual(["form:preview"]);
  });
});

describe("no answer value can be described by any schema", () => {
  const schemas: readonly { readonly name: string; readonly schema: z.ZodType }[] = [
    ...SCREEN_IDS.map((id) => ({ name: `facts ${id}`, schema: SCREENS[id].facts })),
    ...AGENT_TOOL_NAMES.map((name) => ({
      name: `output ${name}`,
      schema: TOOLS[name].outputSchema,
    })),
  ];

  it("walks every facts schema and every tool output schema", () => {
    // A guard on the guard: a registry that lost its rows would pass vacuously.
    expect(schemas.length).toBe(SCREEN_IDS.length + AGENT_TOOL_NAMES.length);
  });

  it("names no field from the respondent-content or secret vocabulary", () => {
    for (const { name, schema } of schemas) {
      for (const field of propertyNames(jsonSchemaOf(schema))) {
        expect(offendingFragment(field), `${name} names ${field}`).toBeUndefined();
      }
    }
  });

  it("closes every facts schema, so a builder cannot add a field without declaring it", () => {
    for (const id of SCREEN_IDS) {
      const document = jsonSchemaOf(SCREENS[id].facts) as {
        readonly additionalProperties?: unknown;
      };
      expect(document.additionalProperties, id).toBe(false);
    }
  });

  it("keeps the staff fragments the rule allows available, so the filter is not vacuous", () => {
    expect(offendingFragment("email")).toBeUndefined();
    expect(offendingFragment("answers")).toBe("answer");
    expect(offendingFragment("answerValue")).toBe("answer");
    expect(offendingFragment("secretEncrypted")).toBe("secret");
  });
});
