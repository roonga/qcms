import { sql } from "drizzle-orm";
import { check, index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/** The two scopes a request is decided in. */
export const APPROVAL_SCOPES = ["site", "workspace"] as const;

/** One of {@link APPROVAL_SCOPES}. */
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

/** Site-scope kinds: each targets an account. */
export const SITE_APPROVAL_KINDS = ["promote", "demote", "disable", "reset"] as const;

/** Workspace-scope kinds, decided in the workspace the request names. */
export const WORKSPACE_APPROVAL_KINDS = [
  "self-grant",
  "second-approval-off",
  "draft-publish",
  "move-form",
] as const;

export const APPROVAL_KINDS = [...SITE_APPROVAL_KINDS, ...WORKSPACE_APPROVAL_KINDS] as const;

/** One of {@link APPROVAL_KINDS}. */
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** One of {@link SITE_APPROVAL_KINDS}. */
export type SiteApprovalKind = (typeof SITE_APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;

/** One of {@link APPROVAL_STATUSES}. */
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** How long a request stays decidable. */
export const APPROVAL_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const APPROVAL_REQUESTS_TABLE = "approval_requests";

export const APPROVAL_REQUEST_KIND_CHECK = "approval_requests_kind";

export const APPROVAL_REQUEST_SECOND_ACCOUNT_CHECK = "approval_requests_second_account";

/**
 * A held act awaiting a second account, at site or workspace scope. Rows update in place; the
 * history lives in the audit rows each transition writes beside it.
 */
export const approvalRequests = controlSchema.table(
  APPROVAL_REQUESTS_TABLE,
  {
    requestId: text("request_id").primaryKey(),
    scope: text("scope").notNull(),
    /** Set exactly when the scope is `workspace`. No foreign key: a request outlives nothing. */
    workspaceId: text("workspace_id"),
    kind: text("kind").notNull(),
    /** An account id at site scope; a group, workspace or form id at workspace scope. */
    target: text("target").notNull(),
    /** What the request binds at request time, validated per kind on write. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    requestedBy: text("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    check("approval_requests_scope", sql`${t.scope} in ('site', 'workspace')`),
    check(
      APPROVAL_REQUEST_KIND_CHECK,
      sql`(${t.scope} = 'site' and ${t.kind} in ('promote', 'demote', 'disable', 'reset') and ${t.workspaceId} is null) or (${t.scope} = 'workspace' and ${t.kind} in ('self-grant', 'second-approval-off', 'draft-publish', 'move-form') and ${t.workspaceId} is not null)`,
    ),
    check(
      "approval_requests_status",
      sql`${t.status} in ('pending', 'approved', 'rejected', 'expired')`,
    ),
    check("approval_requests_payload_object", sql`jsonb_typeof(${t.payload}) = 'object'`),
    check(
      "approval_requests_seven_days",
      sql`${t.expiresAt} = ${t.requestedAt} + interval '7 days'`,
    ),
    check(
      APPROVAL_REQUEST_SECOND_ACCOUNT_CHECK,
      sql`${t.decidedBy} is null or (${t.decidedBy} <> ${t.requestedBy} and (${t.scope} <> 'site' or ${t.decidedBy} <> ${t.target}))`,
    ),
    check(
      "approval_requests_decision",
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null) and (${t.status} in ('approved', 'rejected')) = (${t.decidedBy} is not null)`,
    ),
    uniqueIndex("approval_requests_one_pending")
      .on(t.kind, t.target, t.requestedBy)
      .where(sql`status = 'pending'`),
    index("approval_requests_status_idx").on(t.status, t.expiresAt),
    index("approval_requests_workspace_idx").on(t.workspaceId, t.requestedAt.desc()),
  ],
);
