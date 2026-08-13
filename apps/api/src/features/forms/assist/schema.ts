/**
 * Request/response schemas for the assist slice (041).
 *
 * The response is an SSE stream rather than a JSON body, so only the request is
 * schema'd here; the event shapes are `AssistEvent` in `types.ts` and are
 * documented in this slice's README.
 */

import { z } from "@hono/zod-openapi";

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
