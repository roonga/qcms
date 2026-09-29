import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { AnswerValue, InstanceId, QuestionId, SessionId } from "@roonga/qcms-core";

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
 *
 * **Retraction rows (ADR-33).** A respondent who clears an answered question
 * appends a *retraction*: `retracted = true` and `value = null`. It is an
 * ordinary append (no row is mutated or deleted, so R3/ADR-17 hold) that
 * `latestAnswers` resolves to "unanswered" while `answerLedger` keeps showing it.
 * A database CHECK (`answers_retraction_value`, migration 0009) makes the two
 * shapes mutually exclusive: an answer always carries a value, a retraction never
 * does. The retraction is a ledger event, never an `AnswerValue` - no sentinel is
 * ever stored inside `value`, so author-supplied content can never collide with
 * it and the kernel never sees a null answer.
 *
 * **Repeating groups widen the key by one column (ADR-42, task 072).**
 * `instance_id` is nullable and absent for every question outside a repeating
 * group, so a row written before migration 0022 and a row written after it for an
 * unrepeated question are the same row. The current-value rule becomes latest per
 * `(question_id, instance_id)`, which is one more key in `latestAnswers`'s
 * `DISTINCT ON` and one more column in the index below, before `answered_at`.
 *
 * **The value is never touched.** Migration 0009's own rationale is the
 * precedent: a sentinel inside the `value` JSON was refused because it could
 * collide with author-supplied content and would force every reader to sniff for
 * it. An instance index encoded inside `value`, or inside `question_id`, is the
 * same mistake, so it is a column of its own. The three existing guards
 * (`answers_reject_update`, `answers_reject_delete`, `answers_retraction_value`)
 * are unchanged and cover the new column by construction: a retraction is per
 * `(question, instance)`, which is exactly what clearing one table cell needs
 * (ADR-33's Note).
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
    /**
     * Which instance of a repeating group this answer belongs to, or `null` for
     * a question outside every group (ADR-42). Nullable rather than defaulted:
     * "outside a group" is an absence, not a sentinel instance.
     */
    instanceId: text("instance_id").$type<InstanceId>(),
    value: jsonb("value").$type<AnswerValue>(),
    retracted: boolean("retracted").notNull().default(false),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Latest-per-cell resolution (I5): scan a session's answers for a question
    // in one instance, newest first. `instance_id` sits before `answered_at` so
    // the leading columns are exactly the `DISTINCT ON` key; the index keeps its
    // name, because it is the same index serving the same read one column wider
    // (a question outside every group has one `instance_id` value, NULL).
    index("answers_session_question_answered_at_idx").on(
      t.sessionId,
      t.questionId,
      t.instanceId,
      t.answeredAt.desc(),
    ),
  ],
);
