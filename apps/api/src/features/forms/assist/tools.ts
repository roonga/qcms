/**
 * The agent's tool surface (041) - and the allowlist that is a security control,
 * not a prompt instruction.
 *
 * Four tools exist and no fifth can be reached: search the published question
 * library, propose new question definitions, propose the draft `FormDefinition`,
 * run advisory validation. Publishing, erasure, link minting, webhook
 * configuration and *every* read of response data are absent from this module,
 * so an agent cannot call them however it is prompted, jailbroken or swapped.
 *
 * Two structural properties hold here, and both are tested:
 *
 * 1. **One door.** {@link runAssistTool} is the only way a tool executes, and it
 *    rejects any name outside {@link ASSIST_TOOL_NAMES} before dispatch. The
 *    tool set handed to the provider is built from the same registry, so the
 *    upstream model is never even told the other verbs exist.
 * 2. **No respondent data.** Every tool's inputs and outputs are drawn from
 *    {@link AssistContext}, which carries no database handle and no session or
 *    answer reader (see `types.ts`). There is no code path from a tool to an
 *    `answers` row, which is the PII boundary ADR-25 requires.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import {
  FormDefinition as FormDefinitionSchema,
  QuestionDefinition as QuestionDefinitionSchema,
  type FormDefinition,
  type QuestionDefinition,
  type QuestionId,
} from "@qcms/core";

import type { AssistContext } from "./types.js";

/**
 * The allowlist. Adding a name here is a security decision and reviewed as one;
 * it is the only list the registry, the provider tool set and the guard read.
 */
export const ASSIST_TOOL_NAMES = [
  "search_question_library",
  "propose_questions",
  "propose_draft",
  "validate_draft",
] as const;

export type AssistToolName = (typeof ASSIST_TOOL_NAMES)[number];

const ALLOWED: ReadonlySet<string> = new Set<string>(ASSIST_TOOL_NAMES);

/** Whether `name` is an allowlisted tool. The only membership test in the slice. */
export function isAllowedToolName(name: string): name is AssistToolName {
  return ALLOWED.has(name);
}

/**
 * Raised when a model asks for a verb it was never given. Carries the attempted
 * name so the slice can log the refusal (041: "rejected and logged").
 */
export class ToolNotAllowedError extends Error {
  readonly tool: string;
  constructor(tool: string) {
    // The attempted name is model-supplied text. It is recorded, never executed,
    // and never interpolated anywhere it could be re-dispatched.
    super(`Tool "${tool}" is not in the draft-assistant allowlist`);
    this.name = "ToolNotAllowedError";
    this.tool = tool;
  }
}

/**
 * What a turn has proposed so far. Mutable by design: the tool loop accumulates
 * across steps, and the slice reads it once the loop ends.
 */
export interface ProposalState {
  proposedDraft: FormDefinition | undefined;
  readonly newQuestions: QuestionDefinition[];
}

export function createProposalState(): ProposalState {
  return { proposedDraft: undefined, newQuestions: [] };
}

// --- the four tools ---------------------------------------------------------

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

/**
 * A tool as this slice models it: a description, a Zod input schema (the same
 * schema language the OpenAPI documents use - one language end to end), and an
 * executor that may only touch the {@link AssistContext} it is handed.
 */
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
  // The turn is scoped to one form. A proposal that renames the form is a
  // rejected proposal, not a cross-form write.
  if (definition.formId !== ctx.draft.formId) {
    return {
      accepted: false,
      reason: "formId must match the form being edited",
    };
  }
  state.proposedDraft = definition;
  const issues = await ctx.validate(definition);
  return { accepted: true, valid: issues.length === 0, issues };
}

async function validateProposal(
  ctx: AssistContext,
  state: ProposalState,
): Promise<Record<string, unknown>> {
  const definition = state.proposedDraft ?? ctx.draft;
  const issues = await ctx.validate(definition);
  return { valid: issues.length === 0, issues };
}

/**
 * The registry. Frozen so nothing can graft a verb on at runtime, and the sole
 * source for both {@link runAssistTool} and {@link assistToolSet}.
 */
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
      "Propose the complete draft FormDefinition for this form. Returns the advisory validation issues for it. Never publishes.",
    inputSchema: ProposeDraftInput,
    execute: (input, ctx, state) => proposeDraft(input, ctx, state),
  },
  validate_draft: {
    description:
      "Run the publish validation over the currently proposed draft and return its issues.",
    inputSchema: ValidateInput,
    execute: (_input, ctx, state) => validateProposal(ctx, state),
  },
});

/**
 * **The only door.** Every tool execution in this slice goes through here, and a
 * name outside the allowlist is refused before anything is dispatched - so the
 * refusal is a property of the surface rather than of the model's cooperation.
 */
export async function runAssistTool(
  name: string,
  input: unknown,
  ctx: AssistContext,
  state: ProposalState,
): Promise<unknown> {
  if (!isAllowedToolName(name)) throw new ToolNotAllowedError(name);
  return REGISTRY[name].execute(input, ctx, state);
}

/**
 * The tool set handed to the provider. Built from the registry, so the model is
 * only ever *told about* the allowlisted verbs, and each `execute` still routes
 * back through {@link runAssistTool}: belt and braces, deliberately.
 */
export function assistToolSet(ctx: AssistContext, state: ProposalState): ToolSet {
  const set: Record<string, unknown> = {};
  for (const name of ASSIST_TOOL_NAMES) {
    const def = REGISTRY[name];
    set[name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: (input: unknown) => runAssistTool(name, input, ctx, state),
    });
  }
  return set as ToolSet;
}
