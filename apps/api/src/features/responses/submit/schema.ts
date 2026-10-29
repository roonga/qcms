import { z } from "@hono/zod-openapi";

export const SessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ses_9f3a2b1c" }),
});

/** Loose, so a re-configured honeypot field name still reaches the handler unstripped. */
export const SubmitBody = z
  .looseObject({
    website: z
      .string()
      .optional()
      .openapi({ description: "Honeypot field; must be empty. A non-empty value is flagged." }),
  })
  .openapi("SubmitBody");
export type SubmitBody = z.infer<typeof SubmitBody>;

/** The same shape for a clean and a flagged submission, so the tell never leaks. */
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
