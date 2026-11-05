import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REDACT_FRAGMENTS } from "@roonga/qcms-observability";

import { ACTION_KIND_NAMES, actionKind } from "./actions/registry.js";
import {
  SCREEN_IDS,
  SCREENS,
  isFormSubtreeScreen,
  isOperationalScreen,
  isScreenId,
  type ScreenId,
} from "./screens.js";
import {
  AGENT_READ_TOOL_NAMES,
  AGENT_TOOL_NAMES,
  TOOLS,
  ToolNotAllowedError,
  agentToolSet,
  createProposalState,
  runAgentTool,
  type AgentToolName,
} from "./tools/registry.js";
import type { AgentContext } from "./types.js";

function turnContext(tools: readonly AgentToolName[]): AgentContext {
  return {
    screen: "/forms",
    facts: {},
    defaults: { environment: "test" },
    conversation: [{ role: "user", content: "hi" }],
    maxSteps: 4,
    tools,
    authorize: () => Promise.resolve(),
  };
}

function jsonSchemaOf(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
}

function propertyNames(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) propertyNames(item, found);
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && value !== null && typeof value === "object") {
      for (const name of Object.keys(value as Record<string, unknown>)) found.add(name);
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

  it("names a registered screen as every action kind's own control", () => {
    for (const kind of ACTION_KIND_NAMES) {
      const mirror = actionKind(kind)?.screen;
      expect(mirror, kind).toBeDefined();
      expect(SCREEN_IDS, kind).toContain(mirror as ScreenId);
    }
  });

  it("counts the form subtree as the span of one conversation", () => {
    expect(SCREEN_IDS.filter(isFormSubtreeScreen)).toEqual([
      "/forms/[formId]",
      "/forms/[formId]/rules",
      "/forms/[formId]/preview",
      "/forms/[formId]/versions",
      "/forms/[formId]/versions/[version]",
      "/forms/[formId]/publish",
      "/operations/forms/[formId]/links",
      "/operations/forms/[formId]/webhooks",
      "/operations/forms/[formId]/responses",
      "/operations/forms/[formId]/responses/[sessionId]",
      "/operations/forms/[formId]/intake",
      "/operations/forms/[formId]/erase",
    ]);
    expect(isFormSubtreeScreen("/forms")).toBe(false);
  });

  it("partitions the action kinds into authoring and operational, which is what a plan may not mix", () => {
    const operational = ACTION_KIND_NAMES.filter((kind) =>
      isOperationalScreen(actionKind(kind)?.screen ?? ""),
    );
    expect(operational).toContain("link.mint");
    expect(operational).toContain("response.erase");
    expect(operational).toContain("webhook.retarget");
    expect(operational).not.toContain("form.publish");
    expect(operational).not.toContain("apply-draft");
    expect(operational).not.toContain("access.grant");
  });

  it("offers each workspace section only its own kinds, so no plan spans two sections", () => {
    expect(offerableActionKinds("/workspaces/[workspaceId]/members")).toEqual(["member.role"]);
    expect(offerableActionKinds("/workspaces/[workspaceId]/access-groups")).toEqual([
      "access.groupCreate",
      "access.groupRemove",
      "access.grant",
      "access.revoke",
    ]);
    expect(offerableActionKinds("/workspaces/[workspaceId]/settings")).toEqual([
      "workspace.settings",
    ]);
    expect(offerableActionKinds("/workspaces/[workspaceId]/audit")).toEqual([]);
    expect(offerableActionKinds("/workspaces/[workspaceId]/assistant-actions")).toEqual([]);
    expect(isScreenId("/workspaces/[workspaceId]")).toBe(false);
  });
});

describe("one door, by grant and registry", () => {
  it("offers the provider exactly the list the caller's grants reached", () => {
    const offered = Object.keys(
      agentToolSet(turnContext(["search_forms", "read_form"]), createProposalState()),
    );
    expect([...offered].sort()).toEqual(["read_form", "search_forms"]);
  });

  it("refuses every registered name outside this turn's list", async () => {
    const ctx = turnContext(["search_forms"]);
    for (const name of AGENT_TOOL_NAMES) {
      if (name === "search_forms") continue;
      await expect(
        runAgentTool(name, {}, ctx, createProposalState()),
        `must refuse ${name}`,
      ).rejects.toBeInstanceOf(ToolNotAllowedError);
    }
  });

  it("refuses a name outside the registry", async () => {
    await expect(
      runAgentTool("erase_session", {}, turnContext(AGENT_READ_TOOL_NAMES), createProposalState()),
    ).rejects.toBeInstanceOf(ToolNotAllowedError);
  });

  it("checks a tool's own cell before the tool runs", async () => {
    const refused: string[] = [];
    const ctx: AgentContext = {
      ...turnContext(["project_draft"]),
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

  // A reader holds no `form: write` in any workspace, so the draft verbs are refused
  // whichever screen the turn is on and whichever route carried it.
  it.each(["propose_draft", "propose_questions", "validate_draft"] as const)(
    "refuses %s for a caller who holds no form write",
    async (name) => {
      const asked: string[] = [];
      const ctx: AgentContext = {
        ...turnContext(["propose_draft", "propose_questions", "validate_draft"]),
        authorize: (cell) => {
          asked.push(`${cell.resource}:${cell.action}`);
          return Promise.reject(new Error("refused"));
        },
        validate: () => {
          throw new Error("the port must not be reached once the cell is refused");
        },
      };
      await expect(runAgentTool(name, {}, ctx, createProposalState())).rejects.toThrow("refused");
      expect(asked).toEqual(["form:write"]);
    },
  );

  it("declares a cell or the installation claim for every read tool", () => {
    for (const name of AGENT_READ_TOOL_NAMES) {
      const def = TOOLS[name];
      expect(def.cell !== undefined || def.claim === true, name).toBe(true);
    }
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
