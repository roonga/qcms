import { z } from "@hono/zod-openapi";

const ChallengeToken = z
  .string()
  .optional()
  .openapi({
    description:
      "Challenge solution (e.g. Turnstile token) for a form with challengeRequired set. " +
      "Verified by the environment's provider, or the installation-wide one when the " +
      "environment names none (task 026, Q11).",
  });

/** `strictObject`, so a body naming the other mode's field is refused before the handler. */
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
 * The environment is not in this body and never in the token: the address names it and
 * the `secure_links` row decides it.
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

/** `sessionToken` is the credential every later respondent call must present (SEC-2). */
export const StartSessionResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_9f3a2b1c" }),
    sessionToken: z.string(),
    formVersion: z.number().int().positive().openapi({ example: 1 }),
    expiresAt: z.iso.datetime().openapi({ example: "2026-07-21T00:00:00.000Z" }),
  })
  .openapi("StartSessionResponse");
export type StartSessionResponse = z.infer<typeof StartSessionResponse>;

export const SessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ses_9f3a2b1c" }),
});

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
