import { boolean, text, timestamp, unique } from "drizzle-orm/pg-core";

import type { FormId, LinkId } from "@roonga/qcms-core";

import { forms } from "./forms.js";

import { controlSchema } from "../schemas.js";

/**
 * Server-side state for secure-link tokens. A valid signature is never sufficient alone (SEC-2): consumption
 * and revocation are checked here. `environment` is `NOT NULL` because a `MATCH SIMPLE` composite foreign key
 * is unchecked when a referencing column is NULL, and the `sessions` side's `CHECK` passes on NULL too.
 */
export const secureLinks = controlSchema.table(
  "secure_links",
  {
    linkId: text("link_id").$type<LinkId>().primaryKey(),
    formId: text("form_id")
      .$type<FormId>()
      .notNull()
      .references(() => forms.formId),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    oneTime: boolean("one_time").notNull().default(false),
    /** Null means still usable. */
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    environment: text("environment").notNull(),
  },
  (t) => [
    // The referenced key of the composite `data_<env>.sessions` link key: a primary key on
    // `link_id` alone cannot be referenced by a two-column key.
    unique("secure_links_link_environment_uq").on(t.linkId, t.environment),
  ],
);
