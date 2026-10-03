import { boolean, text, timestamp, unique } from "drizzle-orm/pg-core";

import type { FormId, LinkId } from "@roonga/qcms-core";

import { forms } from "./forms.js";

import { controlSchema } from "../schemas.js";

/**
 * Server-side state for secure-link tokens (SEC-2, task 010). A valid signature
 * is never sufficient on its own - consumption and revocation are checked here,
 * so a leaked one-time link cannot be replayed and a revoked link stops working
 * immediately. `consumedAt` / `revokedAt` being null means "still usable".
 *
 * **The environment is on the row and is `NOT NULL` (Q46, the thirteenth guard).** A
 * link belongs to exactly one environment, and `data_<env>.sessions` carries a
 * **composite** foreign key on `(link_id, environment)` into the unique key below, so
 * a link minted for one environment cannot start a session in another however the
 * request reached the handler. `NOT NULL` is what makes that a guard rather than a
 * decoration: a composite foreign key under the default `MATCH SIMPLE` is not checked
 * at all when any referencing column is NULL, and the `CHECK` on the other side passes
 * on NULL because SQL comparison with NULL is unknown.
 *
 * This task creates the column and the key and **builds none of the behaviour**.
 * Choosing the environment at minting, requiring it on the API and refusing a token
 * presented under the wrong prefix are **task 066's** (Q19, Q21); `insertSecureLink`
 * here writes the connection's own environment, which is the minimum change that keeps
 * the existing paths working the moment the baseline lands.
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
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** The environment this link belongs to; a `control.environments` name (Q46). */
    environment: text("environment").notNull(),
  },
  (t) => [
    // The referenced key of the composite `data_<env>.sessions` link key. A primary
    // key on `link_id` alone cannot be referenced by a two-column key, so this
    // redundant-looking unique is what makes the thirteenth guard expressible.
    unique("secure_links_link_environment_uq").on(t.linkId, t.environment),
  ],
);
