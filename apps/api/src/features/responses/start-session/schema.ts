/**
 * Request/response schemas for the start-session slice (task 018).
 *
 * Zod is the single schema language (017's convention): these drive both
 * runtime validation and the generated OpenAPI documents (027). The request is
 * an exclusive choice — anonymous (`formSlug`) *or* secure link (`token`),
 * never both, never neither — expressed with a refinement so a malformed body
 * is a clean 400 before the handler runs.
 */

import { z } from "@hono/zod-openapi";

/**
 * Start-session request body. Exactly one of `formSlug` (anonymous entry) or
 * `token` (secure-link entry) must be present.
 */
export const StartSessionBody = z
  .object({
    formSlug: z.string().min(1).optional().openapi({
      description: "Public form slug for anonymous entry.",
      example: "customer-feedback",
    }),
    token: z.string().min(1).optional().openapi({
      description: "Secure-link token for invited entry.",
    }),
  })
  .refine((b) => (b.formSlug === undefined) !== (b.token === undefined), {
    message: "Provide exactly one of formSlug or token",
  })
  .openapi("StartSessionBody");
export type StartSessionBody = z.infer<typeof StartSessionBody>;

/**
 * Start-session response. `sessionToken` is the credential every later
 * respondent call must present (SEC-2); `formVersion` is the pinned version the
 * session serves for its whole life (I4); `expiresAt` is ISO 8601 UTC.
 */
export const StartSessionResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_9f3a2b1c" }),
    sessionToken: z.string(),
    formVersion: z.number().int().positive().openapi({ example: 1 }),
    expiresAt: z.iso.datetime().openapi({ example: "2026-07-21T00:00:00.000Z" }),
  })
  .openapi("StartSessionResponse");
export type StartSessionResponse = z.infer<typeof StartSessionResponse>;

/** Path params for `GET /sessions/{id}`. */
export const SessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ses_9f3a2b1c" }),
});

/**
 * Session status view (`GET /sessions/{id}`). `position` is the respondent's
 * current place in the flow for resume — computed by the forward-pass evaluator
 * in **019** (get-step). Until 019 wires the evaluator there is no flow to
 * resume into, so this slice returns `null` and marks the seam; the field's
 * shape is reserved so 019 fills it without a response-schema change.
 */
export const SessionStatusResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_9f3a2b1c" }),
    status: z.enum(["created", "in_progress", "submitted", "expired"]),
    formVersion: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
    position: z
      .null()
      .openapi({ description: "Reserved for the current flow position (filled by 019)." }),
  })
  .openapi("SessionStatusResponse");
export type SessionStatusResponse = z.infer<typeof SessionStatusResponse>;
