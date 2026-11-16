import { z } from "zod";

import { CreateQuestionBody, EditVersionBody } from "../../questions/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { routeArgs, stated, wholeParam, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/**
 * D6's question library and question detail. A question definition is authoring content
 * rather than respondent content, so it travels in a step's arguments and the card shows
 * it in full; nothing here reads an answer, a ledger row or a payload.
 */

const QuestionIdArg = z.string().min(1).max(200);

const VersionArg = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647)
  .describe("The version this act names. A draft for a save, a published one to deprecate.");

const DEFINITION_TEXT =
  "The question definition, as the kernel takes it: `questionId`, `type`, `label` and " +
  "whatever that type requires. The API refuses one that is not valid, and the card " +
  "shows every field of it before anybody confirms.";

const create = routeArgs(
  CreateQuestionBody,
  {
    slug: CreateQuestionBody.shape.slug
      .max(200)
      .describe("The slug the question is addressed by, unique in the library."),
    definition: CreateQuestionBody.shape.definition.describe(DEFINITION_TEXT),
    workspaceId: stated(CreateQuestionBody.shape.workspaceId)
      .max(200)
      .optional()
      .describe(
        "The workspace the question belongs to. Omitted where the installation has one, " +
          "and required where it has more.",
      ),
  } satisfies StepArgs<typeof CreateQuestionBody.shape, never, never>,
  {},
);

const saveDraft = routeArgs(
  EditVersionBody,
  {
    questionId: QuestionIdArg,
    version: VersionArg,
    definition: EditVersionBody.shape.definition.describe(DEFINITION_TEXT),
  } satisfies StepArgs<typeof EditVersionBody.shape, never, "questionId" | "version">,
  // The path's `{v}` as the card displayed it, which is a number rather than its text.
  { params: { questionId: "id" }, readers: { version: wholeParam("v") } },
);

const VersionActArgs = z.strictObject({
  questionId: QuestionIdArg,
  version: VersionArg,
});

const NewVersionArgs = z.strictObject({ questionId: QuestionIdArg });

/** The path's `{v}` as the card displayed it, which is a number rather than its text. */
const versionParam = wholeParam("v");

export const createQuestion: ActionKindDef = {
  kind: "question.create",
  screen: "/questions",
  route: { method: "POST", path: "/admin/questions" },
  cell: { resource: "question", action: "write" },
  environmentFrom: "switcher",
  ...create,
  references: ["questionId"],
  resultAllowlist: ["questionId", "slug", "version"],
  carriesQuestionDefinition: true,
  card: {
    titleKey: "agent.card.question.create.title",
    consequenceKeys: ["agent.card.question.create.consequence"],
    headingControl: "questions.create",
    createdLink: { screen: "/questions/[questionId]", field: "questionId" },
  },
  description: ACTION_DESCRIPTIONS["question.create"],
};

export const saveQuestionDraft: ActionKindDef = {
  kind: "question.saveDraft",
  screen: "/questions/[questionId]",
  route: { method: "PUT", path: "/admin/questions/{id}/versions/{v}" },
  cell: { resource: "question", action: "write" },
  environmentFrom: "switcher",
  ...saveDraft,
  references: [],
  resultAllowlist: ["questionId", "version", "status"],
  carriesQuestionDefinition: true,
  card: {
    titleKey: "agent.card.question.saveDraft.title",
    consequenceKeys: ["agent.card.question.saveDraft.consequence"],
    headingControl: "question.save",
  },
  description: ACTION_DESCRIPTIONS["question.saveDraft"],
};

export const publishQuestionVersion: ActionKindDef = {
  kind: "question.publish",
  screen: "/questions/[questionId]",
  route: { method: "POST", path: "/admin/questions/{id}/versions/{v}/publish" },
  cell: { resource: "question", action: "write" },
  environmentFrom: "switcher",
  args: VersionActArgs,
  recomputeArgs: (facts) => ({
    questionId: facts.params["id"] ?? "",
    version: versionParam(facts),
  }),
  references: ["version"],
  resultAllowlist: ["questionId", "version", "status"],
  card: {
    titleKey: "agent.card.question.publish.title",
    consequenceKeys: ["agent.card.question.publish.consequence"],
    headingControl: "question.lifecycle",
  },
  description: ACTION_DESCRIPTIONS["question.publish"],
};

export const deprecateQuestionVersion: ActionKindDef = {
  kind: "question.deprecate",
  screen: "/questions/[questionId]",
  route: { method: "POST", path: "/admin/questions/{id}/versions/{v}/deprecate" },
  cell: { resource: "question", action: "write" },
  environmentFrom: "switcher",
  args: VersionActArgs,
  recomputeArgs: (facts) => ({
    questionId: facts.params["id"] ?? "",
    version: versionParam(facts),
  }),
  references: ["version"],
  resultAllowlist: ["questionId", "version", "status"],
  card: {
    titleKey: "agent.card.question.deprecate.title",
    consequenceKeys: ["agent.card.question.deprecate.consequence"],
    headingControl: "question.lifecycle",
  },
  description: ACTION_DESCRIPTIONS["question.deprecate"],
};

export const newQuestionVersion: ActionKindDef = {
  kind: "question.newVersion",
  screen: "/questions/[questionId]",
  route: { method: "POST", path: "/admin/questions/{id}/versions" },
  cell: { resource: "question", action: "write" },
  environmentFrom: "switcher",
  args: NewVersionArgs,
  recomputeArgs: (facts) => ({ questionId: facts.params["id"] ?? "" }),
  references: ["version"],
  resultAllowlist: ["questionId", "version", "status"],
  card: {
    titleKey: "agent.card.question.newVersion.title",
    consequenceKeys: ["agent.card.question.newVersion.consequence"],
    headingControl: "question.lifecycle",
    createdLink: { screen: "/questions/[questionId]", field: "questionId" },
  },
  description: ACTION_DESCRIPTIONS["question.newVersion"],
};
