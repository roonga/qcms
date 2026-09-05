/**
 * Request/response schemas for the assist slice (041).
 *
 * The turn's response is an SSE stream rather than a JSON body, so only its
 * request is schema'd here; the event shapes are `AssistEvent` in `types.ts` and
 * are documented in this slice's README. Accepting a proposal is an ordinary
 * JSON round trip, so it has both halves.
 */

import { z } from "@hono/zod-openapi";

import { SavedDraftResponse } from "../schema.js";

/** One turn the client replays. The whole conversation is the whole memory. */
export const AssistTurnBody = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
});

export const AssistBody = z
  .object({
    /**
     * The conversation so far, oldest first, ending with the new user turn.
     * Capped: this is not a chat product, it is one authoring task, and an
     * unbounded history is an unbounded upstream bill.
     */
    conversation: z.array(AssistTurnBody).min(1).max(40),
    /**
     * The client's view of the draft it is proposing against (the draft's
     * `updatedAt`, as returned by the draft endpoints). When it does not match
     * the stored draft the request is refused rather than served against a draft
     * the author is no longer looking at.
     */
    clientState: z.string().max(64).optional(),
  })
  .openapi("AssistRequest");

/**
 * A proposed question definition, opaque at the route boundary.
 *
 * Opaque for the reason `POST /admin/questions` gives: the kernel validates the
 * contents in the handler, so a structurally-present-but-invalid definition
 * reaches it and earns the kernel's 422 rather than a bare 400. Unnamed, because
 * this route is flag-gated and must not register a component into a document a
 * default build publishes.
 */
const OpaqueQuestionDefinition = z.record(z.string(), z.unknown());

/**
 * `POST /admin/forms/:id/draft/assist/accept` - the human's Accept (issue #823).
 *
 * The proposal's new question definitions travel with the draft that pins them
 * because they have to be stored in the same transaction: a draft that pins a
 * question no create ever produced is the defect this route exists to close.
 * `slug` is optional and derived from the questionId when absent, so the panel
 * can accept a proposal without inventing library naming on the author's behalf.
 */
export const AcceptProposalBody = z
  .object({
    definition: OpaqueQuestionDefinition,
    /**
     * The proposal's NEW question definitions, in the order the agent proposed
     * them. Capped at `propose_questions`' own ceiling: a turn cannot propose
     * more than fifty, so an accept cannot carry more either.
     */
    newQuestions: z
      .array(
        z.object({
          definition: OpaqueQuestionDefinition,
          slug: z.string().min(1).max(200).optional(),
        }),
      )
      .max(50)
      .default([]),
  })
  .openapi("AcceptProposalBody");

/** One question draft the accept created (never published - §4.2). */
const CreatedQuestionDraft = z.object({
  questionId: z.string().openapi({ example: "q_first_name" }),
  slug: z.string().openapi({ example: "first-name" }),
  version: z.number().int().openapi({ example: 1 }),
  status: z.literal("draft"),
});

/**
 * The accept's answer: exactly what a draft save returns, plus the drafts it
 * created. The save half is the same schema so the builder's existing save
 * handling reads this response unchanged.
 */
export const AcceptProposalResponse = SavedDraftResponse.extend({
  createdQuestions: z.array(CreatedQuestionDraft),
}).openapi("AcceptProposalResponse");
