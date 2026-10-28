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
  type StepId,
  isRepeatGroup,
  repeatGroups,
} from "@roonga/qcms-core";
import {
  addInstances,
  type Executor,
  type GroupRoster,
  readRoster,
  readRosters,
  removeInstance,
  rosterOpApplied,
} from "@roonga/qcms-db";

/** WebCrypto rather than `node:crypto`: the handler path stays Fetch API pure (R4). */
export function newInstanceId(): InstanceId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ins_${hex}` as InstanceId;
}

/**
 * The evaluator trusts the roster, so a duplicate id would silently duplicate an
 * instance: distinctness is a property of the mint, not of the random source.
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
 * The count question sits outside every group, so it is keyed by a bare `questionId`.
 * A non-number counts as unanswered: total over input publish already refuses.
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
 * `open` sets no limit: its `max` bounds what may be added (SEC-16, checked on the
 * add), and truncating here would hide an instance the respondent can see.
 */
export function liveInstanceLimit(count: RepeatCount, answers: AnswerMap): number | undefined {
  if (count.source === "open") return undefined;
  if (count.source === "fixed") return count.count;
  const answered = countAnswerOf(count, answers);
  // `min` is deliberately not a floor here: it would make a group live before the
  // respondent said how big it is. It is enforced at submit and by the clamp below.
  if (answered === undefined) return 0;
  const bounds = countBounds(count);
  return clamp(answered, bounds.min, bounds.max);
}

/**
 * Compared against rows ever minted, never the live set: a removed `open` instance
 * must not be replaced, and a lowered-then-raised `fromAnswer` count must re-live
 * the instance it already minted so its answers come back.
 */
export function mintTarget(count: RepeatCount, answers: AnswerMap): number {
  if (count.source === "fixed") return count.count;
  if (count.source === "open") return Math.max(count.min, 1);
  return liveInstanceLimit(count, answers) ?? 0;
}

/**
 * Deduplicates before truncating, so a limit counts distinct instances: the one seam
 * where a `RosterMap` is built, and the evaluator trusts what it is handed.
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

export async function loadRosters(
  exec: Executor,
  sessionId: SessionId,
  steps: readonly Step[],
  answers: AnswerMap,
): Promise<RosterMap> {
  return deriveRosters(steps, await readRosters(exec, sessionId), answers);
}

export type RosterRefusalCode =
  | "REPEAT_NOT_ADDABLE"
  | "UNKNOWN_INSTANCE"
  | "REPEAT_MAX_REACHED";

export type RosterWriteResult =
  | { readonly ok: true; readonly minted: readonly InstanceId[] }
  | { readonly ok: false; readonly code: RosterRefusalCode };

/**
 * The caller owns the transaction and must hold the session's advisory lock, or two
 * concurrent serves each see an empty roster and each mint a full set.
 *
 * Call it at most once per group per transaction: `occurred_at` defaults to the
 * transaction timestamp, so two mints for one group share it and the read falls back
 * to the random `instance_id` tiebreaker, interleaving the batches and breaking the
 * first-N window that keeps a re-raised `fromAnswer` count on the same instances.
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
  // Re-read rather than splice the fresh ids on: a mint's rows share a timestamp, so
  // their order is the read's to decide and assembling it here would disagree with it.
  return liveInstances(
    input.group.count,
    await readRoster(exec, input.sessionId, input.group.groupId),
    input.answers,
  );
}

/**
 * The per-form `max` is the only bound there is (SEC-16), and it is checked against
 * the live count so a filled-then-emptied group can grow again.
 *
 * The caller must hold the session's advisory lock: the check is a read followed by
 * a write, so two simultaneous Adds would both pass and leave the group past `max`.
 * The one-mint-per-group-per-transaction contract above applies here too.
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
 * Appends a `removed` row, never a delete (I6). `min` is not enforced here: that is
 * a submit-time refusal, so a respondent may empty a group and rebuild it.
 *
 * Caller obligation: `instanceId` must be one this session's roster minted. This
 * function cannot check, and the table is append-only, so a forged id would leave a
 * row forever.
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

/**
 * Which steps this session has not opened yet, for a cursor-less serve: compared
 * against `minted` so a group the respondent emptied owes nothing and the serve does
 * not keep sending them back to it.
 */
export async function groupsOwedAMint(
  exec: Executor,
  input: { sessionId: SessionId; steps: readonly Step[]; answers: AnswerMap },
): Promise<ReadonlySet<GroupId>> {
  const rows = await readRosters(exec, input.sessionId);
  const owed = new Set<GroupId>();
  for (const group of repeatGroups(input.steps)) {
    const target = mintTarget(group.count, input.answers);
    if (target <= 0) continue;
    if (target - (rows.get(group.groupId)?.minted.length ?? 0) > 0) owed.add(group.groupId);
  }
  return owed;
}

/**
 * A roster row is permanent, so a group is minted only once the respondent can be
 * asked for it: the groups on the step being rendered, plus every `fromAnswer` group
 * wherever it sits, since its count answer is written on an earlier step.
 *
 * The caller owns the transaction and must hold the session's advisory lock, or two
 * concurrent serves each see an empty roster and each mint a full set.
 */
export async function mintDueAndLoadRosters(
  exec: Executor,
  input: {
    sessionId: SessionId;
    steps: readonly Step[];
    renderStep: StepId | null;
    answers: AnswerMap;
  },
): Promise<RosterMap> {
  const rows = await readRosters(exec, input.sessionId);
  const onRenderStep = new Set<GroupId>(
    input.steps
      .filter((step) => step.stepId === input.renderStep)
      .flatMap((step) => step.items.filter(isRepeatGroup).map((group) => group.groupId)),
  );
  let minted = false;
  for (const group of repeatGroups(input.steps)) {
    const due = group.count.source === "fromAnswer" || onRenderStep.has(group.groupId);
    if (!due) continue;
    const roster = rows.get(group.groupId);
    const shortfall = mintTarget(group.count, input.answers) - (roster?.minted.length ?? 0);
    if (shortfall <= 0) continue;
    await addInstances(exec, {
      sessionId: input.sessionId,
      groupId: group.groupId,
      instanceIds: mintDistinct(shortfall, roster?.minted ?? []),
    });
    minted = true;
  }
  return deriveRosters(
    input.steps,
    minted ? await readRosters(exec, input.sessionId) : rows,
    input.answers,
  );
}

export type RosterOpResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly minted: readonly InstanceId[];
    }
  | { readonly ok: false; readonly code: RosterRefusalCode };

/**
 * The one-time token is checked before the group's own rules, so replaying an accepted
 * post is a no-op whatever the roster looks like now. A refusal records nothing.
 */
export async function applyRosterOp(
  exec: Executor,
  input: {
    sessionId: SessionId;
    group: RepeatGroup;
    roster: GroupRoster | undefined;
    answers: AnswerMap;
    opToken: string;
  } & ({ readonly op: "add" } | { readonly op: "remove"; readonly instanceId: InstanceId }),
): Promise<RosterOpResult> {
  if (await rosterOpApplied(exec, input.sessionId, input.opToken)) {
    return { ok: true, replayed: true, minted: [] };
  }
  if (input.group.count.source !== "open") return { ok: false, code: "REPEAT_NOT_ADDABLE" };
  if (input.op === "remove") {
    // The table is append-only, so a forged instance id would leave a row forever.
    if (!(input.roster?.minted ?? []).includes(input.instanceId)) {
      return { ok: false, code: "UNKNOWN_INSTANCE" };
    }
    await removeInstance(exec, {
      sessionId: input.sessionId,
      groupId: input.group.groupId,
      instanceId: input.instanceId,
      opToken: input.opToken,
    });
    return { ok: true, replayed: false, minted: [] };
  }
  const live = liveInstances(input.group.count, input.roster, input.answers);
  const { max } = countBounds(input.group.count);
  if (max !== undefined && live.length >= max) return { ok: false, code: "REPEAT_MAX_REACHED" };
  const instanceId = mintDistinct(1, input.roster?.minted ?? [])[0]!;
  await addInstances(exec, {
    sessionId: input.sessionId,
    groupId: input.group.groupId,
    instanceIds: [instanceId],
    opToken: input.opToken,
  });
  return { ok: true, replayed: false, minted: [instanceId] };
}
