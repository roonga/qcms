import { and, asc, eq } from "drizzle-orm";

import type { GroupId, InstanceId, SessionId } from "@roonga/qcms-core";

import { answerGroupInstances, type RosterEvent } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * One row of the append-only roster ledger (ADR-42, task 072): an instance was
 * minted (`added`) or a respondent removed it (`removed`). A database CHECK
 * (`answer_group_instances_event`, migration 0022) keeps the vocabulary to those
 * two words, so a reader that branches on `event` cannot meet a third.
 *
 * Hand-authored for the reason {@link AnswerRow} is (issue #5): the branded-id
 * columns resolve to a TypeScript `error` type through this package's emitted
 * `.d.ts` when consumed via `$inferSelect`, so consumers would see unsafe member
 * access. Keep every field in lockstep with the `answer_group_instances` table in
 * `schema/answer-group-instances.ts`; the drift guard below fails the build if
 * they diverge.
 */
export interface RosterEventRow {
  id: string;
  sessionId: SessionId;
  groupId: GroupId;
  instanceId: InstanceId;
  event: RosterEvent;
  occurredAt: Date;
}

// Drift guard (issue #5), the twin of `_AnswerRowMatchesTable`: assert
// RosterEventRow is structurally identical to what Drizzle infers from the
// `answer_group_instances` table. `$inferSelect` resolves soundly here in the
// package source; it only degrades through the emitted `.d.ts`.
export type _RosterEventRowMatchesTable = AssignableTo<
  RosterEventRow,
  typeof answerGroupInstances.$inferSelect
> &
  AssignableTo<typeof answerGroupInstances.$inferSelect, RosterEventRow>;

/**
 * One group's roster as the **table** records it, which is not yet the live
 * roster for two of the three count sources (ADR-42, `plan/repeating-groups-and-table-input.md`
 * section 5.2). Truncating this to the live set is the API's job and depends on
 * the group's count source; this read is count-blind on purpose, so the same
 * query serves all three and the derivation is one testable step above it.
 *
 * **Both lists hold each instance id at most once**, and that is a contract this
 * package owes rather than a property of the rows. The evaluator treats the
 * roster it is handed as trusted input, so an id appearing twice in one group
 * would give it duplicate `visible` entries for every member question of that
 * instance; the guarantee therefore lives here and at the derivation above, not
 * in the kernel. {@link readRosters} and {@link readRoster} hold it **by
 * construction**: an instance enters `minted` at its **first** `added` row and
 * never again, whatever the table holds, and `present` is a filter of `minted`.
 * A second `added` row for an instance already minted is therefore a no-op rather
 * than a duplicate, which is also what makes a replayed mint harmless.
 */
export interface GroupRoster {
  /**
   * Every instance **ever minted** for the group, in first-`added` order,
   * removed ones included.
   *
   * This is the idempotency ground for minting: an `open` group that mints one
   * instance on first serve and has it removed must not mint a replacement on
   * the next serve, so "have we minted enough" is asked of what was ever minted
   * rather than of what is still present.
   */
  readonly minted: readonly InstanceId[];
  /**
   * Every instance whose **latest event is `added`**, in first-`added` order:
   * the event record's own live set. It is exactly the live roster of an `open`
   * group, and the list a `fixed` or `fromAnswer` group's live roster is the
   * first N of.
   */
  readonly present: readonly InstanceId[];
}

/** The empty roster, for a group with no row at all. */
const EMPTY_ROSTER: GroupRoster = { minted: [], present: [] };

/**
 * Append one `added` row per instance: the mint. INSERT only - the roster is
 * append-only (I5, ADR-42), and a `BEFORE UPDATE` trigger rejects UPDATE at the
 * database level as a backstop.
 *
 * The caller supplies the ids, because minting them is a decision about the live
 * roster (which the API owns) rather than a storage concern, and because a caller
 * that mints N in one call needs to know which N it got.
 *
 * `occurredAt` may be supplied to control ordering (tests, backfills); it
 * defaults to `now()`. Instances minted in one call share a timestamp, which is
 * why {@link readRosters} orders by `(occurred_at, instance_id)` rather than by
 * `occurred_at` alone.
 *
 * **Refuses a batch that repeats an id.** A mint is a statement that these
 * instances are new, so the same id twice in one call is a caller bug rather than
 * an expected failure, and it throws (CONTRIBUTING: exceptions are for bugs, typed
 * results for expected failures). The read above would swallow it - the second
 * `added` row would not re-enter `minted` - so refusing here is what keeps a bug
 * visible instead of silently half-applied.
 */
export async function addInstances(
  exec: Executor,
  input: {
    sessionId: SessionId;
    groupId: GroupId;
    instanceIds: readonly InstanceId[];
    occurredAt?: Date;
  },
): Promise<RosterEventRow[]> {
  if (input.instanceIds.length === 0) return [];
  if (new Set(input.instanceIds).size !== input.instanceIds.length) {
    throw new Error(
      `addInstances: one mint may not repeat an instance id (group ${input.groupId})`,
    );
  }
  return exec
    .insert(answerGroupInstances)
    .values(
      input.instanceIds.map((instanceId) => ({
        sessionId: input.sessionId,
        groupId: input.groupId,
        instanceId,
        event: "added" as const,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      })),
    )
    .returning();
}

/**
 * Append one `removed` row: the respondent took an instance out of an `open`
 * group. An append, never a delete (I6 as ADR-42 reuses it): the instance's
 * answers stay in the ledger and are excluded by the roster, exactly as a hidden
 * question's answers are, and its removal is itself a recorded event.
 *
 * Removing an instance twice appends a second `removed` row and changes nothing:
 * the latest event was already `removed`. That is a no-op rather than an error
 * because the roster is a log, not a state machine with transitions to refuse.
 */
export async function removeInstance(
  exec: Executor,
  input: {
    sessionId: SessionId;
    groupId: GroupId;
    instanceId: InstanceId;
    occurredAt?: Date;
  },
): Promise<RosterEventRow> {
  const [row] = await exec
    .insert(answerGroupInstances)
    .values({
      sessionId: input.sessionId,
      groupId: input.groupId,
      instanceId: input.instanceId,
      event: "removed",
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  return row!;
}

/**
 * The full roster history for a session, oldest first - for audit and for the
 * erasure and retention assertions. Every event is preserved (the table is
 * append-only); use {@link readRosters} for the derived per-group lists.
 */
export async function rosterLedger(
  exec: Executor,
  sessionId: SessionId,
): Promise<RosterEventRow[]> {
  return exec
    .select()
    .from(answerGroupInstances)
    .where(eq(answerGroupInstances.sessionId, sessionId))
    .orderBy(asc(answerGroupInstances.occurredAt), asc(answerGroupInstances.id));
}

/**
 * Every repeating group this session has a roster row for, each as its minted and
 * present lists in first-`added` order.
 *
 * **The ordering tiebreaker is `instance_id`, and it is load-bearing.** A mint of
 * several instances in one call is one statement in one transaction, so every row
 * it writes shares a timestamp to the microsecond, and `occurred_at` alone is not
 * a total order over them. The table's column set is fixed by ADR-42 and carries
 * no sequence, so the tiebreaker has to come from a column that is there: within
 * one group `instance_id` is unique across `added` rows (an instance is minted
 * once), so `(occurred_at, instance_id)` is total and stable. Instances minted
 * together are interchangeable - all fresh, none answered - so ordering them by
 * id rather than by an unrecorded intent costs nothing and makes every later read
 * return the same roster, which is what a `fromAnswer` count lowered and raised
 * again depends on.
 *
 * One query for the whole session rather than one per group: a step's rosters are
 * read together on every serve, and a per-group read would be N round trips for
 * the one index scan this takes.
 */
export async function readRosters(
  exec: Executor,
  sessionId: SessionId,
): Promise<ReadonlyMap<GroupId, GroupRoster>> {
  const rows = await exec
    .select({
      groupId: answerGroupInstances.groupId,
      instanceId: answerGroupInstances.instanceId,
      event: answerGroupInstances.event,
    })
    .from(answerGroupInstances)
    .where(eq(answerGroupInstances.sessionId, sessionId))
    .orderBy(
      asc(answerGroupInstances.groupId),
      asc(answerGroupInstances.occurredAt),
      asc(answerGroupInstances.instanceId),
    );

  // Two passes over the rows, not two queries: the first fixes mint order, the
  // second resolves each instance's latest event under that same ordering.
  const minted = new Map<GroupId, InstanceId[]>();
  const latest = new Map<string, RosterEvent>();
  for (const row of rows) {
    if (row.event === "added" && !latest.has(`${row.groupId}\u0000${row.instanceId}`)) {
      const list = minted.get(row.groupId);
      if (list === undefined) minted.set(row.groupId, [row.instanceId]);
      else list.push(row.instanceId);
    }
    latest.set(`${row.groupId}\u0000${row.instanceId}`, row.event);
  }

  const rosters = new Map<GroupId, GroupRoster>();
  for (const [groupId, instances] of minted) {
    rosters.set(groupId, {
      minted: instances,
      present: instances.filter(
        (instanceId) => latest.get(`${groupId}\u0000${instanceId}`) === "added",
      ),
    });
  }
  return rosters;
}

/** One group's roster, or the empty one when the session has no row for it. */
export async function readRoster(
  exec: Executor,
  sessionId: SessionId,
  groupId: GroupId,
): Promise<GroupRoster> {
  const rows = await exec
    .select({
      instanceId: answerGroupInstances.instanceId,
      event: answerGroupInstances.event,
    })
    .from(answerGroupInstances)
    .where(
      and(eq(answerGroupInstances.sessionId, sessionId), eq(answerGroupInstances.groupId, groupId)),
    )
    .orderBy(asc(answerGroupInstances.occurredAt), asc(answerGroupInstances.instanceId));

  const minted: InstanceId[] = [];
  const latest = new Map<InstanceId, RosterEvent>();
  for (const row of rows) {
    if (row.event === "added" && !latest.has(row.instanceId)) minted.push(row.instanceId);
    latest.set(row.instanceId, row.event);
  }
  if (minted.length === 0) return EMPTY_ROSTER;
  return {
    minted,
    present: minted.filter((instanceId) => latest.get(instanceId) === "added"),
  };
}
