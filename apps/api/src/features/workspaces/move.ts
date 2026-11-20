import {
  getWorkspace,
  listEnvironmentNames,
  listWorkspaceAdministrators,
  listWorkspaceMembers,
  lockForm,
  moveFormToWorkspace,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { Executor, WorkspaceRow } from "@roonga/qcms-db";

import type { FormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { decideAccess, isEnvironmentScoped, type Resource } from "../membership/policy.js";
import { resolveGrants } from "../membership/resolver.js";

/** Why a move waits for an approver; absent where the mover applies it themselves. */
export type MoveHoldReason = "second-approval" | "not-source-administrator";

export const moveFail = {
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  notInDestination: (): ApiError =>
    new ApiError(
      "FORBIDDEN",
      403,
      "Moving a form needs Edit forms in the destination workspace as well as the source.",
    ),
  moverLostEditForms: (): ApiError =>
    new ApiError(
      "MOVER_LOST_EDIT_FORMS",
      409,
      "The person who asked no longer holds Edit forms in both workspaces, so nothing is " +
        "applied and this request has ended",
    ),
  formLeftSource: (): ApiError =>
    new ApiError(
      "MOVE_FORM_LEFT_SOURCE",
      409,
      "The form is no longer in the workspace this move was asked from, so nothing is applied",
    ),
  sameWorkspace: (): ApiError =>
    new ApiError("MOVE_SAME_WORKSPACE", 409, "The form is already in that workspace"),
  destinationArchived: (): ApiError =>
    new ApiError(
      "MOVE_DESTINATION_ARCHIVED",
      409,
      "The destination workspace is archived, so nothing is applied and this request has ended",
    ),
} as const;

/** The acts a move hands from the source's groups to the destination's. */
const MOVED_CELLS: readonly { readonly resource: Resource; readonly action: string }[] = [
  { resource: "form", action: "read" },
  { resource: "form", action: "write" },
  { resource: "form", action: "publish" },
  { resource: "response", action: "read" },
  { resource: "response", action: "export" },
  { resource: "response", action: "erase" },
];

export interface MovedAct {
  /** `<resource>.<action>`, as the matrix names the cell. */
  readonly act: string;
  /** Empty for an act that ignores the environment set. */
  readonly environments: readonly string[];
}

/** Named only: the address stands in for a blank display name and is never sent beside it. */
export interface MovePreviewPerson {
  readonly name: string;
  readonly acts: readonly MovedAct[];
}

export interface MovePreview {
  readonly gains: readonly MovePreviewPerson[];
  readonly losses: readonly MovePreviewPerson[];
}

function keyOf(act: string, environment: string | undefined): string {
  return environment === undefined ? act : `${act}@${environment}`;
}

async function cellsHeld(
  exec: Executor,
  input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly environments: readonly string[];
  },
): Promise<ReadonlySet<string>> {
  const resolved = await resolveGrants(exec, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    // The installation claim grants no act on a form or a response, and a mover needs
    // Edit forms either way, so the preview reads the two workspaces' groups alone.
    claim: false,
  });
  const held = new Set<string>();
  for (const cell of MOVED_CELLS) {
    const act = `${cell.resource}.${cell.action}`;
    const scoped = isEnvironmentScoped(cell.resource, cell.action);
    for (const environment of scoped ? input.environments : [undefined]) {
      const allowed = decideAccess({
        memberRole: resolved.memberRole,
        grants: resolved.grants,
        request: {
          resource: cell.resource,
          action: cell.action,
          ...(environment === undefined ? {} : { environment }),
        },
      }).allowed;
      if (allowed) held.add(keyOf(act, environment));
    }
  }
  return held;
}

function actsFrom(keys: readonly string[], environments: readonly string[]): readonly MovedAct[] {
  const byAct = new Map<string, string[]>();
  for (const key of keys) {
    const [act = "", environment] = key.split("@");
    const entry = byAct.get(act) ?? [];
    if (environment !== undefined) entry.push(environment);
    byAct.set(act, entry);
  }
  return [...byAct.entries()]
    .map(([act, named]) => ({
      act,
      environments: environments.filter((name) => named.includes(name)),
    }))
    .sort((left, right) => left.act.localeCompare(right.act));
}

/**
 * Who gains and who loses an act on this form and its responses, read with the same
 * evaluator every screen act is: the source's groups before, the destination's after. Only
 * the two workspaces' own members are considered, so nobody outside them is named.
 */
export async function moveAccessPreview(
  exec: Executor,
  input: {
    readonly sourceWorkspaceId: string;
    readonly destinationWorkspaceId: string;
  },
): Promise<MovePreview> {
  const [environments, sourceMembers, destinationMembers] = await Promise.all([
    listEnvironmentNames(exec),
    listWorkspaceMembers(exec, input.sourceWorkspaceId),
    listWorkspaceMembers(exec, input.destinationWorkspaceId),
  ]);

  const people = new Map<string, string>();
  for (const member of [...sourceMembers, ...destinationMembers]) {
    people.set(member.userId, member.name.trim() === "" ? member.email : member.name);
  }

  type Ranked = MovePreviewPerson & { readonly userId: string };
  const gains: Ranked[] = [];
  const losses: Ranked[] = [];
  for (const [userId, name] of people) {
    const [before, after] = await Promise.all([
      cellsHeld(exec, { userId, workspaceId: input.sourceWorkspaceId, environments }),
      cellsHeld(exec, { userId, workspaceId: input.destinationWorkspaceId, environments }),
    ]);
    const gained = [...after].filter((key) => !before.has(key));
    const lost = [...before].filter((key) => !after.has(key));
    if (gained.length > 0) {
      gains.push({ userId, name, acts: actsFrom(gained, environments) });
    }
    if (lost.length > 0) {
      losses.push({ userId, name, acts: actsFrom(lost, environments) });
    }
  }
  const named = (ranked: readonly Ranked[]): readonly MovePreviewPerson[] =>
    [...ranked]
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) || left.userId.localeCompare(right.userId),
      )
      .map(({ name, acts }) => ({ name, acts }));
  return { gains: named(gains), losses: named(losses) };
}

/**
 * Whether this mover's move waits for an approver: with the rule on in the source every
 * move does, and with it off every move by anybody but an active Workspace administrator
 * of the source. The Site administrator role is not one: it approves, and its own move is
 * held like anyone else's (`docs/WORKSPACE_ACCESS.md` section 9).
 */
export async function moveHoldReason(
  exec: Executor,
  input: { readonly source: WorkspaceRow; readonly moverId: string },
): Promise<MoveHoldReason | undefined> {
  if (input.source.requireSecondApprover) return "second-approval";
  const administrators = await listWorkspaceAdministrators(exec, input.source.id);
  const administers = administrators.some((row) => row.userId === input.moverId && row.counts);
  return administers ? undefined : "not-source-administrator";
}

async function holdsEditForms(
  exec: Executor,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const resolved = await resolveGrants(exec, { userId, workspaceId, claim: false });
  return decideAccess({
    memberRole: resolved.memberRole,
    grants: resolved.grants,
    request: { resource: "form", action: "write" },
  }).allowed;
}

/**
 * The form, locked until the transaction ends, or the refusal when it has left the source:
 * a move is asked from one workspace and must not carry the form out of another.
 */
export async function lockFormInSource(
  tx: Executor,
  input: { readonly formId: FormId; readonly sourceWorkspaceId: string },
): Promise<ApiError | undefined> {
  const form = await lockForm(tx, input.formId);
  return form?.workspaceId === input.sourceWorkspaceId ? undefined : moveFail.formLeftSource();
}

/** The refusal a held move can no longer avoid, or `undefined` when it still applies. */
export async function moveLapse(
  tx: Executor,
  input: {
    readonly formId: FormId;
    readonly moverId: string;
    readonly sourceWorkspaceId: string;
    readonly destinationWorkspaceId: string;
  },
): Promise<ApiError | undefined> {
  const leftSource = await lockFormInSource(tx, input);
  if (leftSource !== undefined) return leftSource;
  const destination = await getWorkspace(tx, input.destinationWorkspaceId);
  if (destination === undefined || destination.archivedAt !== null) {
    return moveFail.destinationArchived();
  }
  for (const workspaceId of [input.sourceWorkspaceId, input.destinationWorkspaceId]) {
    if (!(await holdsEditForms(tx, input.moverId, workspaceId))) {
      return moveFail.moverLostEditForms();
    }
  }
  return undefined;
}

/** The move itself, with one `setting` row in each workspace's audit. */
export async function applyFormMove(
  tx: Executor,
  deps: Deps,
  input: {
    readonly formId: FormId;
    readonly sourceWorkspaceId: string;
    readonly destinationWorkspaceId: string;
    readonly actorId: string;
    readonly approval?: string;
  },
): Promise<string> {
  const moved = await moveFormToWorkspace(tx, input.formId, {
    from: input.sourceWorkspaceId,
    to: input.destinationWorkspaceId,
  });
  if (moved === undefined) throw moveFail.formLeftSource();
  const occurredAt = deps.clock.now();
  const approval = input.approval === undefined ? "" : ` ${input.approval}`;
  await writeAccessAuditRow(tx, {
    actor: input.actorId,
    workspaceId: input.sourceWorkspaceId,
    formId: input.formId,
    kind: "setting",
    detail: `setting=form-moved-out to=${input.destinationWorkspaceId}${approval}`,
    occurredAt,
  });
  await writeAccessAuditRow(tx, {
    actor: input.actorId,
    workspaceId: input.destinationWorkspaceId,
    formId: input.formId,
    kind: "setting",
    detail: `setting=form-moved-in from=${input.sourceWorkspaceId}${approval}`,
    occurredAt,
  });
  return moved.workspaceId;
}
