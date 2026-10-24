import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { GroupId, InstanceId, SessionId } from "@roonga/qcms-core";

import { sessions } from "./sessions.js";

/** An instance was minted, or a respondent removed it. */
export const ROSTER_EVENTS = ["added", "removed"] as const;

/** One of {@link ROSTER_EVENTS}. */
export type RosterEvent = (typeof ROSTER_EVENTS)[number];

/**
 * The append-only roster of repeating-group instances (ADR-42).
 *
 * The event record, not the live roster: liveness is derived from the group's count source
 * in `apps/api/src/features/responses/roster.ts`, and only an `open` group's live set is
 * this record itself.
 *
 * Append-only. `answer_group_instances_reject_delete` honours the same
 * `qcms.allow_answer_delete` door as the answer ledger, so this adds no third delete door.
 *
 * `groupId` carries no foreign key: it names a group pinned in the session's form version,
 * not a row in a mutable library.
 */
export const answerGroupInstances = pgTable(
  "answer_group_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id")
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.sessionId),
    groupId: text("group_id").$type<GroupId>().notNull(),
    instanceId: text("instance_id").$type<InstanceId>().notNull(),
    event: text("event").$type<RosterEvent>().notNull(),
    /**
     * A roster POST answers with a re-render rather than a redirect, so a reload or Back
     * would replay it and add a second instance. The token the page minted is recorded
     * here, and a token already present makes the operation a no-op. One row per token is
     * checked in the API inside the session's advisory lock, not in SQL.
     */
    opToken: text("op_token"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("answer_group_instances_session_group_occurred_at_idx").on(
      t.sessionId,
      t.groupId,
      t.occurredAt,
    ),
    check("answer_group_instances_event", sql`${t.event} IN ('added', 'removed')`),
  ],
);
