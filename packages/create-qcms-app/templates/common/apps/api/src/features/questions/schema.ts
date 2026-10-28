import { z } from "@hono/zod-openapi";

import { LIBRARY_SEARCH_MAX_LENGTH } from "../../openapi.js";

export const QuestionIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "q_favourite_colour" }),
});

export const VersionParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "q_favourite_colour" }),
  v: z.string().openapi({ param: { name: "v", in: "path" }, example: "1" }),
});

/** Free-form rather than an enum: the handler falls back to `en` rather than erroring. */
export const PreviewQuestionVersionQuery = z.object({
  locale: z
    .string()
    .optional()
    .openapi({
      param: { name: "locale", in: "query", required: false },
      description:
        "Locale to resolve labels/help in (ADR-11 subset, e.g. `en` or `en-AU`). Defaults to `en`; an unparseable value falls back to `en`.",
      example: "en",
    }),
});

/**
 * Declared here rather than imported from the kernel: this is the route contract the
 * OpenAPI document publishes, and it changes only when the API decides to expose a type.
 */
const QuestionTypeEnum = z.enum([
  "shortText",
  "longText",
  "number",
  "date",
  "boolean",
  "singleChoice",
  "multiChoice",
]);

export const ListQuestionsQuery = z.object({
  status: z
    .enum(["draft", "published", "deprecated"])
    .optional()
    .openapi({ param: { name: "status", in: "query" }, example: "published" }),
  type: QuestionTypeEnum.optional().openapi({
    param: { name: "type", in: "query" },
    example: "number",
  }),
  /** A search term is matched per row in the handler, so an unbounded term is unbounded work. */
  search: z
    .string()
    .max(LIBRARY_SEARCH_MAX_LENGTH)
    .optional()
    .openapi({ param: { name: "search", in: "query" }, example: "colour" }),
  /**
   * An enum of one value rather than a boolean, so a later caller can ask for a narrower
   * slice (`?versions=published`) without the parameter changing shape or meaning.
   */
  versions: z
    .enum(["all"])
    .optional()
    .openapi({ param: { name: "versions", in: "query" }, example: "all" }),
});

/**
 * Any JSON object, so an invalid definition reaches the handler and returns the kernel's
 * coded 422 rather than a bare 400 from the route schema.
 */
const OpaqueDefinition = z
  .record(z.string(), z.unknown())
  .openapi("QuestionDefinitionInput", { description: "A question definition (kernel-validated)." });

export const CreateQuestionBody = z
  .strictObject({
    slug: z.string().min(1).openapi({ example: "favourite-colour" }),
    definition: OpaqueDefinition,
    /** Omitted, it resolves to the installation's single workspace (`workspaces/resolve.ts`). */
    workspaceId: z.string().min(1).optional().openapi({ example: "org_default_workspace" }),
  })
  .openapi("CreateQuestionBody");

export const EditVersionBody = z
  .strictObject({ definition: OpaqueDefinition })
  .openapi("EditVersionBody");

const QuestionStatus = z.enum(["draft", "published", "deprecated"]);

export const QuestionVersionView = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    version: z.number().int().positive().openapi({ example: 1 }),
    status: QuestionStatus.openapi({ example: "draft" }),
    definition: z.unknown(),
    publishedAt: z.iso.datetime().nullable().openapi({ example: null }),
  })
  .openapi("QuestionVersionView");
export type QuestionVersionView = z.infer<typeof QuestionVersionView>;

export const CreatedQuestionResponse = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    slug: z.string().openapi({ example: "favourite-colour" }),
    /** Echoed because the request may not have named it. */
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
    createdAt: z.iso.datetime(),
    version: QuestionVersionView,
  })
  .openapi("CreatedQuestionResponse");

export const QuestionListItem = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    slug: z.string().openapi({ example: "favourite-colour" }),
    createdAt: z.iso.datetime(),
    latestVersion: z.number().int().positive().openapi({ example: 2 }),
    latestStatus: QuestionStatus.openapi({ example: "published" }),
    publishedAt: z.iso.datetime().nullable(),
    label: z.unknown(),
    type: QuestionTypeEnum.nullable(),
    /**
     * Absent rather than empty when the request did not ask, so "this response carries no
     * versions" and "this question has none" stay distinct.
     */
    versions: z.array(QuestionVersionView).optional(),
  })
  .openapi("QuestionListItem");
export type QuestionListItem = z.infer<typeof QuestionListItem>;

export const ListQuestionsResponse = z
  .object({ questions: z.array(QuestionListItem) })
  .openapi("ListQuestionsResponse");

/**
 * `root` is opaque to the API, so `unknown` rather than a recursive schema the API would
 * have to keep in step with the compiler.
 */
export const QuestionPreviewResponse = z
  .object({
    stepId: z.string().openapi({
      description: "Always the synthetic `stp_preview` - a preview is not a real step.",
      example: "stp_preview",
    }),
    root: z.unknown(),
    a2uiSpecVersion: z.string().openapi({ example: "1.0.0-preview.7" }),
    compilerVersion: z.string().openapi({ example: "0.1.0" }),
  })
  .openapi("QuestionPreviewResponse");

export const QuestionDetailResponse = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    slug: z.string().openapi({ example: "favourite-colour" }),
    createdAt: z.iso.datetime(),
    versions: z.array(QuestionVersionView),
  })
  .openapi("QuestionDetailResponse");
