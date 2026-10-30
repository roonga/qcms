import { z } from "@hono/zod-openapi";

import { SavedDraftResponse } from "../forms/schema.js";

export const AssistTurnBody = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
});

/**
 * A filter date the response query can use. Parsed here because `new Date` on an
 * unparsable string reaches the query as `Invalid Date` and fails as a 500.
 */
const FilterDate = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Not a date" });

/**
 * A screen id and the route's own ids, and nothing else. The browser never sends context
 * content, so a tampered client cannot hand the model something its screen would not show
 * (SEC-17).
 */
const ScreenParamsBody = z.strictObject({
  formId: z.string().max(200).optional(),
  questionId: z.string().max(200).optional(),
  workspaceId: z.string().max(200).optional(),
  sessionId: z.string().max(200).optional(),
  version: z.number().int().min(1).max(1_000_000).optional(),
  /** The response list's own four filters, none of which takes an answer value. */
  filters: z
    .strictObject({
      version: z.number().int().min(1).max(1_000_000).optional(),
      from: FilterDate.optional(),
      to: FilterDate.optional(),
      flagged: z.boolean().optional(),
    })
    .optional(),
});

const screenRef = {
  screen: z.string().min(1).max(200),
  params: ScreenParamsBody.optional(),
  /**
   * Random, minted by the admin when a conversation starts. The key an audited read is
   * deduplicated by, never an identity: forging one can only add rows.
   */
  conversationId: z.string().min(1).max(64),
};

export const AssistBody = z
  .strictObject({
    // Capped because an unbounded history is an unbounded upstream bill.
    conversation: z.array(AssistTurnBody).min(1).max(40),
    // The draft `updatedAt` the client proposed against; a mismatch is refused.
    clientState: z.string().max(64).optional(),
    // Optional here and required on the screen route: this route is the builder's own,
    // so a turn that names no screen is a turn on the builder. A named screen must be one
    // of this form's subtree.
    screen: screenRef.screen.optional(),
    params: screenRef.params,
    // Absent means no deduplication rather than a shared key, which is the safe
    // direction: an audited read then writes its row for every turn.
    conversationId: screenRef.conversationId.optional(),
  })
  .openapi("AssistRequest");

/** A turn on a screen with no form in its route: the screen id decides what it may read. */
export const ScreenAssistBody = z
  .strictObject({
    conversation: z.array(AssistTurnBody).min(1).max(40),
    ...screenRef,
  })
  .openapi("ScreenAssistRequest");

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
