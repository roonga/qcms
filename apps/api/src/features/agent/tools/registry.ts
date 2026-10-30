/**
 * One frozen registry and one door. A turn's tool set is the intersection of this
 * registry and the current screen's declared list, and {@link runAgentTool} refuses every
 * other name before anything is dispatched (SEC-17, ADR-25).
 *
 * Each read tool declares the SEC-3 cell it needs, and the door checks that cell for the
 * calling principal through the same policy evaluator the route middleware uses.
 */

import { asSchema, jsonSchema, tool, type JSONSchema7, type Schema, type ToolSet } from "ai";
import { z } from "zod";

import {
  FormDefinition as FormDefinitionSchema,
  QuestionDefinition as QuestionDefinitionSchema,
  type FormDefinition,
  type QuestionDefinition,
  type QuestionId,
} from "@roonga/qcms-core";

import { selfContainedToolSchema } from "./tool-schema.js";
import type { AgentContext, ToolCell } from "../types.js";

/** Adding a name here is a security decision: the registry, tool set and door all read it. */
export const AGENT_TOOL_NAMES = [
  "search_question_library",
  "propose_questions",
  "propose_draft",
  "validate_draft",
  "project_draft",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const REGISTERED: ReadonlySet<string> = new Set<string>(AGENT_TOOL_NAMES);

export function isAgentToolName(name: string): name is AgentToolName {
  return REGISTERED.has(name);
}

export class ToolNotAllowedError extends Error {
  readonly tool: string;
  constructor(tool: string) {
    // Model-supplied text: recorded, never executed or re-dispatched.
    super(`Tool "${tool}" is not available on this screen`);
    this.name = "ToolNotAllowedError";
    this.tool = tool;
  }
}

/** Mutable by design: the tool loop accumulates across steps and is read once it ends. */
export interface ProposalState {
  proposedDraft: FormDefinition | undefined;
  readonly newQuestions: QuestionDefinition[];
}

export function createProposalState(): ProposalState {
  return { proposedDraft: undefined, newQuestions: [] };
}

const SearchInput = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe("Case-insensitive substring matched against the question slug and id."),
  limit: z.number().int().min(1).max(50).default(10),
});

const ProposeQuestionsInput = z.object({
  questions: z
    .array(QuestionDefinitionSchema)
    .min(1)
    .max(50)
    .describe("New question definitions to add to the library. Not published by this call."),
});

const ProposeDraftInput = z.object({
  definition: FormDefinitionSchema.describe(
    "The complete proposed draft FormDefinition, replacing the current draft wholesale.",
  ),
});

const ValidateInput = z.object({});

const ProjectDraftInput = z.object({
  answers: z
    .record(z.string(), z.unknown())
    .default({})
    .describe(
      "Hypothetical answers to project the draft against, keyed by question id. These are " +
        "the model's own hypotheses; no submitted answer is ever read.",
    ),
});

/**
 * What each tool may return. The shapes are enumerated so "no answer value" is a property
 * of the schema; the vocabulary test walks every one of them.
 */
const Outputs = {
  search_question_library: z.strictObject({
    questions: z.array(
      z.strictObject({
        questionId: z.string(),
        slug: z.string(),
        version: z.number().int(),
        // Opaque on purpose: a question definition is author content, validated by the kernel.
        definition: z.unknown(),
      }),
    ),
  }),
  propose_questions: z.strictObject({
    accepted: z.number().int(),
    questionIds: z.array(z.string()),
  }),
  propose_draft: z.strictObject({
    accepted: z.boolean(),
    reason: z.string().optional(),
    valid: z.boolean().optional(),
    issues: z.array(z.unknown()).optional(),
    warnings: z.array(z.unknown()).optional(),
  }),
  validate_draft: z.strictObject({
    valid: z.boolean(),
    issues: z.array(z.unknown()),
    warnings: z.array(z.unknown()),
  }),
  project_draft: z.strictObject({
    visibleSteps: z.array(z.string()),
    visibleQuestions: z.array(z.string()),
    complete: z.boolean(),
  }),
} as const satisfies Record<AgentToolName, z.ZodType>;

/** An executor may only touch the {@link AgentContext} it is handed. */
interface AgentToolDef {
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  /** The cell the door checks for the calling principal before the tool runs. */
  readonly cell?: ToolCell;
  execute(input: unknown, ctx: AgentContext, state: ProposalState): Promise<unknown>;
}

/** A tool reached without its port is a registry that disagrees with a screen's list. */
function port<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Tool "${name}" has no port on the ${name} screen's context`);
  }
  return value;
}

async function searchLibrary(
  input: unknown,
  ctx: AgentContext,
): Promise<{ questions: unknown[] }> {
  const { query, limit } = SearchInput.parse(input);
  const entries = await port(ctx.questionLibrary, "search_question_library").search(query, limit);
  return {
    questions: entries.map((entry) => ({
      questionId: entry.questionId,
      slug: entry.slug,
      version: entry.version,
      definition: entry.definition,
    })),
  };
}

function proposeQuestions(
  input: unknown,
  state: ProposalState,
): { accepted: number; questionIds: QuestionId[] } {
  const { questions } = ProposeQuestionsInput.parse(input);
  for (const question of questions) {
    const existing = state.newQuestions.findIndex((q) => q.questionId === question.questionId);
    if (existing >= 0) state.newQuestions.splice(existing, 1);
    state.newQuestions.push(question);
  }
  return {
    accepted: questions.length,
    questionIds: state.newQuestions.map((q) => q.questionId),
  };
}

async function proposeDraft(
  input: unknown,
  ctx: AgentContext,
  state: ProposalState,
): Promise<Record<string, unknown>> {
  const { definition } = ProposeDraftInput.parse(input);
  // The turn is scoped to one form: a renamed formId is refused, never a cross-form write.
  if (definition.formId !== port(ctx.draft, "propose_draft").formId) {
    return {
      accepted: false,
      reason: "formId must match the form being edited",
    };
  }
  state.proposedDraft = definition;
  const { issues, warnings } = await port(ctx.validate, "propose_draft")(definition);
  // `valid` turns on issues alone, since a warning describes a draft that would publish.
  return { accepted: true, valid: issues.length === 0, issues, warnings };
}

async function validateProposal(
  ctx: AgentContext,
  state: ProposalState,
): Promise<Record<string, unknown>> {
  const definition = state.proposedDraft ?? port(ctx.draft, "validate_draft");
  const { issues, warnings } = await port(ctx.validate, "validate_draft")(definition);
  return { valid: issues.length === 0, issues, warnings };
}

async function projectDraft(input: unknown, ctx: AgentContext): Promise<Record<string, unknown>> {
  const { answers } = ProjectDraftInput.parse(input);
  const projection = await port(ctx.projectDraft, "project_draft")(answers);
  return {
    visibleSteps: [...projection.visibleSteps],
    visibleQuestions: [...projection.visibleQuestions],
    complete: projection.complete,
  };
}

/** Frozen so nothing can graft a verb on at runtime. */
export const TOOLS: Readonly<Record<AgentToolName, AgentToolDef>> = Object.freeze({
  search_question_library: {
    description:
      "Search the published question library. Returns question definitions only - never response data.",
    inputSchema: SearchInput,
    outputSchema: Outputs.search_question_library,
    cell: { resource: "question", action: "read" },
    execute: (input, ctx) => searchLibrary(input, ctx),
  },
  propose_questions: {
    description:
      "Propose new question definitions. They are returned to the human for review and are not created or published by this call.",
    inputSchema: ProposeQuestionsInput,
    outputSchema: Outputs.propose_questions,
    execute: (input, _ctx, state) => Promise.resolve(proposeQuestions(input, state)),
  },
  propose_draft: {
    description:
      "Propose the complete draft FormDefinition for this form. Returns the advisory validation issues that would block a publish, and the warnings that would not. Never publishes.",
    inputSchema: ProposeDraftInput,
    outputSchema: Outputs.propose_draft,
    execute: (input, ctx, state) => proposeDraft(input, ctx, state),
  },
  validate_draft: {
    description:
      "Run the publish validation over the currently proposed draft and return its blocking issues and its non-blocking warnings.",
    inputSchema: ValidateInput,
    outputSchema: Outputs.validate_draft,
    execute: (_input, ctx, state) => validateProposal(ctx, state),
  },
  project_draft: {
    description:
      "Project the draft for hypothetical answers and return which steps and questions a respondent would see. Reads no submitted answer.",
    inputSchema: ProjectDraftInput,
    outputSchema: Outputs.project_draft,
    cell: { resource: "form", action: "preview" },
    execute: (input, ctx) => projectDraft(input, ctx),
  },
});

/**
 * The advertised document is bounded (see `tool-schema.ts`) while Zod stays the
 * authority: `validate` runs the untouched schema over whatever the model sends.
 */
function providerSchema(zodType: z.ZodType): Schema<unknown> {
  return jsonSchema<unknown>(
    // A thunk, so a deployment that never runs a turn never converts a schema.
    async (): Promise<JSONSchema7> => selfContainedToolSchema(await asSchema(zodType).jsonSchema),
    {
      validate: (value: unknown) => {
        const result = zodType.safeParse(value);
        return result.success
          ? { success: true as const, value: result.data }
          : { success: false as const, error: result.error };
      },
    },
  );
}

/**
 * The only door. A name outside the registry, or outside **this screen's** list, is
 * refused before anything is dispatched, and a tool that declares a cell runs only once
 * the calling principal is shown to hold it.
 */
export async function runAgentTool(
  name: string,
  input: unknown,
  ctx: AgentContext,
  state: ProposalState,
): Promise<unknown> {
  if (!isAgentToolName(name)) throw new ToolNotAllowedError(name);
  if (!ctx.tools.includes(name)) throw new ToolNotAllowedError(name);
  const def = TOOLS[name];
  if (def.cell !== undefined) await ctx.authorize(def.cell);
  return def.execute(input, ctx, state);
}

/** The provider tool set is built from the same list the door refuses against. */
export function agentToolSet(ctx: AgentContext, state: ProposalState): ToolSet {
  const set: Record<string, unknown> = {};
  for (const name of AGENT_TOOL_NAMES) {
    if (!ctx.tools.includes(name)) continue;
    const def = TOOLS[name];
    set[name] = tool({
      description: def.description,
      inputSchema: providerSchema(def.inputSchema),
      execute: (input: unknown) => runAgentTool(name, input, ctx, state),
    });
  }
  return set as ToolSet;
}

/** Exported for the tests only: the fake provider never reads a tool schema. */
export async function agentToolJsonSchemas(): Promise<Record<AgentToolName, JSONSchema7>> {
  const out: Partial<Record<AgentToolName, JSONSchema7>> = {};
  for (const name of AGENT_TOOL_NAMES) {
    out[name] = await asSchema(providerSchema(TOOLS[name].inputSchema)).jsonSchema;
  }
  return out as Record<AgentToolName, JSONSchema7>;
}
