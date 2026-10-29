import { foreignKey, index, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { FormId } from "@roonga/qcms-core";

import { forms } from "./forms.js";

import { controlSchema } from "../schemas.js";

/** The table name, for the grant emitter and the migration that creates it. */
export const RELEASE_BATCHES_TABLE = "release_batches";

/**
 * The committed result of one publish or release confirmation, keyed on the principal, the
 * form and a client-minted idempotency key (Q89). Only successes are stored, so a refusal
 * leaves the same key free to retry, and retention removes rows rather than a trigger
 * keeping them: this is a replay cache and not an audit record, which `form_releases` is.
 */
export const releaseBatches = controlSchema.table(
  RELEASE_BATCHES_TABLE,
  {
    /** No foreign key, matching `form_releases.released_by`. */
    principalId: text("principal_id").notNull(),
    formId: text("form_id").$type<FormId>().notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    /** sha256 of the canonical request body with the key removed. */
    intentHash: text("intent_hash").notNull(),
    /** The exact 200 body, replayed verbatim when the same key arrives again. */
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.principalId, t.formId, t.idempotencyKey] }),
    foreignKey({
      name: "release_batches_form_fk",
      columns: [t.formId],
      foreignColumns: [forms.formId],
    }),
    index("release_batches_created_idx").on(t.createdAt),
  ],
);
