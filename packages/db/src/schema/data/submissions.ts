import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { LockedSubmission, SessionId } from "@roonga/qcms-core";

import { sessions } from "./sessions.js";

/**
 * The submission lock - the audit boundary (I6, I9), one row per session. Immutable by
 * convention; the kernel owns the lock.
 *
 * A flagged submission is accepted with the usual success-shaped response but withheld
 * from delivery: no `response.submitted` event is enqueued until an admin unflags it.
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
  /** `NULL` is a clean submission. */
  flaggedReason: text("flagged_reason"),
});
