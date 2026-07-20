import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId } from "@qcms/core";

import { forms } from "./forms.js";

/**
 * Webhook endpoints an author configures per form (SEC-6, tasks 024/025). The
 * deliverer (025) posts `response.submitted` events to every `active` row and
 * signs each with the row's secret.
 *
 * **The secret is stored encrypted at rest, never hashed** (SEC-6/SEC-8): 025
 * must recover the plaintext to compute the `X-QCMS-Signature` HMAC, so a
 * one-way hash would make signing impossible. `secretEncrypted` holds
 * AES-256-GCM ciphertext (random IV + tag) under `QCMS_APP_KEY`, produced by the
 * shell's webhook-crypto module - the database only ever sees opaque bytes and
 * never the plaintext. The secret is shown to the author exactly once (on create
 * and on explicit rotation) and masked everywhere else.
 *
 * Soft-deactivation: `DELETE` sets `active = false` and stamps `deactivatedAt`
 * rather than removing the row, so delivery history and audit references survive.
 * `webhookId` is a `whk_`-prefixed opaque id minted by the shell (config
 * infrastructure - it never flows through the kernel, so it is a plain string,
 * not a branded domain id).
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
