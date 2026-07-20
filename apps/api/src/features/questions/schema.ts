/**
 * Request/response schemas for the admin question-authoring slices (task 021).
 *
 * Zod is the single schema language (017's convention); these drive both the
 * request validation the routes perform and the generated OpenAPI documents
 * (027). The **question definition** itself is validated by the kernel
 * (`QuestionDefinition`, task 003) inside the handlers — not re-declared here —
 * so a malformed definition returns the kernel's coded issues through the error
 * envelope (422) with its paths intact. The request bodies therefore carry the
 * definition as an opaque object; the route schema guards only the envelope
 * around it.
 */

import { z } from "@hono/zod-openapi";

// --- params -----------------------------------------------------------------

/** `:id` path param — a `q_…` question id (validated as a QuestionId in-handler). */
export const QuestionIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "q_favourite_colour" }),
});

/** `:id`/`:v` path params — version is parsed to a positive integer in-handler. */
export const VersionParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "q_favourite_colour" }),
  v: z.string().openapi({ param: { name: "v", in: "path" }, example: "1" }),
});

/** `GET /admin/questions` query filters. */
export const ListQuestionsQuery = z.object({
  status: z
    .enum(["draft", "published", "deprecated"])
    .optional()
    .openapi({ param: { name: "status", in: "query" }, example: "published" }),
  search: z
    .string()
    .optional()
    .openapi({ param: { name: "search", in: "query" }, example: "colour" }),
});

// --- request bodies ---------------------------------------------------------

/**
 * The question definition, opaque at the route boundary. The kernel
 * (`parseQuestionDefinition`, 003) validates its contents in the handler; here
 * it is any JSON object so a structurally-present-but-invalid definition still
 * reaches the handler and returns the kernel's 422 rather than a bare 400.
 */
const OpaqueDefinition = z
  .record(z.string(), z.unknown())
  .openapi("QuestionDefinitionInput", { description: "A question definition (kernel-validated)." });

/** `POST /admin/questions` — the library slug plus the first draft's definition. */
export const CreateQuestionBody = z
  .object({
    slug: z.string().min(1).openapi({ example: "favourite-colour" }),
    definition: OpaqueDefinition,
  })
  .openapi("CreateQuestionBody");

/** `PUT /admin/questions/:id/versions/:v` — the replacement draft definition. */
export const EditVersionBody = z
  .object({ definition: OpaqueDefinition })
  .openapi("EditVersionBody");

// --- responses --------------------------------------------------------------

const QuestionStatus = z.enum(["draft", "published", "deprecated"]);

/** One stored version in a response. `definition` echoes the kernel-valid JSON. */
export const QuestionVersionView = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    version: z.number().int().positive().openapi({ example: 1 }),
    status: QuestionStatus.openapi({ example: "draft" }),
    definition: z.unknown(),
    publishedAt: z.string().datetime().nullable().openapi({ example: null }),
  })
  .openapi("QuestionVersionView");
export type QuestionVersionView = z.infer<typeof QuestionVersionView>;

/** `POST /admin/questions` result: the new identity and its first draft version. */
export const CreatedQuestionResponse = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    slug: z.string().openapi({ example: "favourite-colour" }),
    createdAt: z.string().datetime(),
    version: QuestionVersionView,
  })
  .openapi("CreatedQuestionResponse");

/** One row in the library list: the latest-version summary plus its label. */
export const QuestionListItem = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    slug: z.string().openapi({ example: "favourite-colour" }),
    createdAt: z.string().datetime(),
    latestVersion: z.number().int().positive().openapi({ example: 2 }),
    latestStatus: QuestionStatus.openapi({ example: "published" }),
    publishedAt: z.string().datetime().nullable(),
    /** The latest version's localized label (locale → text); [] of loading only. */
    label: z.unknown(),
  })
  .openapi("QuestionListItem");

export const ListQuestionsResponse = z
  .object({ questions: z.array(QuestionListItem) })
  .openapi("ListQuestionsResponse");

/** `GET /admin/questions/:id`: the identity with every version, oldest first. */
export const QuestionDetailResponse = z
  .object({
    questionId: z.string().openapi({ example: "q_favourite_colour" }),
    slug: z.string().openapi({ example: "favourite-colour" }),
    createdAt: z.string().datetime(),
    versions: z.array(QuestionVersionView),
  })
  .openapi("QuestionDetailResponse");
