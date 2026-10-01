/**
 * The live-roster derivation (task 072, ADR-42, `plan/repeating-groups-and-table-input.md`
 * section 5.2).
 *
 * `answer_group_instances` records what was **minted** and what was **explicitly
 * removed**. It is not the live roster for two of the three count sources, and
 * that is the whole of this module: liveness is a function of the count source,
 * and this is where the function lives.
 *
 * | Count source | The live roster is                                                  | Who shortens it                        |
 * | ------------ | ------------------------------------------------------------------- | -------------------------------------- |
 * | `open`       | every instance whose latest event is `added`, in first-`added` order | nobody; removal is an explicit row     |
 * | `fixed`      | the first `count` of that list                                       | this module, against the group's count |
 * | `fromAnswer` | the first N of that list, N the count answer clamped to min and max  | this module, against the count answer  |
 *
 * **Where it runs: in the API, above `evaluateRules`.** The `rosters` map the
 * evaluator receives is already truncated and ordered, so the evaluator stays a
 * pure function of what it is handed and determinism (I7) is checkable at its
 * boundary: the same `(snapshot, answers, rosters)` gives the same `FlowState`,
 * and the truncation is a separate, testable step whose own inputs are the roster
 * table and the count answer.
 *
 * That is also what makes ADR-42's two asymmetric behaviours fall out rather than
 * be special-cased. Lowering a `fromAnswer` count hides the trailing instance with
 * **no** `removed` row, so raising it again re-lives the **same** instance with
 * its answers intact; a removed `open` instance has a `removed` row and is gone
 * for good, and an added replacement is a new id (Q5, ruled 2026-09-29). Neither
 * path ever deletes an answer: a removed instance's answers stay in the ledger and
 * are excluded from evaluation, from the locked submission and from reporting
 * exactly as a hidden question's are (I6).
 *
 * **The roster this module produces never holds one instance id twice**, per
 * group per session. The kernel treats the roster it is handed as a trusted
 * input: given an id twice it evaluates that instance twice and returns duplicate
 * `visible` and `missingRequired` entries and a duplicated instance in the locked
 * submission, with no error raised anywhere. The guarantee is therefore owed
 * here, and it is held twice over - `readRosters` admits an instance at its first
 * `added` row and never again, and {@link liveInstances}, the one seam where a
 * `RosterMap` is built, deduplicates before it truncates. The mint side is closed
 * too: a fresh id is generated against the ids already in the group.
 *
 * **It is held in code and not by a database constraint, and that is ruled rather
 * than pending** (Code Owner, 2026-09-30). The invariant is cross-row ("at most
 * one `added` row per `(session, group, instance)`"), so the only shapes that
 * express it in SQL are a partial UNIQUE index or a third trigger, and either
 * would be a **fifth guard** on a table ADR-40's amendment counts four for,
 * taking that record's per-environment totals from seventeen guards and
 * twenty-five objects to eighteen and twenty-six. Those totals are the reconciled
 * figures task 064 checks its generator against, and the ruling keeps them:
 * **ADR-40 stays at seventeen guards, eight foreign keys and twenty-five
 * objects**, and no constraint is added. So the three points above are the whole
 * of the mechanism rather than a stopgap, which is why each one carries a test.
 *
 * **What this module does not do.** It does not serve a step, render anything or
 * decide an HTTP envelope; the serving loop and both respondent paths are task
 * 073, which calls {@link mintForServedGroup}, {@link addRosterInstance} and
 * {@link removeRosterInstance} from its routes and maps
 * {@link RosterRefusalCode} onto its own error envelope.
 */

import {
  countBounds,
  type AnswerMap,
  type AnswerValue,
  type GroupId,
  type InstanceId,
  type RepeatCount,
  type RepeatGroup,
  type RosterMap,
  type SessionId,
  type Step,
  repeatGroups,
} from "@roonga/qcms-core";
import {
  addInstances,
  type Executor,
  type GroupRoster,
  readRoster,
  readRosters,
  removeInstance,
} from "@roonga/qcms-db";

/**
 * A fresh, branded instance id: `ins_` + 16 random hex bytes (matches
 * `^ins_[a-z0-9_]+$`). Minted once per instance, never reused across sessions and
 * never renumbered within one - the ordinal a respondent reads ("Passenger 2") is
 * the instance's position in the live roster and is presentation only (ADR-42).
 *
 * Spelled exactly as `newSessionId` in the start-session slice: `crypto`, not
 * `node:crypto`, so the handler path stays Fetch API pure (R4).
 */
export function newInstanceId(): InstanceId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ins_${hex}` as InstanceId;
}

/**
 * `count` fresh instance ids, none of them equal to one already in `taken` and
 * none equal to another.
 *
 * 16 random bytes make a repeat a 128-bit collision, so this loop is not a
 * probability play: it is what makes "a roster never holds the same instance id
 * twice" a property of the mint rather than a property of the random source. The
 * evaluator treats the roster as trusted input, so the cost of being wrong once
 * is a silently duplicated instance in the flow and in the locked submission.
 */
function mintDistinct(count: number, taken: Iterable<InstanceId>): InstanceId[] {
  const seen = new Set<InstanceId>(taken);
  const fresh: InstanceId[] = [];
  while (fresh.length < count) {
    const candidate = newInstanceId();
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    fresh.push(candidate);
  }
  return fresh;
}

/**
 * The answer to a `fromAnswer` group's count question, as a count: a finite
 * number floored to an integer, or `undefined` when the question is unanswered or
 * holds anything else.
 *
 * The count question is pinned **outside** every group (a group may not contain a
 * group, and publish refuses a count question that does not precede the group's
 * whole span), so it is keyed by a bare `questionId` in the answer map and never
 * instance-qualified.
 *
 * A non-number is treated as unanswered rather than as an error. Publish already
 * refuses a count question that is not a `number` question
 * (`REPEAT_COUNT_NOT_A_NUMBER`), so this branch is unreachable on a published
 * snapshot; it is here because this function is total over unvalidated input, in
 * the same spirit as the evaluator's totality extensions.
 */
function countAnswerOf(count: RepeatCount, answers: AnswerMap): number | undefined {
  if (count.source !== "fromAnswer") return undefined;
  const value: AnswerValue | undefined = answers.get(count.questionId);
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

function clamp(value: number, min: number, max: number | undefined): number {
  const floored = Math.max(value, min);
  return max === undefined ? floored : Math.min(floored, max);
}

/**
 * How many instances the live roster may hold, or `undefined` when the count
 * source sets no length at all.
 *
 * `open` returns `undefined`: its live set **is** the event record, and the
 * group's `max` bounds what may be added (SEC-16, enforced on the add) rather than
 * what is live now. Truncating an `open` group here would silently hide an
 * instance the respondent can see, which is the opposite of what removal means for
 * that source.
 */
export function liveInstanceLimit(count: RepeatCount, answers: AnswerMap): number | undefined {
  if (count.source === "open") return undefined;
  if (count.source === "fixed") return count.count;
  const answered = countAnswerOf(count, answers);
  // No count answer yet: the count is not known, so nothing is live. `min` is not
  // read in as a floor here, because a floor would make a group live before the
  // respondent had said how big it is; `min` is enforced at submit
  // (`REPEAT_COUNT_OUT_OF_RANGE`) and as the clamp below once an answer exists.
  if (answered === undefined) return 0;
  const bounds = countBounds(count);
  return clamp(answered, bounds.min, bounds.max);
}

/**
 * How many `added` rows a group should have by now: the minting target.
 *
 * Measured against rows **ever minted**, never against the live set, and that is
 * load-bearing in both directions. An `open` group whose only instance the
 * respondent removed must not have a replacement minted on the next serve, which
 * a live-set comparison would do. A `fromAnswer` count lowered from 3 to 2 and
 * raised back to 3 must re-live the instance it already minted rather than mint a
 * fourth, which is what makes its answers come back (acceptance case 18, owned by
 * 071, and the behaviour this function is the storage half of).
 *
 * - `fixed` mints its `count` the first time the group's step is served.
 * - `open` mints `min` instances, or **one** when `min` is 0, the first time its
 *   step is served, so the respondent sees a card to fill rather than an empty
 *   group with a button. Every later instance is an explicit Add.
 * - `fromAnswer` mints nothing at session start, because the count is not known
 *   then; it mints up to the answered N on the write of the count answer and the
 *   difference on each later raise.
 */
export function mintTarget(count: RepeatCount, answers: AnswerMap): number {
  if (count.source === "fixed") return count.count;
  if (count.source === "open") return Math.max(count.min, 1);
  return liveInstanceLimit(count, answers) ?? 0;
}

/**
 * One group's live roster: the present instances, deduplicated, truncated to what
 * the count source allows, in first-`added` order.
 *
 * **No instance id appears twice**, and this is the boundary that owes it. The
 * evaluator treats the roster as a trusted input: handed an id twice it evaluates
 * that instance twice and yields duplicate `visible` entries, duplicate
 * `missingRequired` entries and a duplicated instance in the locked submission,
 * with no error anywhere. `readRosters` already holds the guarantee by
 * construction (an instance enters `minted` at its first `added` row and never
 * again), so this is defence in depth at the one seam where a `RosterMap` is
 * produced, and it is what the contract is asserted against: any future caller
 * building a `GroupRoster` some other way is covered by the same line.
 *
 * Deduplication runs **before** the truncation, so a limit counts distinct
 * instances rather than rows.
 */
export function liveInstances(
  count: RepeatCount,
  roster: GroupRoster | undefined,
  answers: AnswerMap,
): readonly InstanceId[] {
  const present = [...new Set(roster?.present ?? [])];
  const limit = liveInstanceLimit(count, answers);
  return limit === undefined ? present : present.slice(0, limit);
}

/**
 * The `RosterMap` the evaluator is handed: one entry per repeating group the form
 * declares, each already truncated and ordered.
 *
 * Every group gets an entry, including one with no roster row yet, so a caller
 * reading the map cannot tell "no such group" from "a group with nothing in it"
 * by an absent key - the evaluator's own contract already treats a missing entry
 * as empty, and stating it makes the projection 073 builds on total.
 */
export function deriveRosters(
  steps: readonly Step[],
  rosters: ReadonlyMap<GroupId, GroupRoster>,
  answers: AnswerMap,
): RosterMap {
  const live = new Map<GroupId, readonly InstanceId[]>();
  for (const group of repeatGroups(steps)) {
    live.set(group.groupId, liveInstances(group.count, rosters.get(group.groupId), answers));
  }
  return live;
}

/**
 * Read the session's roster rows and derive the live `RosterMap` in one step: the
 * call a serving handler makes beside `latestAnswers` before it evaluates.
 */
export async function loadRosters(
  exec: Executor,
  sessionId: SessionId,
  steps: readonly Step[],
  answers: AnswerMap,
): Promise<RosterMap> {
  return deriveRosters(steps, await readRosters(exec, sessionId), answers);
}

/** Why a roster write was refused. 073 maps this onto its error envelope. */
export type RosterRefusalCode =
  /** An Add on a group whose count source is not `open`: its size is not the
   * respondent's to change. */
  | "REPEAT_NOT_ADDABLE"
  /** An Add that would take the group past the `max` its author declared
   * (SEC-16: the per-form bound is the only bound there is). */
  | "REPEAT_MAX_REACHED";

/** The outcome of a roster write: the instances it minted, or why it refused. */
export type RosterWriteResult =
  | { readonly ok: true; readonly minted: readonly InstanceId[] }
  | { readonly ok: false; readonly code: RosterRefusalCode };

/**
 * Mint whatever the count source says is missing for one group, and return the
 * live roster that results.
 *
 * **Idempotent under replay by construction**: it appends `target - minted.length`
 * rows and nothing when that is not positive, so serving the same step twice mints
 * nothing the second time because the rows are already there. There is no
 * "have we served this before" flag anywhere, which is what makes the property
 * hold across a reload, a resumed session and a retried request alike.
 *
 * Called on the first serve of a group's step for `fixed` and `open`, and on the
 * write of a `fromAnswer` group's count answer. Calling it on every serve is
 * correct and is what 073 does: the extra call is one read of a list the handler
 * already holds.
 *
 * The caller owns the transaction (R5) and is expected to hold the session's
 * advisory lock, as the answer write does: two concurrent serves of one step
 * would otherwise each see an empty roster and each mint a full set.
 *
 * **Contract: call this at most once per group per transaction.** `occurred_at`
 * defaults to `now()`, which in Postgres is the **transaction** timestamp and not
 * the statement's, so two mints for one group inside one transaction write rows
 * sharing a timestamp to the microsecond. The roster read then orders that
 * combined set by its `instance_id` tiebreaker alone (see {@link readRosters} in
 * `packages/db/src/queries/rosters.ts`), and an `instance_id` is 128 random bits,
 * so the two batches interleave at random rather than the second following the
 * first.
 *
 * What that breaks is the first-N guarantee, not merely a display order.
 * {@link liveInstances} takes the **first** N of the minted list for `fixed` and
 * `fromAnswer`, so an instance minted in the earlier batch and already answered
 * can be sorted out of the live window by a later batch's ids. Lowering a
 * `fromAnswer` count and raising it again would then re-live a *different*
 * instance, moving a respondent's answers between cards. That is exactly the
 * property `roster.integration.test.ts` pins in "lowers a fromAnswer count and
 * raises it again, re-living the same instance with its answers intact", and it is
 * why this contract is written down rather than left to be discovered.
 *
 * Keeping to it is cheap and is what 073 does: a serve resolves each group once,
 * and the batch answer endpoint carries a whole step in one transaction (ADR-43),
 * so it mints per group after applying the step's answers rather than once per
 * entry. **Ruled: no ordering column is added** (Code Owner, 2026-10-01). ADR-42
 * fixes this table's column set, and a monotonic column would also be a fifth
 * guard on a table ADR-40's amendment counts four for, moving the per-environment
 * totals the 064 generator is checked against.
 */
export async function mintForServedGroup(
  exec: Executor,
  input: {
    sessionId: SessionId;
    group: RepeatGroup;
    roster: GroupRoster | undefined;
    answers: AnswerMap;
  },
): Promise<readonly InstanceId[]> {
  const minted = input.roster?.minted ?? [];
  const shortfall = mintTarget(input.group.count, input.answers) - minted.length;
  if (shortfall <= 0) {
    return liveInstances(input.group.count, input.roster, input.answers);
  }
  await addInstances(exec, {
    sessionId: input.sessionId,
    groupId: input.group.groupId,
    instanceIds: mintDistinct(shortfall, minted),
  });
  // Re-read rather than splice the fresh ids onto the list in hand. Roster order is
  // `(occurred_at, instance_id)` and every row one mint writes shares a timestamp,
  // so the order of a batch is the read's to decide; assembling it here would give
  // this call a different answer from the next read of the same rows, and a roster
  // that reorders between two reads is exactly what a `fromAnswer` count lowered
  // and raised again must not meet. One extra query, and only on the call that
  // actually minted.
  return liveInstances(
    input.group.count,
    await readRoster(exec, input.sessionId, input.group.groupId),
    input.answers,
  );
}

/**
 * The respondent's Add on an `open` group: one appended `added` row.
 *
 * Refused past the group's `max`, which after the 2026-09-29 ruling that removed
 * every installation-wide ceiling (Q14) is the only bound that exists (SEC-16).
 * The bound is checked against the **live** count rather than the minted one: an
 * instance the respondent removed has freed its place, and counting it would make
 * a group that had been filled and emptied permanently unable to grow.
 *
 * A group whose count source is not `open` refuses the Add outright: a `fixed`
 * group's size is its author's and a `fromAnswer` group's is the count answer's,
 * so there is no Add button on either and a post that names one is drift.
 *
 * **The caller must hold the session's advisory lock**, the same requirement
 * {@link mintForServedGroup} states and for a sharper reason: the `max` check is a
 * read followed by a write, not one atomic statement. Two simultaneous Add posts
 * on one group each read `live.length === max - 1`, each pass the bound, and each
 * append, leaving the group one past the `max` that SEC-16 calls the whole of the
 * mitigation now that Q14 has removed every installation-wide ceiling. The
 * mechanism already exists and needs nothing new: `pg_advisory_xact_lock` keyed on
 * the session, as `serve-step/handler.ts` takes it. **No caller holds it at this
 * head because there is no caller**: nothing outside the tests reaches this
 * function, since 073 owns the routes. This is the contract those routes inherit,
 * and 073 is where a concurrency test belongs, next to the handler that takes the
 * lock.
 *
 * The one-mint-per-group-per-transaction contract on {@link mintForServedGroup}
 * applies here too: an Add is a mint, so a transaction that already minted for
 * this group must not also Add to it.
 */
export async function addRosterInstance(
  exec: Executor,
  input: {
    sessionId: SessionId;
    group: RepeatGroup;
    roster: GroupRoster | undefined;
    answers: AnswerMap;
  },
): Promise<RosterWriteResult> {
  if (input.group.count.source !== "open") return { ok: false, code: "REPEAT_NOT_ADDABLE" };
  const live = liveInstances(input.group.count, input.roster, input.answers);
  const { max } = countBounds(input.group.count);
  if (max !== undefined && live.length >= max) return { ok: false, code: "REPEAT_MAX_REACHED" };
  const instanceId = mintDistinct(1, input.roster?.minted ?? [])[0]!;
  await addInstances(exec, {
    sessionId: input.sessionId,
    groupId: input.group.groupId,
    instanceIds: [instanceId],
  });
  return { ok: true, minted: [instanceId] };
}

/**
 * The respondent's Remove: one appended `removed` row, never a delete (I6).
 *
 * Removing an instance that is not live is a no-op that still appends, because
 * the roster is a log: a second Remove on the same instance records that the
 * respondent pressed it and changes no derived list. Nothing here refuses a
 * removal that would take a group below its `min`; that is a submit-time refusal
 * (`REPEAT_COUNT_OUT_OF_RANGE`, ADR-42), so a respondent can empty a group,
 * rebuild it and only be stopped at the end.
 *
 * **Caller obligation: the `instanceId` must be one this session's roster minted.**
 * This function is not handed the roster, so it cannot check, and a no-op that
 * still appends is only harmless for an id the session owns. A forged `ins_` value
 * appends a `removed` row under a key no roster lists: nothing is disclosed and no
 * derived list moves, but the table is append-only and only an erasure clears it.
 * The caller has the roster in hand already (it needs it to render the Remove
 * control at all), so the check is a lookup, not a query. Task 073 owns the route
 * and implements it, and the same obligation covers `appendAnswer` and
 * `retractAnswer` in `@roonga/qcms-db`.
 */
export async function removeRosterInstance(
  exec: Executor,
  input: {
    sessionId: SessionId;
    groupId: GroupId;
    instanceId: InstanceId;
  },
): Promise<void> {
  await removeInstance(exec, {
    sessionId: input.sessionId,
    groupId: input.groupId,
    instanceId: input.instanceId,
  });
}
