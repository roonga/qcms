/**
 * Request/response schemas for the response listing / export / erasure admin
 * slices (task 023). Zod is the single schema language (017); these drive both
 * request validation and the generated OpenAPI documents (027).
 *
 * Answer *values* ride through opaque (`z.unknown()`): they are canonical
 * encodings the reporting view already froze (015), echoed as-is. The export
 * route declares no `200` body schema - it streams `text/csv` / `application/json`
 * as a raw `Response`, which a content-typed response would forbid.
 */

import { z } from "@hono/zod-openapi";

// --- params -----------------------------------------------------------------

/** `:id` path param - a `frm_…` form id (validated as a FormId in-handler). */
export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

/** `:id`/`:sessionId` path params (form-scoped response detail). */
export const FormResponseParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  sessionId: z
    .string()
    .openapi({ param: { name: "sessionId", in: "path" }, example: "ses_abc123" }),
});

/** `:sessionId` path param (erase / unflag act on a session directly). */
export const SessionIdParam = z.object({
  sessionId: z
    .string()
    .openapi({ param: { name: "sessionId", in: "path" }, example: "ses_abc123" }),
});

// --- query filters ----------------------------------------------------------

/** `GET /admin/forms/:id/responses` filters (all parsed in-handler). */
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

/** `GET /admin/forms/:id/export` parameters. `version` is required for CSV. */
export const ExportQuery = z.object({
  format: z
    .enum(["csv", "json"])
    .optional()
    .openapi({ param: { name: "format", in: "query" }, example: "csv" }),
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

/** `GET /admin/erasures` filters. */
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

// --- request bodies ---------------------------------------------------------

/** `POST /admin/sessions/:sessionId/erase` - the erasure reason (audit). */
export const EraseBody = z
  .object({ reason: z.string().min(1).openapi({ example: "subject_request" }) })
  .openapi("EraseBody");

// --- responses --------------------------------------------------------------

const AccessMode = z.enum(["anonymous", "secure_link"]);

/** One row in the response list: identity, provenance, flag, answer preview. */
export const ResponseListItem = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    formVersion: z.number().int().positive().openapi({ example: 2 }),
    submittedAt: z.iso.datetime(),
    accessMode: AccessMode,
    /** `null` = clean; a reason string = flagged and withheld from webhooks (020). */
    flaggedReason: z.string().nullable().openapi({ example: null }),
    /** The locked answer set keyed by questionId (canonical encodings). */
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

/** One append-only ledger revision (audit history). */
export const LedgerEntry = z
  .object({
    questionId: z.string().openapi({ example: "q_full_name" }),
    value: z.unknown(),
    answeredAt: z.iso.datetime(),
  })
  .openapi("LedgerEntry");

/** `GET /admin/forms/:id/responses/:sessionId` - full detail + audit ledger. */
export const ResponseDetailResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    formVersion: z.number().int().positive().openapi({ example: 2 }),
    submittedAt: z.iso.datetime(),
    accessMode: AccessMode,
    flaggedReason: z.string().nullable(),
    /** The audit anchor (009): any holder can re-derive and verify the locked set. */
    contentHash: z.string().openapi({ example: "a1b2c3…" }),
    /** The locked answers keyed by questionId (canonical encodings). */
    answers: z.record(z.string(), z.unknown()),
    /** The append-only answer ledger, oldest first - the audit history. */
    ledger: z.array(LedgerEntry),
  })
  .openapi("ResponseDetailResponse");

/** One tombstone row (compliance evidence). */
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

/** `POST /admin/sessions/:sessionId/erase` - the resulting tombstone (idempotent). */
export const EraseResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    formVersion: z.number().int().positive().openapi({ example: 2 }),
    erasedAt: z.iso.datetime(),
    reason: z.string().openapi({ example: "subject_request" }),
    /** `true` when this call was a no-op over an already-erased session (016). */
    alreadyErased: z.boolean().openapi({ example: false }),
  })
  .openapi("EraseResponse");

/** `POST /admin/responses/:sessionId/unflag` - whether a withheld response was released. */
export const UnflagResponse = z
  .object({
    sessionId: z.string().openapi({ example: "ses_abc123" }),
    /** `true` when this call released the withheld `response.submitted` event. */
    released: z.boolean().openapi({ example: true }),
  })
  .openapi("UnflagResponse");
