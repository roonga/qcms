import { foreignKey, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId, LinkId, SessionId } from "@roonga/qcms-core";

import { accessMode, sessionStatus } from "../control/enums.js";
import { formVersions } from "../control/forms.js";
import { secureLinks } from "../control/secure-links.js";

/**
 * A respondent session. The `(formId, formVersion)` pair is pinned at creation and never
 * migrates (I4); `linkId` is set only for `secure_link` access.
 *
 * A public session has a NULL `link_id` and so skips the composite link key entirely under
 * `MATCH SIMPLE`, leaving the generator's per-schema `CHECK (environment = '<env>')` to
 * hold on its own. That is why `environment` is `NOT NULL` though `link_id` is not.
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
