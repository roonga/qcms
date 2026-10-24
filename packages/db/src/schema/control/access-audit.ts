import { sql } from "drizzle-orm";
import { check, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * The access audit (SEC-15), append-only: `UPDATE` and `DELETE` are revoked from every
 * `qcms_app%` role, and no column may carry an answer value, a respondent identifier or
 * `LocalizedText` content, `detail` included. No foreign key anywhere, so a row cannot
 * cascade away with the thing it describes.
 */

/** The audited kinds of act. */
export const ACCESS_AUDIT_KINDS = [
  "read",
  "export",
  "erasure",
  "grant",
  "revoke",
  "setting",
] as const;

/** One of {@link ACCESS_AUDIT_KINDS}. */
export type AccessAuditKind = (typeof ACCESS_AUDIT_KINDS)[number];

/** The name of the CHECK that pins {@link ACCESS_AUDIT_KINDS} at the database. */
export const ACCESS_AUDIT_KIND_CHECK = "access_audit_kind";

/** The table name, for the grant emitters and the migration that creates it. */
export const ACCESS_AUDIT_TABLE = "access_audit";

/** One row per audited act on response data or the grants that reach it. */
export const accessAudit = controlSchema.table(
  ACCESS_AUDIT_TABLE,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `user.id`, or the IdP subject under single sign-on. */
    actor: text("actor").notNull(),
    /** The workspace the act was performed in, or whose form owns the data read. */
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment"),
    formId: text("form_id"),
    kind: text("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * The scope of a grant or revoke, or a setting's name and new value. Free text because
     * only a person reads it; nothing branches on it.
     */
    detail: text("detail"),
  },
  (t) => [
    check(
      ACCESS_AUDIT_KIND_CHECK,
      sql`${t.kind} in ('read', 'export', 'erasure', 'grant', 'revoke', 'setting')`,
    ),
  ],
);
