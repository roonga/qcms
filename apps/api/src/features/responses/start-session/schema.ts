/**
 * Request/response schemas for the start-session slice (task 018).
 *
 * Zod is the single schema language (017's convention): these drive both
 * runtime validation and the generated OpenAPI documents (027). The request is
 * an exclusive choice - anonymous (`formSlug`) *or* secure link (`token`),
 * never both, never neither - expressed with a refinement so a malformed body
 * is a clean 400 before the handler runs.
 */

import { z } from "@hono/zod-openapi";

/**
 * The challenge solution, on both entry bodies.
 *
 * Verified by **the environment's** provider since task 066 (Q11): the environment row
 * names one, or `NULL` leaves the installation-wide typed value in force. Ignored when
 * the effective provider is `none`.
 */
const ChallengeToken = z
  .string()
  .optional()
  .openapi({
    description:
      "Challenge solution (e.g. Turnstile token) for a form with challengeRequired set. " +
      "Verified by the environment's provider, or the installation-wide one when the " +
      "environment names none (task 026, Q11).",
  });

/**
 * **Anonymous** entry (`POST /sessions`): a public form slug.
 *
 * One field, since task 066. This body carried `formSlug` or `token` with a refinement
 * saying "exactly one", because anonymous and secure-link entry were one route. They are
 * two routes now (ADR-09's amended Note), so each body carries its own field and the
 * refinement is gone: a request that names the wrong one is refused by `strictObject`
 * before the handler runs, exactly as the refinement used to refuse a request that named
 * both.
 *
 * **This route exists on `prod` alone** (SEC-14, criterion 3). The split is what makes
 * that a `404` rather than a handler's `403`, and the schema is where the two entry modes
 * stop being one thing.
 */
export const StartSessionBody = z
  .strictObject({
    formSlug: z.string().min(1).openapi({
      description: "Public form slug for anonymous entry.",
      example: "customer-feedback",
    }),
    challengeToken: ChallengeToken,
  })
  .openapi("StartSessionBody");
export type StartSessionBody = z.infer<typeof StartSessionBody>;

/**
 * **Secure-link** entry (`POST /sessions/link`): the opaque link token.
 *
 * Mounted on every environment's respondent surface, because a secure link is how a
 * non-prod environment is reached at all (ADR-40 ruling 3). The environment is **not** in
 * this body and never in the token (Q21): the address names it and the `secure_links` row
 * decides it, so a token presented under the wrong prefix is refused rather than honoured.
 */
export const StartLinkSessionBody = z
  .strictObject({
    token: z.string().min(1).openapi({
      description: "Secure-link token for invited entry.",
    }),
    challengeToken: ChallengeToken,
  })
  .openapi("StartLinkSessionBody");
export type StartLinkSessionBody = z.infer<typeof StartLinkSessionBody>;

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
 * current place in the flow for resume - computed by the forward-pass evaluator
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
