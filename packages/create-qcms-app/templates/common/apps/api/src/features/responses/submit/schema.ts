/**
 * Request/response schemas for the submit slice (task 020): `POST
 * /sessions/{id}/submit` - the audit boundary.
 *
 * Zod is the single schema language (017's convention); these drive both
 * runtime validation and the generated OpenAPI documents (027).
 *
 * The response is the respondent's **receipt**: the submit timestamp and the
 * `contentHash` sealing the locked answer set (the audit anchor, task 009). It
 * is deliberately identical whether the submission was clean or silently flagged
 * by an anti-abuse hook - a flagged submission must be indistinguishable from a
 * clean one to the caller (SECURITY: do not teach bots the tells).
 */

import { z } from "@hono/zod-openapi";

/** Path param for the session-scoped submit route. */
export const SessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ses_9f3a2b1c" }),
});

/**
 * Submit request body. Carries only anti-abuse decoy input: the honeypot field
 * (`website` by default; the handler reads the configured name). A **loose**
 * object so a re-configured honeypot field name (026) still reaches the handler
 * rather than being stripped as an unknown key. A legitimate client sends `{}`.
 */
export const SubmitBody = z
  .looseObject({
    website: z
      .string()
      .optional()
      .openapi({ description: "Honeypot field; must be empty. A non-empty value is flagged." }),
  })
  .openapi("SubmitBody");
export type SubmitBody = z.infer<typeof SubmitBody>;

/**
 * The submission receipt (task 020 §4): the timestamp the answer set was locked
 * and its content hash. Same shape for clean and flagged submissions.
 */
export const SubmitResponse = z
  .object({
    submittedAt: z.iso.datetime().openapi({ example: "2026-07-20T00:00:00.000Z" }),
    contentHash: z.string().openapi({
      description: "Lowercase-hex SHA-256 over the canonical locked submission (the audit anchor).",
      example: "3b0c…",
    }),
  })
  .openapi("SubmitResponse");
export type SubmitResponse = z.infer<typeof SubmitResponse>;
