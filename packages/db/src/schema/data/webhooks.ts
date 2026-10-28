import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId } from "@roonga/qcms-core";

import { forms } from "../control/forms.js";

/**
 * Webhook endpoints an author configures per form (SEC-6); the deliverer posts to every `active` row.
 * The secret is encrypted at rest and never hashed (SEC-6, SEC-8) because the deliverer needs the plaintext
 * for the HMAC; it is shown once and masked elsewhere. `DELETE` soft-deactivates.
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
