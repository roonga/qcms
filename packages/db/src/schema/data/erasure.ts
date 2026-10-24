import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { FormId, SessionId } from "@roonga/qcms-core";

/**
 * Erasure tombstones (ADR-17, I11): existence without content. No foreign key to
 * `sessions`, so a tombstone survives retention purging the scrubbed session shell.
 */
export const erasureTombstones = pgTable("erasure_tombstones", {
  sessionId: text("session_id").$type<SessionId>().primaryKey(),
  formId: text("form_id").$type<FormId>().notNull(),
  formVersion: integer("form_version").notNull(),
  erasedAt: timestamp("erased_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reason: text("reason").notNull(),
});
