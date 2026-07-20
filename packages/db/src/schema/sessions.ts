import { foreignKey, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId, LinkId, SessionId } from "@qcms/core";

import { accessMode, sessionStatus } from "./enums.js";
import { formVersions } from "./forms.js";
import { secureLinks } from "./secure-links.js";

/**
 * A respondent session. The `(formId, formVersion)` pair is pinned at creation
 * against `form_versions` and never migrates (I4) - there is no update path for
 * it. `linkId` is set only for `secure_link` access.
 */
export const sessions = pgTable(
  "sessions",
  {
    sessionId: text("session_id").$type<SessionId>().primaryKey(),
    formId: text("form_id").$type<FormId>().notNull(),
    formVersion: integer("form_version").notNull(),
    accessMode: accessMode("access_mode").notNull(),
    linkId: text("link_id")
      .$type<LinkId>()
      .references(() => secureLinks.linkId),
    status: sessionStatus("status").notNull().default("created"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.formId, t.formVersion],
      foreignColumns: [formVersions.formId, formVersions.version],
      name: "sessions_form_version_fk",
    }),
    // Drives the retention sweep: find non-terminal sessions past expiry.
    index("sessions_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);
