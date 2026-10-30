import { z } from "@hono/zod-openapi";

import { SavedDraftResponse } from "../forms/schema.js";

export const AssistTurnBody = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
});

export const AssistBody = z
  .strictObject({
    // Capped because an unbounded history is an unbounded upstream bill.
    conversation: z.array(AssistTurnBody).min(1).max(40),
    // The draft `updatedAt` the client proposed against; a mismatch is refused.
    clientState: z.string().max(64).optional(),
  })
  .openapi("AssistRequest");

// Opaque so an invalid definition reaches the kernel and earns its 422 rather than a bare 400.
// Unnamed because this flag-gated route must not register a component into a default build's document.
const OpaqueQuestionDefinition = z.record(z.string(), z.unknown());

/**
 * New question definitions travel with the draft that pins them because both must be
 * stored in one transaction; otherwise a draft can pin a question no create produced.
 */
export const AcceptProposalBody = z
  .strictObject({
    definition: OpaqueQuestionDefinition,
    // Capped at `propose_questions`' own ceiling.
    newQuestions: z
      .array(
        z.strictObject({
          definition: OpaqueQuestionDefinition,
          slug: z.string().min(1).max(200).optional(),
        }),
      )
      .max(50)
      .default([]),
  })
  .openapi("AcceptProposalBody");

const CreatedQuestionDraft = z.object({
  questionId: z.string().openapi({ example: "q_first_name" }),
  slug: z.string().openapi({ example: "first-name" }),
  version: z.number().int().openapi({ example: 1 }),
  status: z.literal("draft"),
});

/** Extends the save response so the builder's existing save handling reads this unchanged. */
export const AcceptProposalResponse = SavedDraftResponse.extend({
  createdQuestions: z.array(CreatedQuestionDraft),
}).openapi("AcceptProposalResponse");
