import { and, asc, eq } from "drizzle-orm";

import type { GroupId, InstanceId, SessionId } from "@roonga/qcms-core";

import { answerGroupInstances, type RosterEvent } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * One row of the append-only roster ledger: an instance was `added` or `removed`.
 *
 * Hand-authored because the branded-id columns degrade to an `error` type through this
 * package's emitted `.d.ts` (issue #5).
 */
export interface RosterEventRow {
  id: string;
  sessionId: SessionId;
  groupId: GroupId;
  instanceId: InstanceId;
  event: RosterEvent;
  /** `null` when the write answered no respondent operation. */
  opToken: string | null;
  occurredAt: Date;
}

export type _RosterEventRowMatchesTable = AssignableTo<
  RosterEventRow,
  typeof answerGroupInstances.$inferSelect
> &
  AssignableTo<typeof answerGroupInstances.$inferSelect, RosterEventRow>;

/**
 * One group's roster as the table records it, which for two of the three count sources is
 * not yet the live roster: truncating it is the caller's job.
 *
 * Both lists must hold each instance id at most once, because the evaluator treats the
 * roster as trusted input.
 */
export interface GroupRoster {
  /**
   * Every instance ever minted, removed ones included: the idempotency ground for
   * minting, so a removed instance is not replaced on the next serve.
   */
  readonly minted: readonly InstanceId[];
  /**
   * Every instance whose latest event is `added`. This is an `open` group's live roster,
   * and the list a `fixed` or `fromAnswer` group's is the first N of.
   */
  readonly present: readonly InstanceId[];
}

const EMPTY_ROSTER: GroupRoster = { minted: [], present: [] };

/**
 * Append one `added` row per instance: the mint. The caller supplies the ids, since which
 * instances to mint is a decision about the live roster.
 *
 * Throws on a batch that repeats an id: the reads would swallow it, so refusing here
 * keeps the caller bug visible rather than half-applied.
 */
export async function addInstances(
  exec: Executor,
  input: {
    sessionId: SessionId;
    groupId: GroupId;
    instanceIds: readonly InstanceId[];
    /** The respondent operation this mint answers, when one did. */
    opToken?: string;
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
        ...(input.opToken !== undefined ? { opToken: input.opToken } : {}),
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      })),
    )
    .returning();
}

/**
 * Append one `removed` row. The instance's answers stay in the ledger and are excluded by
 * the roster. Removing twice is a no-op.
 */
export async function removeInstance(
  exec: Executor,
  input: {
    sessionId: SessionId;
    groupId: GroupId;
    instanceId: InstanceId;
    /** The respondent operation this removal answers. */
    opToken?: string;
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
      ...(input.opToken !== undefined ? { opToken: input.opToken } : {}),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  return row!;
}

/**
 * The full roster history for a session, oldest first.
 *
 * The `id` tiebreaker buys determinism and not causal order: it does not make an `added`
 * row sort before the `removed` row that followed it, and nothing here can, since
 * `occurred_at` is the transaction timestamp. An audit that needs that order reads `event`.
 */
export async function rosterLedger(
  exec: Executor,
  sessionId: SessionId,
): Promise<RosterEventRow[]> {
  return exec
    .select()
    .from(answerGroupInstances)
    .where(eq(answerGroupInstances.sessionId, sessionId))
    .orderBy(
      asc(answerGroupInstances.occurredAt),
      asc(answerGroupInstances.instanceId),
      asc(answerGroupInstances.id),
    );
}

/**
 * Every repeating group this session has a roster row for, each as its minted and present
 * lists in first-`added` order.
 *
 * `occurred_at` is the transaction timestamp and the table carries no sequence, so the
 * `instance_id` tiebreaker is what makes the order total. It is only stable within one
 * mint, so the write side owes at most one mint per group per transaction, stated on
 * `mintForServedGroup` in `apps/api/src/features/responses/roster.ts`.
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

/**
 * Whether this session has already applied a roster-operation token, which is what makes
 * a replayed no-JS roster post a no-op. Scoped to the session, so a token cannot be
 * replayed into another one.
 *
 * The caller must run this and its write inside the session's advisory lock, which is
 * what makes check-then-write one decision and why no database constraint is needed.
 */
export async function rosterOpApplied(
  exec: Executor,
  sessionId: SessionId,
  opToken: string,
): Promise<boolean> {
  const rows = await exec
    .select({ id: answerGroupInstances.id })
    .from(answerGroupInstances)
    .where(
      and(eq(answerGroupInstances.sessionId, sessionId), eq(answerGroupInstances.opToken, opToken)),
    )
    .limit(1);
  return rows.length > 0;
}
