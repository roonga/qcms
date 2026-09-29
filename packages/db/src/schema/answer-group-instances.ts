import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { GroupId, InstanceId, SessionId } from "@roonga/qcms-core";

import { sessions } from "./sessions.js";

/**
 * The vocabulary of the roster ledger: an instance was minted, or a respondent
 * removed it. A database CHECK (`answer_group_instances_event`, migration 0022)
 * pins the same two words, so a reader that branches on this union cannot meet a
 * third value.
 */
export const ROSTER_EVENTS = ["added", "removed"] as const;
export type RosterEvent = (typeof ROSTER_EVENTS)[number];

/**
 * The append-only roster of repeating-group instances (ADR-42, task 072).
 *
 * **Why a table and not an answer.** Encoding the roster as a synthetic answer
 * keyed by the group id would reuse the ledger and its triggers, and it was
 * weighed and refused (Q16, Code Owner, 2026-09-29): `answers.question_id` would
 * then hold something that is not a `questionId`, which collides with
 * `prepareSubmission`'s `UNKNOWN_QUESTION` ledger-drift defence, with R6's
 * statement of what a `questionId` is, and with the reporting view's contract
 * that a row is a question.
 *
 * **What it records, and what it does not.** Every row is a mint (`added`) or an
 * explicit removal (`removed`). It is **not** the live roster for two of the
 * three count sources: liveness is a function of the count source, derived above
 * `evaluateRules` in the API (`apps/api/src/features/responses/roster.ts`). Only
 * an `open` group's live set is the event record itself; a `fixed` group's is the
 * first `count` of it and a `fromAnswer` group's is the first N for the current
 * count answer, clamped to the group's `min` and `max`. That is what makes a
 * lowered `fromAnswer` count hide the trailing instance with **no** `removed`
 * row, so raising it again re-lives the same instance with its answers intact,
 * while a removed `open` instance is gone for good.
 *
 * **Append-only, with the answer ledger's guards.** A BEFORE UPDATE trigger
 * (`answer_group_instances_reject_update`) rejects every UPDATE, and a BEFORE
 * DELETE trigger (`answer_group_instances_reject_delete`) rejects every DELETE
 * unless the transaction-local `qcms.allow_answer_delete` door is open - the same
 * door, honoured by the same two sanctioned whole-session delete paths,
 * `eraseSession` (ADR-17) and `purgeExpired`. This adds no third delete door.
 *
 * `groupId` carries **no** foreign key, for the reason `answers.question_id`
 * carries none: it names a group pinned in the session's form version, not a row
 * in a mutable library. `sessionId` does, and it is the eighth data-plane foreign
 * key ADR-40's amendment counts.
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
    /**
     * `added` or `removed`. Plain `text` with a CHECK rather than a pgEnum,
     * matching how this package already spells a closed vocabulary that the
     * kernel owns: an enum type is a migration to extend, and the vocabulary is
     * pinned in SQL beside the triggers that keep the rows honest.
     */
    event: text("event").$type<RosterEvent>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The one index the roster read needs: a session's rows for one group,
    // oldest first, which is both the first-`added` order the roster is built in
    // and the order the latest event per instance is resolved by. `id` is not in
    // the index; the read's tiebreaker rides the heap rows it has already
    // fetched. This is the fourth of the four per-environment guards ADR-40's
    // amendment attributes to this table.
    index("answer_group_instances_session_group_occurred_at_idx").on(
      t.sessionId,
      t.groupId,
      t.occurredAt,
    ),
  ],
);
