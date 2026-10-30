/**
 * The allowlist here is a security control, not a prompt instruction: publishing,
 * erasure, link minting, webhook config and every read of response data are absent
 * from this module, so no prompt can reach them (ADR-25).
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
import type { AssistContext } from "../types.js";

/** Adding a name here is a security decision: the registry, tool set and guard all read it. */
export const ASSIST_TOOL_NAMES = [
  "search_question_library",
  "propose_questions",
  "propose_draft",
  "validate_draft",
] as const;

export type AssistToolName = (typeof ASSIST_TOOL_NAMES)[number];

const ALLOWED: ReadonlySet<string> = new Set<string>(ASSIST_TOOL_NAMES);

export function isAllowedToolName(name: string): name is AssistToolName {
  return ALLOWED.has(name);
}

export class ToolNotAllowedError extends Error {
  readonly tool: string;
  constructor(tool: string) {
    // Model-supplied text: recorded, never executed or re-dispatched.
    super(`Tool "${tool}" is not in the draft-assistant allowlist`);
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

/** An executor may only touch the {@link AssistContext} it is handed. */
interface AssistToolDef {
  readonly description: string;
  readonly inputSchema: z.ZodType;
  execute(input: unknown, ctx: AssistContext, state: ProposalState): Promise<unknown>;
}

async function searchLibrary(
  input: unknown,
  ctx: AssistContext,
): Promise<{ questions: unknown[] }> {
  const { query, limit } = SearchInput.parse(input);
  const entries = await ctx.questionLibrary.search(query, limit);
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
  ctx: AssistContext,
  state: ProposalState,
): Promise<Record<string, unknown>> {
  const { definition } = ProposeDraftInput.parse(input);
  // The turn is scoped to one form: a renamed formId is refused, never a cross-form write.
  if (definition.formId !== ctx.draft.formId) {
    return {
      accepted: false,
      reason: "formId must match the form being edited",
    };
  }
  state.proposedDraft = definition;
  const { issues, warnings } = await ctx.validate(definition);
  // `valid` turns on issues alone, since a warning describes a draft that would publish.
  return { accepted: true, valid: issues.length === 0, issues, warnings };
}

async function validateProposal(
  ctx: AssistContext,
  state: ProposalState,
): Promise<Record<string, unknown>> {
  const definition = state.proposedDraft ?? ctx.draft;
  const { issues, warnings } = await ctx.validate(definition);
  return { valid: issues.length === 0, issues, warnings };
}

/** Frozen so nothing can graft a verb on at runtime. */
const REGISTRY: Readonly<Record<AssistToolName, AssistToolDef>> = Object.freeze({
  search_question_library: {
    description:
      "Search the published question library. Returns question definitions only - never response data.",
    inputSchema: SearchInput,
    execute: (input, ctx) => searchLibrary(input, ctx),
  },
  propose_questions: {
    description:
      "Propose new question definitions. They are returned to the human for review and are not created or published by this call.",
    inputSchema: ProposeQuestionsInput,
    execute: (input, _ctx, state) => Promise.resolve(proposeQuestions(input, state)),
  },
  propose_draft: {
    description:
      "Propose the complete draft FormDefinition for this form. Returns the advisory validation issues that would block a publish, and the warnings that would not. Never publishes.",
    inputSchema: ProposeDraftInput,
    execute: (input, ctx, state) => proposeDraft(input, ctx, state),
  },
  validate_draft: {
    description:
      "Run the publish validation over the currently proposed draft and return its blocking issues and its non-blocking warnings.",
    inputSchema: ValidateInput,
    execute: (_input, ctx, state) => validateProposal(ctx, state),
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

/** The only door: a name outside the allowlist is refused before anything is dispatched. */
export async function runAssistTool(
  name: string,
  input: unknown,
  ctx: AssistContext,
  state: ProposalState,
): Promise<unknown> {
  if (!isAllowedToolName(name)) throw new ToolNotAllowedError(name);
  return REGISTRY[name].execute(input, ctx, state);
}

/** Each `execute` still routes back through the guard, deliberately. */
export function assistToolSet(ctx: AssistContext, state: ProposalState): ToolSet {
  const set: Record<string, unknown> = {};
  for (const name of ASSIST_TOOL_NAMES) {
    const def = REGISTRY[name];
    set[name] = tool({
      description: def.description,
      inputSchema: providerSchema(def.inputSchema),
      execute: (input: unknown) => runAssistTool(name, input, ctx, state),
    });
  }
  return set as ToolSet;
}

/** Exported for the tests only: the fake provider never reads a tool schema. */
export async function assistToolJsonSchemas(): Promise<Record<AssistToolName, JSONSchema7>> {
  const out: Partial<Record<AssistToolName, JSONSchema7>> = {};
  for (const name of ASSIST_TOOL_NAMES) {
    out[name] = await asSchema(providerSchema(REGISTRY[name].inputSchema)).jsonSchema;
  }
  return out as Record<AssistToolName, JSONSchema7>;
}
