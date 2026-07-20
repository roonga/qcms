import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { AnswerValue, QuestionId, SessionId } from "@qcms/core";

import { sessions } from "./sessions.js";

/**
 * The append-only answer ledger (I5, R3). Every answer is an INSERT; the current
 * value for a question is the latest row by `answered_at`. There is no UPDATE
 * path in any query helper, and a BEFORE UPDATE trigger (`answers_reject_update`,
 * migration 0001) rejects UPDATE at the database level as a backstop. DELETE is
 * guarded by a BEFORE DELETE trigger (`answers_reject_delete`, migration 0004)
 * that rejects any delete unless a transaction-local setting is opened by one of
 * the two sanctioned whole-session delete doors: GDPR erasure (`eraseSession`,
 * ADR-17, task 016) and retention purge of expired-never-submitted sessions
 * (`purgeExpired`, task 015). No partial or ad-hoc answer deletion is possible.
 *
 * `questionId` is not a foreign key: an answer references the question pinned in
 * the session's form version, not a mutable row in the question library.
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
    value: jsonb("value").$type<AnswerValue>().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Latest-per-question resolution (I5): scan a session's answers for a
    // question, newest first.
    index("answers_session_question_answered_at_idx").on(
      t.sessionId,
      t.questionId,
      t.answeredAt.desc(),
    ),
  ],
);
