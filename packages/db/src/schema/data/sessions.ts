import { foreignKey, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId, LinkId, SessionId } from "@roonga/qcms-core";

import { accessMode, sessionStatus } from "../control/enums.js";
import { formVersions } from "../control/forms.js";
import { secureLinks } from "../control/secure-links.js";

/**
 * A respondent session; the `(formId, formVersion)` pair is pinned at creation (I4). A public session has a
 * NULL `link_id` and skips the composite link key under `MATCH SIMPLE`, so `environment` is `NOT NULL` to
 * leave the per-schema `CHECK` holding alone.
 */
export const sessions = pgTable(
  "sessions",
  {
    sessionId: text("session_id").$type<SessionId>().primaryKey(),
    formId: text("form_id").$type<FormId>().notNull(),
    formVersion: integer("form_version").notNull(),
    accessMode: accessMode("access_mode").notNull(),
    linkId: text("link_id").$type<LinkId>(),
    environment: text("environment").notNull(),
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
    // Composite, so the link's own row has to agree about the environment: a single-column
    // reference could be satisfied by a link minted for another environment.
    foreignKey({
      columns: [t.linkId, t.environment],
      foreignColumns: [secureLinks.linkId, secureLinks.environment],
      name: "sessions_secure_link_fk",
    }),
    index("sessions_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);
