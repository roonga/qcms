import { z } from "@hono/zod-openapi";

import { LIBRARY_SEARCH_MAX_LENGTH } from "../../openapi.js";

/**
 * The Operations discovery contract (Code Owner, 2026-10-29, decision 3 / Q87, Q91;
 * `plan/environment-phase1-decisions.md`).
 *
 * # One route, five projections, and the absences are the specification
 *
 * Every optional field below is optional **per caller and per row** rather than per
 * deployment: a `responses.viewer` is served `counts` and no `release`, a `forms.viewer`
 * the reverse, and somebody holding both gets both (D3's "combined grants" row). So the
 * schema cannot describe the union as required, and a reader has to know what each `null`
 * means - which is why each one says so here.
 *
 * **There is no draft field, no `hasDraft`, no `latestVersion` and no `publishedAt`**, for
 * any caller. That is not an omission the `forms.viewer` projection is missing: it is the
 * ruling. Operations is about what is live in one environment, and the draft is the
 * authoring surface's, which `GET /admin/forms` already serves to the callers who hold
 * `form: read` there.
 */

/** The three intake readings a form can have in one environment (D3). */
export const OPERATIONS_INTAKE = ["open", "closed", "unreleased"] as const;

/** The orders the table guarantees. Every one is total: the tie-break is `(slug, formId)`. */
export const OPERATIONS_SORTS = [
  "slug-asc",
  "slug-desc",
  "released-desc",
  "released-asc",
  "submitted-desc",
  "submitted-asc",
] as const;

/** The largest page this route serves, and the default when a caller names none. */
export const OPERATIONS_LIMIT_MAX = 100;
export const OPERATIONS_LIMIT_DEFAULT = 25;

/**
 * `GET /admin/operations/forms` - the environment, the bounded filters and the cursor.
 *
 * `environment` is **required and has no default**, which is the whole of the Operations
 * context being explicit (Q84, C6): a remembered switcher header cannot decide which
 * environment's operational data a caller is authorised for, because the grant middleware
 * reads this same parameter (`environmentFrom: "query"`).
 */
export const OperationsFormsQuery = z.object({
  environment: z
    .string()
    .min(1)
    .max(53)
    .openapi({ param: { name: "environment", in: "query", required: true }, example: "prod" }),
  /** Matches the slug or the display name, bounded like both library lists (#862). */
  q: z
    .string()
    .max(LIBRARY_SEARCH_MAX_LENGTH)
    .optional()
    .openapi({ param: { name: "q", in: "query" } }),
  /** One of the workspaces that contributed a row; anything else returns nothing. */
  workspaceId: z
    .string()
    .max(64)
    .optional()
    .openapi({ param: { name: "workspaceId", in: "query" } }),
  intake: z
    .enum(OPERATIONS_INTAKE)
    .optional()
    .openapi({ param: { name: "intake", in: "query" } }),
  sort: z
    .enum(OPERATIONS_SORTS)
    .optional()
    .openapi({ param: { name: "sort", in: "query" } }),
  /** An opaque page position from a previous response's `nextCursor`. */
  cursor: z
    .string()
    .max(512)
    .optional()
    .openapi({ param: { name: "cursor", in: "query" } }),
  limit: z
    .string()
    .max(8)
    .optional()
    .openapi({ param: { name: "limit", in: "query" }, example: "25" }),
});

const OperationsFormRow = z.object({
  formId: z.string(),
  slug: z.string(),
  defaultLocale: z.string(),
  /**
   * The form's name for a human, derived from the newest **published** version's title and
   * falling back to the slug. Never read from the open draft, which no caller of this
   * route is shown.
   */
  displayName: z.string(),
  workspace: z.object({ workspaceId: z.string(), slug: z.string(), name: z.string() }),
  /**
   * Whether anything is released in this environment at all.
   *
   * Distinct from `release.closed` and served to **every** caller of the row, including an
   * eraser who sees no version: a form with no release can accept no session and mint no
   * usable link, which is a different answer from closed intake.
   */
  hasRelease: z.boolean(),
  /**
   * What is serving in this environment. `null` when nothing is, **and also when the
   * caller does not hold `form: read` in the owning workspace**: a response-only caller is
   * told nothing about versions, and `hasRelease` is their answer to the question this
   * field would have answered.
   */
  release: z
    .object({ version: z.number().int(), releasedAt: z.string(), closed: z.boolean() })
    .nullable(),
  /**
   * When this form was last released to **any** environment, for callers holding
   * `form: read`; `null` otherwise, or when it has never been released.
   */
  lastReleaseAt: z.string().nullable(),
  /**
   * The response aggregate for this form in this environment, **only** where the caller
   * holds `response: read` for that exact form and environment (F4, Q91); `null`
   * otherwise. Reading it writes no SEC-15 row, because an aggregate is not a read of
   * anybody's answers.
   */
  counts: z.object({ submitted: z.number().int(), inProgress: z.number().int() }).nullable(),
  /**
   * The acts this caller holds on this form **in this environment**, as `resource:action`
   * pairs, derived from the same policy decision that would authorise each one.
   *
   * Empty for a `forms.viewer`, who holds no write anywhere; non-empty and `prod`-free for
   * an editor scoped to non-production environments, because the matrix's production split
   * is in the decision rather than in this list. It is a convenience for a screen deciding
   * which rails to offer and authorises nothing: every one of those routes re-decides.
   */
  capabilities: z.array(z.string()),
});

export const OperationsFormsResponse = z
  .object({
    environment: z.string(),
    forms: z.array(OperationsFormRow),
    /** How many rows matched the filters, before the page was cut. */
    total: z.number().int(),
    /** The position to pass as `cursor` for the next page, or `null` at the end. */
    nextCursor: z.string().nullable(),
    /**
     * The workspace filter's options: only the workspaces that contributed a row to this
     * caller's unfiltered set (D3), so a filter can never name a workspace whose forms
     * this caller cannot see. It does not shrink as filters are applied, because a filter
     * affects the results below it and not the controls above them.
     */
    workspaces: z.array(z.object({ workspaceId: z.string(), slug: z.string(), name: z.string() })),
  })
  .openapi("OperationsFormsResponse");
