import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { AnswerValue, InstanceId, QuestionId, SessionId } from "@roonga/qcms-core";

import { sessions } from "./sessions.js";

/**
 * The append-only answer ledger (I5, R3). The current value is the latest row per
 * `(question_id, instance_id)`. `answers_reject_update` rejects every UPDATE, and
 * `answers_reject_delete` rejects every DELETE unless a transaction-local setting is
 * opened by one of the two sanctioned whole-session doors, `eraseSession` (ADR-17) and
 * `purgeExpired`.
 *
 * `questionId` is not a foreign key: an answer references the question pinned in the
 * session's form version, not a mutable row in the question library.
 *
 * A cleared answer appends a retraction (ADR-33) rather than mutating a row. No sentinel is
 * ever stored inside `value`, so author-supplied content cannot collide with one.
 */
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id")
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.sessionId),
    questionId: text("question_id").$type<QuestionId>().notNull(),
    /** `null` for a question outside every repeating group. */
    instanceId: text("instance_id").$type<InstanceId>(),
    value: jsonb("value").$type<AnswerValue>(),
    retracted: boolean("retracted").notNull().default(false),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("answers_session_question_answered_at_idx").on(
      t.sessionId,
      t.questionId,
      t.instanceId,
      t.answeredAt.desc(),
    ),
    check(
      "answers_retraction_value",
      sql`(${t.retracted} AND ${t.value} IS NULL) OR (NOT ${t.retracted} AND ${t.value} IS NOT NULL)`,
    ),
  ],
);
