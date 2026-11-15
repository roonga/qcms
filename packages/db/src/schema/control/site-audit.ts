import { sql } from "drizzle-orm";
import { check, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * The site audit, append-only in the access audit's precedent shape: `UPDATE` and `DELETE` are revoked from
 * every `qcms_app%` role, there is no foreign key anywhere, and no column may carry a credential, an answer
 * value or `LocalizedText` content, `detail` included. Only the control pool reaches this table.
 */

/** The audited kinds of site-level act. `detail` names the act within a kind. */
export const SITE_AUDIT_KINDS = [
  /** An account created, disabled, reactivated, reset, or granted something while unclaimed. */
  "account",
  /** A Site administrator promoted or demoted. */
  "administrator",
  /** A site approval request created, approved, rejected or expired. */
  "approval",
  /** A workspace marked or unmarked as the shared question library. */
  "library",
] as const;

/** One of {@link SITE_AUDIT_KINDS}. */
export type SiteAuditKind = (typeof SITE_AUDIT_KINDS)[number];

/** The name of the CHECK that pins {@link SITE_AUDIT_KINDS} at the database. */
export const SITE_AUDIT_KIND_CHECK = "site_audit_kind";

/** The table name, for the grant emitter and the migration that creates it. */
export const SITE_AUDIT_TABLE = "site_audit";

/** One row per audited site-level act on accounts, Site administrators or the shared library. */
export const siteAudit = controlSchema.table(
  SITE_AUDIT_TABLE,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `user.id` of the Site administrator who performed the act, or the IdP subject. */
    actor: text("actor").notNull(),
    /** The account, workspace or request the act was on, where it names one. */
    subject: text("subject"),
    /** Set where the act affects one workspace, which is where the mirrored row goes. */
    workspaceId: text("workspace_id"),
    kind: text("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * The act within its kind and its scope, as `key=value` free text. Only a person reads
     * it; nothing branches on it.
     */
    detail: text("detail"),
  },
  (t) => [
    check(
      SITE_AUDIT_KIND_CHECK,
      sql`${t.kind} in ('account', 'administrator', 'approval', 'library')`,
    ),
  ],
);
