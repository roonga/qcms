import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { AnswerValue, InstanceId, QuestionId, SessionId } from "@roonga/qcms-core";

import { sessions } from "./sessions.js";

/**
 * The append-only answer ledger (I5, R3): the current value is the latest row per `(question_id, instance_id)`.
 * UPDATE is always rejected, DELETE unless opened by a sanctioned whole-session door (`eraseSession`, ADR-17;
 * `purgeExpired`). `questionId` is no foreign key: it names a question pinned in the form version.
 * A cleared answer appends a retraction (ADR-33); no sentinel is ever stored inside `value`.
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
