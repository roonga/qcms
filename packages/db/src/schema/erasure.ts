import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId, SessionId } from "@qcms/core";

/**
 * Erasure tombstones (ADR-17, I11). Erasing a session hard-deletes its answer
 * ledger and submission (and scrubs the retained session shell) and writes one
 * of these rows: it preserves that a response existed - and against which form
 * version - without preserving any content. The reporting view excludes erased
 * sessions by construction. No foreign key to `sessions`: the tombstone is
 * independent of the session row and survives even if retention later purges
 * that scrubbed shell.
 */
export const erasureTombstones = pgTable("erasure_tombstones", {
  sessionId: text("session_id").$type<SessionId>().primaryKey(),
  formId: text("form_id").$type<FormId>().notNull(),
  formVersion: integer("form_version").notNull(),
  erasedAt: timestamp("erased_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reason: text("reason").notNull(),
});
