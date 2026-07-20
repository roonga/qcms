import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { LockedSubmission, SessionId } from "@qcms/core";

import { sessions } from "./sessions.js";

/**
 * The submission lock — the audit boundary (I6, I9). One row per session; holds
 * the locked answer set, its content hash (canonicalization contract, task 009),
 * and the submit timestamp. Immutable by convention (the domain never re-submits
 * a session); the kernel owns the lock.
 */
export const submissions = pgTable("submissions", {
  sessionId: text("session_id")
    .$type<SessionId>()
    .primaryKey()
    .references(() => sessions.sessionId),
  contentHash: text("content_hash").notNull(),
  lockedAnswers: jsonb("locked_answers").$type<LockedSubmission>().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
