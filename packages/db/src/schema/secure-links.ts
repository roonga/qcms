import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId, LinkId } from "@qcms/core";

import { forms } from "./forms.js";

/**
 * Server-side state for secure-link tokens (SEC-2, task 010). A valid signature
 * is never sufficient on its own - consumption and revocation are checked here,
 * so a leaked one-time link cannot be replayed and a revoked link stops working
 * immediately. `consumedAt` / `revokedAt` being null means "still usable".
 */
export const secureLinks = pgTable("secure_links", {
  linkId: text("link_id").$type<LinkId>().primaryKey(),
  formId: text("form_id")
    .$type<FormId>()
    .notNull()
    .references(() => forms.formId),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  oneTime: boolean("one_time").notNull().default(false),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
