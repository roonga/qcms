import { foreignKey, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId, LinkId, SessionId } from "@roonga/qcms-core";

import { accessMode, sessionStatus } from "../control/enums.js";
import { formVersions } from "../control/forms.js";
import { secureLinks } from "../control/secure-links.js";

/**
 * A respondent session. The `(formId, formVersion)` pair is pinned at creation
 * against `form_versions` and never migrates (I4) - there is no update path for
 * it. `linkId` is set only for `secure_link` access.
 *
 * **Data plane, one copy per environment (ADR-40).** Declared unqualified, so the
 * connection's `search_path` (`data_<env>, control`) chooses which environment's copy
 * a helper reaches and no helper can name an environment it was not given a pool for.
 *
 * **The thirteenth guard lives here (Q46).** `environment` is `NOT NULL`, the link key
 * is **composite** on `(link_id, environment)` into `control.secure_links`, and each
 * environment schema adds `CHECK (environment = '<env>')` - that last one per schema,
 * so it is emitted by the generator rather than declared here, because the literal
 * differs per copy. A **public session has a NULL `link_id`** and skips the composite
 * key entirely under `MATCH SIMPLE`, which is correct: there is no link row for it to
 * agree with. What still pins it to its schema is the `CHECK`, which is why that half
 * has to hold on its own and why `environment` is `NOT NULL` though `link_id` is not.
 */
export const sessions = pgTable(
  "sessions",
  {
    sessionId: text("session_id").$type<SessionId>().primaryKey(),
    formId: text("form_id").$type<FormId>().notNull(),
    formVersion: integer("form_version").notNull(),
    accessMode: accessMode("access_mode").notNull(),
    linkId: text("link_id").$type<LinkId>(),
    /**
     * The environment this session lives in, pinned to the schema holding the row by
     * the generator's `CHECK (environment = '<env>')`. `NOT NULL`, because a CHECK
     * passes on NULL and a `MATCH SIMPLE` composite key is skipped on NULL, so a
     * nullable column would leave both halves of the guard open.
     */
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
    // Q46: composite, so the link's own row has to agree about the environment. It
    // replaces the single-column `link_id` reference the table carried before, which
    // could be satisfied by a link minted for another environment.
    foreignKey({
      columns: [t.linkId, t.environment],
      foreignColumns: [secureLinks.linkId, secureLinks.environment],
      name: "sessions_secure_link_fk",
    }),
    // Drives the retention sweep: find non-terminal sessions past expiry.
    index("sessions_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);
