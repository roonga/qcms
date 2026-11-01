import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

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

const DefinitionArg = z
  .record(z.string(), z.unknown())
  .describe(
    "The question definition, as the kernel takes it: `questionId`, `type`, `label` and " +
      "whatever that type requires. The API refuses one that is not valid, and the card " +
      "shows every field of it before anybody confirms.",
  );

const CreateQuestionArgs = z.strictObject({
  slug: z
    .string()
    .min(1)
    .max(200)
    .describe("The slug the question is addressed by, unique in the library."),
  definition: DefinitionArg,
  workspaceId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The workspace the question belongs to. Omitted where the installation has one, " +
        "and required where it has more.",
    ),
});

const SaveDraftArgs = z.strictObject({
  questionId: QuestionIdArg,
  version: VersionArg,
  definition: DefinitionArg,
});

const VersionActArgs = z.strictObject({
  questionId: QuestionIdArg,
  version: VersionArg,
});

const NewVersionArgs = z.strictObject({ questionId: QuestionIdArg });

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

/** The path's `{v}` as the card displayed it, which is a number rather than its text. */
function versionParam(facts: ActionRequestFacts): number {
  return Number.parseInt(facts.params["v"] ?? "", 10);
}

export const createQuestion: ActionKindDef = {
  kind: "question.create",
  screen: "/questions",
  route: { method: "POST", path: "/admin/questions" },
  cell: { resource: "question", action: "write" },
  environmentFrom: "switcher",
  args: CreateQuestionArgs,
  recomputeArgs: (facts) => ({
    slug: bodyMember(facts, "slug"),
    definition: bodyMember(facts, "definition"),
    ...(bodyMember(facts, "workspaceId") === undefined
      ? {}
      : { workspaceId: bodyMember(facts, "workspaceId") }),
  }),
  references: ["questionId"],
  resultAllowlist: ["questionId", "slug", "version"],
  card: {
    titleKey: "agent.card.question.create.title",
    consequenceKeys: ["agent.card.question.create.consequence"],
    headingControl: "questions.create",
    createdLink: { screen: "/questions/[questionId]", field: "questionId" },
  },
  description:
    "Create a question and its draft v1 in the library. The id is minted once and never " +
    "changes. Nothing pins the question until a form's draft does, and nothing serves it " +
    "until the version is published.",
};

export const saveQuestionDraft: ActionKindDef = {
  kind: "question.saveDraft",
  screen: "/questions/[questionId]",
  route: { method: "PUT", path: "/admin/questions/{id}/versions/{v}" },
  cell: { resource: "question", action: "write" },
  environmentFrom: "switcher",
  args: SaveDraftArgs,
  recomputeArgs: (facts) => ({
    questionId: facts.params["id"] ?? "",
    version: versionParam(facts),
    definition: bodyMember(facts, "definition"),
  }),
  references: [],
  resultAllowlist: ["questionId", "version", "status"],
  card: {
    titleKey: "agent.card.question.saveDraft.title",
    consequenceKeys: ["agent.card.question.saveDraft.consequence"],
    headingControl: "question.save",
  },
  description:
    "Replace a draft version's definition. A published or deprecated version is refused: " +
    "published content is immutable, so changing one means opening a new version.",
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
  description:
    "Freeze a draft version and make it pinnable. Its content can never change again, and " +
    "a form's draft that pins it stops reporting an unpublished pin.",
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
  description:
    "Block new pins on a published version. Every form already pinned to it is untouched " +
    "and keeps serving it.",
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
  description:
    "Open a new draft version, seeded from the latest one. Nothing published changes, and " +
    "no form moves to it until a draft pins the new version.",
};
