import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId } from "@roonga/qcms-core";

import { forms } from "../control/forms.js";

/**
 * Webhook endpoints an author configures per form (SEC-6). The deliverer posts to every
 * `active` row and signs with the row's secret.
 *
 * The secret is encrypted at rest and never hashed (SEC-6, SEC-8), because the deliverer
 * must recover the plaintext to compute the HMAC; it is shown to the author once and
 * masked everywhere else. `DELETE` soft-deactivates, so delivery history survives.
 */
export const webhooks = pgTable("webhooks", {
  webhookId: text("webhook_id").primaryKey(),
  formId: text("form_id")
    .$type<FormId>()
    .notNull()
    .references(() => forms.formId),
  url: text("url").notNull(),
  /** AES-256-GCM ciphertext of the secret (versioned `v1.<base64(iv||ct||tag)>`). */
  secretEncrypted: text("secret_encrypted").notNull(),
  active: boolean("active").notNull().default(true),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
