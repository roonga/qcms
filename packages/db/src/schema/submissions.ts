import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { LockedSubmission, SessionId } from "@qcms/core";

import { sessions } from "./sessions.js";

/**
 * The submission lock — the audit boundary (I6, I9). One row per session; holds
 * the locked answer set, its content hash (canonicalization contract, task 009),
 * and the submit timestamp. Immutable by convention (the domain never re-submits
 * a session); the kernel owns the lock.
 *
 * `flaggedReason` records an anti-abuse signal that fired at submit (task 020):
 * `NULL` is a clean submission, a non-null reason (e.g. `"honeypot"`,
 * `"too_fast"`) means the submission was accepted with the same success-shaped
 * response the respondent always sees but is **withheld from webhook delivery**
 * pending review — the `response.submitted` outbox event is not enqueued for a
 * flagged submission (revisited in 035; released by the admin unflag in 023).
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
  /** Anti-abuse flag reason; `NULL` = clean, non-null = flagged and withheld. */
  flaggedReason: text("flagged_reason"),
});
