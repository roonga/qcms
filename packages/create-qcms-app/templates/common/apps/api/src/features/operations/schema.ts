import { z } from "@hono/zod-openapi";

import { LIBRARY_SEARCH_MAX_LENGTH } from "../../openapi.js";

/** The three intake readings a form can have in one environment. */
export const OPERATIONS_INTAKE = ["open", "closed", "unreleased"] as const;

/** The orders the table guarantees. Each is total: the tie-break is `(slug, formId)`. */
export const OPERATIONS_SORTS = [
  "slug-asc",
  "slug-desc",
  "released-desc",
  "released-asc",
  "submitted-desc",
  "submitted-asc",
] as const;

export const OPERATIONS_LIMIT_MAX = 100;
export const OPERATIONS_LIMIT_DEFAULT = 25;

/**
 * `environment` is required and has no default: a remembered switcher header cannot
 * decide which environment a caller is authorised for, since the grant middleware reads
 * this same parameter.
 */
export const OperationsFormsQuery = z.object({
  environment: z
    .string()
    .min(1)
    .max(53)
    .openapi({ param: { name: "environment", in: "query", required: true }, example: "prod" }),
  q: z
    .string()
    .max(LIBRARY_SEARCH_MAX_LENGTH)
    .optional()
    .openapi({ param: { name: "q", in: "query" } }),
  workspaceId: z
    .string()
    .max(64)
    .optional()
    .openapi({ param: { name: "workspaceId", in: "query" } }),
  intake: z.enum(OPERATIONS_INTAKE).optional().openapi({ param: { name: "intake", in: "query" } }),
  sort: z.enum(OPERATIONS_SORTS).optional().openapi({ param: { name: "sort", in: "query" } }),
  cursor: z.string().max(512).optional().openapi({ param: { name: "cursor", in: "query" } }),
  limit: z
    .string()
    .max(8)
    .optional()
    .openapi({ param: { name: "limit", in: "query" }, example: "25" }),
});

// Every nullable field below is null both when there is nothing to report and when the
// caller holds no cell for it, so each one says which cell it needs. No caller is served
// a draft, a draft flag, a latest version or a publication time.
const OperationsFormRow = z.object({
  formId: z.string(),
  slug: z.string(),
  defaultLocale: z.string(),
  // Derived from the newest published version's title, falling back to the slug.
  displayName: z.string(),
  workspace: z.object({ workspaceId: z.string(), slug: z.string(), name: z.string() }),
  // Whether anything is released here at all, served to every caller of the row: a form
  // with no release accepts no session and mints no usable link.
  hasRelease: z.boolean(),
  // What is serving here. Null without `form: read` in the owning workspace.
  release: z
    .object({ version: z.number().int(), releasedAt: z.string(), closed: z.boolean() })
    .nullable(),
  // When this form was last released to any environment. Null without `form: read`.
  lastReleaseAt: z.string().nullable(),
  // Null unless the caller holds `response: read` for this form and environment. Reading
  // it writes no access-audit row: an aggregate is not a read of anybody's answers.
  counts: z.object({ submitted: z.number().int(), inProgress: z.number().int() }).nullable(),
  // The acts this caller holds on this form in this environment, as `resource:action`
  // pairs. A convenience for choosing rails; every one of those routes re-decides.
  capabilities: z.array(z.string()),
});

export const OperationsFormsResponse = z
  .object({
    environment: z.string(),
    forms: z.array(OperationsFormRow),
    // How many rows matched the filters, before the page was cut.
    total: z.number().int(),
    nextCursor: z.string().nullable(),
    // The workspaces that contributed a row to this caller's unfiltered set, so a filter
    // can never name a workspace whose forms they cannot see.
    workspaces: z.array(z.object({ workspaceId: z.string(), slug: z.string(), name: z.string() })),
  })
  .openapi("OperationsFormsResponse");
