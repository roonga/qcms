import { z } from "@hono/zod-openapi";

export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

export const FormResponseParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  sessionId: z
    .string()
    .openapi({ param: { name: "sessionId", in: "path" }, example: "ses_abc123" }),
});

/** The form segment is what the mutations' scoped queries filter on: a session id alone
 * never established which form the caller was acting within. */
export const FormSessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  sessionId: z
    .string()
    .openapi({ param: { name: "sessionId", in: "path" }, example: "ses_abc123" }),
});

export const ListResponsesQuery = z.object({
  version: z
    .string()
    .optional()
    .openapi({ param: { name: "version", in: "query" }, example: "2" }),
  from: z
    .string()
    .optional()
    .openapi({ param: { name: "from", in: "query" }, example: "2026-01-01T00:00:00.000Z" }),
  to: z
    .string()
    .optional()
    .openapi({ param: { name: "to", in: "query" }, example: "2026-12-31T23:59:59.999Z" }),
  flagged: z
    .enum(["true", "false"])
    .optional()
    .openapi({ param: { name: "flagged", in: "query" }, example: "true" }),
  page: z
    .string()
    .optional()
    .openapi({ param: { name: "page", in: "query" }, example: "1" }),
  pageSize: z
    .string()
    .optional()
    .openapi({ param: { name: "pageSize", in: "query" }, example: "50" }),
});

/**
 * `version` is required for CSV. A wide export's header is the version's `max`, so it
 * grows when `max` does: a consumer pins the version, or takes the long default.
 */
export const ExportQuery = z.object({
  format: z
    .enum(["csv", "json"])
    .optional()
    .openapi({ param: { name: "format", in: "query" }, example: "csv" }),
  shape: z
    .enum(["long", "wide"])
    .optional()
    .openapi({ param: { name: "shape", in: "query" }, example: "long" }),
  version: z
    .string()
    .optional()
    .openapi({ param: { name: "version", in: "query" }, example: "2" }),
  from: z
    .string()
    .optional()
    .openapi({ param: { name: "from", in: "query" } }),
  to: z
    .string()
    .optional()
    .openapi({ param: { name: "to", in: "query" } }),
});

export const ListErasuresQuery = z.object({
  formId: z
    .string()
    .optional()
    .openapi({ param: { name: "formId", in: "query" }, example: "frm_intake" }),
  page: z
    .string()
    .optional()
    .openapi({ param: { name: "page", in: "query" }, example: "1" }),
  pageSize: z
    .string()
    .optional()
    .openapi({ param: { name: "pageSize", in: "query" }, example: "50" }),
});

export const EraseBody = z
  .strictObject({ reason: z.string().min(1).openapi({ example: "subject_request" }) })
  .openapi("EraseBody");

const AccessMode = z.enum(["anonymous", "secure_link"]);

export const ResponseListItem = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    formVersion: z.number().int().positive().openapi({ example: 2 }),
    submittedAt: z.iso.datetime(),
    accessMode: AccessMode,
    flaggedReason: z.string().nullable().openapi({ example: null }),
    answers: z.record(z.string(), z.unknown()),
  })
  .openapi("ResponseListItem");

export const ResponseListResponse = z
  .object({
    responses: z.array(ResponseListItem),
    page: z.number().int().positive().openapi({ example: 1 }),
    pageSize: z.number().int().positive().openapi({ example: 50 }),
    total: z.number().int().nonnegative().openapi({ example: 3 }),
  })
  .openapi("ResponseListResponse");

export const LedgerEntry = z
  .object({
    questionId: z.string().openapi({ example: "q_full_name" }),
    value: z.unknown(),
    retracted: z.boolean().openapi({
      description:
        "True when this revision RETRACTED the answer (the respondent cleared it); `value` is then null and the question became unanswered at this point in the history.",
      example: false,
    }),
    answeredAt: z.iso.datetime(),
  })
  .openapi("LedgerEntry");

export const ResponseDetailResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    formVersion: z.number().int().positive().openapi({ example: 2 }),
    submittedAt: z.iso.datetime(),
    accessMode: AccessMode,
    flaggedReason: z.string().nullable(),
    contentHash: z.string().openapi({ example: "a1b2c3…" }),
    answers: z.record(z.string(), z.unknown()),
    ledger: z.array(LedgerEntry),
  })
  .openapi("ResponseDetailResponse");

export const TombstoneItem = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    formVersion: z.number().int().positive().openapi({ example: 2 }),
    erasedAt: z.iso.datetime(),
    reason: z.string().openapi({ example: "subject_request" }),
  })
  .openapi("TombstoneItem");

export const ErasuresResponse = z
  .object({ erasures: z.array(TombstoneItem) })
  .openapi("ErasuresResponse");

export const EraseResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    formVersion: z.number().int().positive().openapi({ example: 2 }),
    erasedAt: z.iso.datetime(),
    reason: z.string().openapi({ example: "subject_request" }),
    alreadyErased: z.boolean().openapi({ example: false }),
  })
  .openapi("EraseResponse");

/**
 * Carries existence and nothing else, and names only environments this caller may erase
 * in: no answer, version or timestamp crosses an environment boundary, and existence is
 * not disclosed where the caller holds no grant.
 */
export const ErasureScopeResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    environment: z.string().openapi({ example: "prod" }),
    alreadyErased: z.boolean().openapi({ example: false }),
    otherEnvironments: z
      .array(
        z.object({
          environment: z.string().openapi({ example: "test" }),
          alreadyErased: z.boolean().openapi({ example: false }),
        }),
      )
      .openapi({ example: [{ environment: "test", alreadyErased: false }] }),
  })
  .openapi("ErasureScopeResponse");

export const UnflagResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    released: z.boolean().openapi({ example: true }),
  })
  .openapi("UnflagResponse");
