import type { RouteHandler } from "@hono/zod-openapi";
import {
  OWNER_MEMBER_ROLE,
  accountStatusOf,
  addAccessGroupHolder,
  carriesResponsesRole,
  createAccessGroup,
  deleteAccessGroup,
  ensureWorkspaceMember,
  findHoldSuspension,
  findUserByEmail,
  findUsersByIds,
  getAccessGroup,
  getWorkspace,
  holdsAccessGroup,
  isAccessGroupNameTaken,
  isResponsesRole,
  hasOpenSuspension,
  liftHoldMarkers,
  liftMarkersOfDeletedGroup,
  listAccessAudit,
  listAccessGroupHolders,
  listAccessGroups,
  listAccessGroupsHeldIn,
  listActiveAdministratorsFor,
  listActiveSiteAdministrators,
  listAgentActions,
  listEnvironmentNames,
  listGrantsForUser,
  listMemberWorkspacesForUser,
  listSiteAudit,
  listWorkspaceAdministrators,
  listWorkspaceMembers,
  lockWorkspaceMembership,
  markHoldSuspended,
  normaliseEnvironmentSet,
  openHoldMarker,
  reconfirmHold,
  refuseAccessGroupName,
  refuseAccessGroupRoles,
  refuseEnvironmentSet,
  removeAccessGroupHolder,
  removeMembership,
  resolveMembership,
  setMemberRole,
  setRequireSecondApprover,
  suspendHold,
  suspensionPerformers,
  tryLockAccount,
  updateAccessGroup,
  writeAccessAuditRow,
  writeSiteAuditRow,
  type AccessGroupRow,
  type ApprovalRequestRow,
  type Executor,
  type GrantSubjectRow,
  type WorkspaceAdministratorRow,
  type WorkspaceRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { agentStepSite, writeAgentStep } from "../agent/audit.js";
import { requestView } from "../site-admins/schema.js";
import { requireOpenWorkspace } from "../workspaces/resolve.js";
import { holdsStatement, type Resource } from "./policy.js";
import { holdsInstallationClaim, resolveCallerWorkspaces } from "./resolver.js";
import { OPERATIONAL_CELLS } from "./route-policy.js";
import {
  holdWorkspaceRequest,
  nobodyElseCouldApprove,
  secondApprovalShortfall,
} from "./two-person.js";
import type {
  addHolderRoute,
  agentAuditRoute,
  auditRoute,
  createAccessGroupRoute,
  deleteAccessGroupRoute,
  listAccessGroupsRoute,
  listMembersRoute,
  myAccessRoute,
  reconfirmHolderRoute,
  removeHolderRoute,
  removeMemberRoute,
  setMemberRoleRoute,
  siteAuditRoute,
  readWorkspaceSettingsRoute,
  updateAccessGroupRoute,
  workspaceSettingsRoute,
} from "./route.js";

// The only membership write path: the auth plugin's team and member endpoints stay off the HTTP allowlist,
// as their removal cascades change grants with no audit row. Each write puts its grants and audit row in one
// control-pool transaction.

export const fail = {
  notFound: (): ApiError => new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace"),
  archived: (): ApiError =>
    new ApiError(
      "WORKSPACE_ARCHIVED",
      409,
      "That workspace is archived, so no grant is written in it",
    ),
  groupNotFound: (): ApiError =>
    new ApiError("ACCESS_GROUP_NOT_FOUND", 404, "No such access group in this workspace"),
  nameTaken: (name: string): ApiError =>
    new ApiError(
      "ACCESS_GROUP_NAME_TAKEN",
      409,
      `This workspace already has an access group called "${name}". Names are unique within a workspace; the same name in another workspace is fine.`,
    ),
  invalidName: (reason: string): ApiError => new ApiError("ACCESS_GROUP_NAME_INVALID", 400, reason),
  invalidScope: (reason: string): ApiError =>
    new ApiError("ACCESS_GROUP_SCOPE_INVALID", 400, reason),
  invalidRoles: (reason: string): ApiError =>
    new ApiError("ACCESS_GROUP_ROLES_INVALID", 400, reason),
  // One answer for every account the caller may not add, so the refusal never says
  // whether an account exists.
  cannotAdd: (): ApiError =>
    new ApiError(
      "ACCOUNT_NOT_ADDABLE",
      404,
      "No account that can be added here matches. Check the address with the person, or ask a Site administrator.",
    ),
  notAMember: (): ApiError =>
    new ApiError(
      "NOT_A_MEMBER",
      404,
      "That account has no member row in this workspace, so there is no role to set. Granting them an access group makes them a member.",
    ),
  alreadyHolds: (): ApiError =>
    new ApiError("ALREADY_GRANTED", 409, "That account already holds this access group"),
  notAHolder: (): ApiError =>
    new ApiError("NOT_GRANTED", 404, "That account does not hold this access group"),
  lastAdministrator: (): ApiError =>
    new ApiError(
      "LAST_ADMINISTRATOR",
      409,
      "This is the workspace's last active Workspace administrator, and a workspace " +
        "without one is a workspace nobody can administer. Appoint somebody else first. " +
        "The Site administrator role does not stand in for it.",
    ),
  noSecondApprover: (shortfall: {
    readonly administrator: boolean;
    readonly publisher: boolean;
  }): ApiError =>
    new ApiError(
      "SECOND_APPROVAL_NO_APPROVER",
      409,
      "Second approval cannot be turned on here, because nobody else could approve: it " +
        "needs another active Workspace administrator or Site administrator, and two " +
        "active people holding Publish forms for prod in this workspace.",
      { administrator: shortfall.administrator, publisher: shortfall.publisher },
    ),
  noPrincipal: (): ApiError => new ApiError("unauthorized", 401, "Admin authentication required"),
  accountBusy: (): ApiError =>
    new ApiError(
      "ACCOUNT_BUSY",
      409,
      "Another change to this account is in progress. Try again in a moment.",
    ),
  notSuspended: (): ApiError =>
    new ApiError(
      "NOT_SUSPENDED",
      409,
      "That membership is not suspended, so there is nothing to re-confirm",
    ),
  reconfirmOwn: (): ApiError =>
    new ApiError(
      "RECONFIRM_OWN_REFUSED",
      409,
      "Nobody re-confirms their own suspended membership. Another Workspace administrator " +
        "of this workspace, or a Site administrator, has to.",
    ),
  reconfirmByPerformer: (): ApiError =>
    new ApiError(
      "RECONFIRM_BY_PERFORMER_REFUSED",
      409,
      "You reset or reactivated this account, so another active administrator of this " +
        "workspace, or a Site administrator, re-confirms its memberships.",
    ),
} as const;

function principalOf(c: { get: (key: "adminPrincipal") => unknown }): {
  readonly userId: string;
  readonly role: string;
} {
  const principal = c.get("adminPrincipal") as
    { readonly userId: string; readonly role: string } | undefined;
  if (principal === undefined) throw fail.noPrincipal();
  return principal;
}

async function workspaceOf(deps: Deps, id: string): Promise<WorkspaceRow> {
  const workspace = await getWorkspace(deps.databases.control, id);
  if (workspace === undefined) throw fail.notFound();
  return workspace;
}

/**
 * The same refusals as {@link workspaceOf} plus the archive one, on whatever executor the
 * caller passes. The self-grant rule turns on this row's own switch, so a write that
 * consults it reads it inside {@link lockWorkspaceMembership} rather than before.
 */
async function openWorkspaceOf(exec: Executor, id: string): Promise<WorkspaceRow> {
  const workspace = await getWorkspace(exec, id);
  if (workspace === undefined) throw fail.notFound();
  if (workspace.archivedAt !== null) throw fail.archived();
  return workspace;
}

// Empty unless the group names exactly one environment; a wider set is not lost, it moves
// to the audit row's `detail`.
function scopeColumns(group: { readonly environments: readonly string[] }): {
  environment?: string;
} {
  const environment = group.environments.length === 1 ? group.environments[0] : undefined;
  return environment === undefined ? {} : { environment };
}

function scopeDetail(
  group: { readonly roles: readonly string[]; readonly environments: readonly string[] },
  extra?: string,
): string {
  const parts = [`roles=${group.roles.join(",")}`, `environments=${group.environments.join(",")}`];
  if (extra !== undefined) parts.push(extra);
  return parts.join(" ");
}

// What the group now is, and what it was where a change moved it, so the row answers the
// act without reading the group back.
function groupDetail(
  act: "created" | "changed" | "deleted",
  group: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
  },
  before?: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
  },
): string {
  const parts = [`group=${act}`, `name=${group.name}`, scopeDetail(group)];
  if (before !== undefined) {
    if (before.name !== group.name) parts.push(`previousName=${before.name}`);
    if (before.roles.join(",") !== group.roles.join(",")) {
      parts.push(`previousRoles=${before.roles.join(",")}`);
    }
    if (before.environments.join(",") !== group.environments.join(",")) {
      parts.push(`previousEnvironments=${before.environments.join(",")}`);
    }
  }
  return parts.join(" ");
}

/**
 * Refuses while the subject is the only active, claimed Workspace administrator left. The
 * rows must be read inside {@link lockWorkspaceMembership}, or two removals each see the
 * administrator the other is taking away (criterion 88).
 */
function refuseLastAdministrator(
  administrators: readonly WorkspaceAdministratorRow[],
  userId: string,
): void {
  const subject = administrators.find((row) => row.userId === userId);
  if (subject === undefined || !subject.counts) return;
  if (administrators.filter((row) => row.counts).length <= 1) throw fail.lastAdministrator();
}

export async function groupView(
  exec: Executor,
  group: AccessGroupRow,
): Promise<{
  teamId: string;
  name: string;
  roles: string[];
  environments: string[];
  externalGroupId: string | null;
  holders: { userId: string; email: string }[];
}> {
  const holders = await listAccessGroupHolders(exec, group.teamId);
  return {
    teamId: group.teamId,
    name: group.name,
    roles: [...group.roles],
    environments: [...group.environments],
    externalGroupId: group.externalGroupId,
    holders: holders.map((holder) => ({ userId: holder.userId, email: holder.email })),
  };
}

export async function validateGroup(
  exec: Executor,
  input: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
  },
): Promise<{ readonly roles: readonly string[]; readonly environments: readonly string[] }> {
  const nameRefusal = refuseAccessGroupName(input.name);
  if (nameRefusal !== undefined) throw fail.invalidName(nameRefusal);

  const rolesRefusal = refuseAccessGroupRoles(input.roles);
  if (rolesRefusal !== undefined) throw fail.invalidRoles(rolesRefusal);

  const live = await listEnvironmentNames(exec);
  const setRefusal = refuseEnvironmentSet(input.environments, input.roles, live);
  if (setRefusal !== undefined) throw fail.invalidScope(setRefusal);

  // Stored in the live set's order, so two spellings of the same set compare equal.
  return { roles: input.roles, environments: normaliseEnvironmentSet(input.environments, live) };
}

// Who a response grant is written suspended by, or `undefined` for a live one: a hold's marker
// survives its removal, and while the run is open its performers and the account suspend too.
async function suspendingGrantor(
  tx: Executor,
  userId: string,
  teamId: string,
  grantorId: string,
): Promise<string | undefined> {
  const performers = await suspensionPerformers(tx, userId);
  if (grantorId === userId ? performers.length > 0 : performers.includes(grantorId)) {
    return grantorId;
  }
  return openHoldMarker(tx, userId, teamId);
}

export function gainsResponseRole(before: readonly string[], after: readonly string[]): boolean {
  return after.some((role) => isResponsesRole(role) && !before.includes(role));
}

/** Whether second approval holds this change as a self-grant. */
function holdsAsSelfGrant(input: {
  readonly actorHolds: boolean;
  readonly requireSecondApprover: boolean;
  readonly before: { readonly roles: readonly string[]; readonly environments: readonly string[] };
  readonly after: { readonly roles: readonly string[]; readonly environments: readonly string[] };
}): boolean {
  if (!input.actorHolds || !input.requireSecondApprover) return false;
  if (gainsResponseRole(input.before.roles, input.after.roles)) return true;
  if (!carriesResponsesRole(input.after.roles)) return false;
  return input.after.environments.some((name) => !input.before.environments.includes(name));
}

// Grant-exempt, and safe to be: no shape of this request asks about anybody but the
// caller. The one exception is who to ask, named only to an account that holds nothing.
export function makeMyAccessHandler(deps: Deps): RouteHandler<typeof myAccessRoute, ApiEnv> {
  return async (c) => {
    const principal = principalOf(c);
    const exec = deps.databases.control;
    const [memberships, grants, live] = await Promise.all([
      listMemberWorkspacesForUser(exec, principal.userId),
      listGrantsForUser(exec, principal.userId),
      listEnvironmentNames(exec),
    ]);

    const byWorkspace = new Map<
      string,
      {
        workspaceId: string;
        slug: string;
        name: string;
        archived: boolean;
        memberRole: string | null;
        grants: { name: string; roles: string[]; environments: string[] }[];
      }
    >();

    for (const membership of memberships) {
      byWorkspace.set(membership.workspaceId, {
        workspaceId: membership.workspaceId,
        slug: membership.slug,
        name: membership.name,
        archived: membership.archived,
        memberRole: membership.role,
        grants: [],
      });
    }
    for (const grant of grants) {
      const slot = byWorkspace.get(grant.workspaceId) ?? {
        workspaceId: grant.workspaceId,
        slug: grant.workspaceSlug,
        name: grant.workspaceName,
        archived: grant.workspaceArchived,
        memberRole: null,
        grants: [],
      };
      slot.grants.push({
        name: grant.name,
        roles: [...grant.roles],
        environments: [...grant.environments],
      });
      byWorkspace.set(grant.workspaceId, slot);
    }

    const claim = holdsInstallationClaim(principal.role);
    const holdsNothing =
      !claim &&
      grants.length === 0 &&
      memberships.every((membership) => membership.role !== OWNER_MEMBER_ROLE);
    return c.json(
      {
        userId: principal.userId,
        installationAdmin: claim,
        capabilities: await areasFor(exec, { userId: principal.userId, claim }),
        siteAdministrators: holdsNothing ? [...(await listActiveSiteAdministrators(exec))] : [],
        workspaces: [...byWorkspace.values()].map((workspace) => ({
          ...workspace,
          environments: environmentsHeld(workspace.grants, live),
        })),
      },
      200,
    );
  };
}

/**
 * Which areas a caller has, each asking whether any workspace they hold a grant in allows
 * the cell that area's routes require. Both scopes are ignored: what is inside an area is
 * that area's own routes' answer.
 */
async function areasFor(
  exec: Executor,
  input: { readonly userId: string; readonly claim: boolean },
): Promise<{
  operations: boolean;
  workspaces: boolean;
  siteConfiguration: boolean;
  authoring: boolean;
}> {
  const resolved = await resolveCallerWorkspaces(exec, input);
  const anywhere = (resource: Resource, action: string): boolean =>
    resolved.some((membership) =>
      holdsStatement(
        { memberRole: membership.memberRole, grants: membership.grants },
        resource,
        action,
      ),
    );
  return {
    operations: OPERATIONAL_CELLS.some((cell) => anywhere(cell.resource, cell.action)),
    workspaces: anywhere("workspace", "read"),
    // Not a cell: site configuration leads to `installationOnly` rows, which no role
    // reaches however it is scoped.
    siteConfiguration: input.claim,
    authoring: anywhere("form", "read") || anywhere("question", "read"),
  };
}

// A group whose roles all ignore the environment set applies everywhere, and the whole
// live set is expanded here rather than left to a client to work out.
function environmentsHeld(
  grants: readonly { readonly environments: readonly string[] }[],
  live: readonly string[],
): string[] {
  const held = new Set<string>();
  for (const grant of grants) {
    if (grant.environments.length === 0) {
      for (const name of live) held.add(name);
    } else {
      for (const name of grant.environments) held.add(name);
    }
  }
  return live.filter((name) => held.has(name));
}

export function makeListMembersHandler(deps: Deps): RouteHandler<typeof listMembersRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const exec = deps.databases.control;
    await workspaceOf(deps, workspaceId);

    const [members, groups] = await Promise.all([
      listWorkspaceMembers(exec, workspaceId),
      listAccessGroups(exec, workspaceId),
    ]);

    // The groups each member holds, so access is visible in the list rather than
    // inferred from a member row.
    const byUser = new Map<string, string[]>();
    for (const group of groups) {
      for (const holder of await listAccessGroupHolders(exec, group.teamId)) {
        const held = byUser.get(holder.userId) ?? [];
        held.push(group.name);
        byUser.set(holder.userId, held);
      }
    }

    return c.json(
      {
        workspaceId,
        members: members.map((member) => ({
          userId: member.userId,
          email: member.email,
          name: member.name,
          role: member.role,
          groups: byUser.get(member.userId) ?? [],
        })),
      },
      200,
    );
  };
}

// Appoint or remove a Workspace administrator. Demoting the last one is refused for every
// actor, a Site administrator included: nobody could then administer the workspace, and
// that role never satisfies the guard.
export function makeSetMemberRoleHandler(
  deps: Deps,
): RouteHandler<typeof setMemberRoleRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, userId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const actor = principalOf(c);
    const workspace = await workspaceOf(deps, workspaceId);
    if (workspace.archivedAt !== null) throw fail.archived();

    const site = agentStepSite(c);
    await deps.databases.control.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      const administrators = await listWorkspaceAdministrators(tx, workspaceId);
      if (role !== OWNER_MEMBER_ROLE) refuseLastAdministrator(administrators, userId);

      const updated = await setMemberRole(tx, workspaceId, userId, role);
      if (updated === undefined) throw fail.notAMember();

      // Both directions are audited, and only a direction: a write that leaves the flag
      // where it was appointed nobody and removed nobody, so it records nothing.
      const appointed = role === OWNER_MEMBER_ROLE;
      if (administrators.some((row) => row.userId === userId) !== appointed) {
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "administrator",
          detail: `administrator=${appointed ? "appointed" : "removed"} subject=${userId}`,
          occurredAt: deps.clock.now(),
        });
        // Appointing an unclaimed account is a grant made while unclaimed like any other,
        // so it is findable in the site audit as well as in this workspace's own.
        const subject = appointed ? (await findUsersByIds(tx, [userId]))[0] : undefined;
        if (subject !== undefined && subject.claimedAt === null) {
          await writeSiteAuditRow(tx, {
            actor: actor.userId,
            subject: userId,
            workspaceId,
            kind: "account",
            detail: "act=grant-while-unclaimed role=administrator",
            occurredAt: deps.clock.now(),
          });
        }
      }
      await writeAgentStep(tx, site, userId, deps.clock.now());
    });

    return c.json({ userId, role }, 200);
  };
}

// Takes the person out of the workspace: every access group they hold there and the member
// row itself, each with its own revoke row. Their account, and every other workspace, are
// untouched.
export function makeRemoveMemberHandler(
  deps: Deps,
): RouteHandler<typeof removeMemberRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, userId } = c.req.valid("param");
    const actor = principalOf(c);
    await workspaceOf(deps, workspaceId);

    await deps.databases.control.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      const administrators = await listWorkspaceAdministrators(tx, workspaceId);
      refuseLastAdministrator(administrators, userId);

      const held = await listAccessGroupsHeldIn(tx, workspaceId, userId);
      const removed = await removeMembership(tx, workspaceId, userId);
      if (!removed && held.length === 0) throw fail.notAMember();

      for (const group of held) {
        await removeAccessGroupHolder(tx, group.teamId, userId);
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "revoke",
          ...scopeColumns(group),
          detail: scopeDetail(group, `subject=${userId} group=${group.name}`),
          occurredAt: deps.clock.now(),
        });
      }
      if (administrators.some((row) => row.userId === userId)) {
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "administrator",
          detail: `administrator=removed subject=${userId}`,
          occurredAt: deps.clock.now(),
        });
      }
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "revoke",
        detail: `member=removed subject=${userId}`,
        occurredAt: deps.clock.now(),
      });
    });

    return c.body(null, 204);
  };
}

export function makeListAccessGroupsHandler(
  deps: Deps,
): RouteHandler<typeof listAccessGroupsRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    await workspaceOf(deps, workspaceId);
    const groups = await listAccessGroups(deps.databases.control, workspaceId);
    const views = [];
    for (const group of groups) {
      views.push(await groupView(deps.databases.control, group));
    }
    return c.json({ workspaceId, groups: views }, 200);
  };
}

// One `group` row: the group grants nobody anything until a holder is added, but creating
// it is an act on the workspace's access that section 11 records.
export function makeCreateAccessGroupHandler(
  deps: Deps,
): RouteHandler<typeof createAccessGroupRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const body = c.req.valid("json");
    const actor = principalOf(c);
    const workspace = await workspaceOf(deps, workspaceId);
    if (workspace.archivedAt !== null) throw fail.archived();

    const exec = deps.databases.control;
    const checked = await validateGroup(exec, body);

    const site = agentStepSite(c);
    const group = await exec.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      // Inside the lock, and enforced here because the auth plugin does not enforce
      // uniqueness on team names.
      if (await isAccessGroupNameTaken(tx, workspaceId, body.name)) {
        throw fail.nameTaken(body.name);
      }
      const created = await createAccessGroup(tx, {
        workspaceId,
        name: body.name,
        roles: checked.roles,
        environments: checked.environments,
      });
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "group",
        ...scopeColumns(created),
        detail: groupDetail("created", created),
        occurredAt: deps.clock.now(),
      });
      await writeAgentStep(tx, site, created.teamId, deps.clock.now());
      return created;
    });
    return c.json({ group: await groupView(exec, group) }, 201);
  };
}

/**
 * Write a group change under the caller's membership lock: the new sets, the suspension a
 * gained response role puts on each hold, and one `group` row naming both sides.
 */
export async function applyGroupEdit(
  tx: Executor,
  deps: Deps,
  input: {
    readonly workspaceId: string;
    readonly existing: AccessGroupRow;
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
    readonly actorId: string;
    readonly approval?: string;
  },
): Promise<AccessGroupRow> {
  const { existing, workspaceId } = input;
  const row = await updateAccessGroup(tx, existing.teamId, {
    name: input.name,
    roles: input.roles,
    environments: input.environments,
    updatedAt: deps.clock.now(),
  });
  if (row === undefined) throw fail.groupNotFound();
  if (gainsResponseRole(existing.roles, row.roles)) {
    for (const holder of await listAccessGroupHolders(tx, existing.teamId)) {
      const outcome = await keepSuspensionOnGain(tx, {
        group: row,
        userId: holder.userId,
        actorId: input.actorId,
        at: deps.clock.now(),
      });
      if (outcome === "reconfirmed") {
        await writeReconfirmAudit(tx, deps, {
          actorId: input.actorId,
          workspaceId,
          group: row,
          userId: holder.userId,
          via: "edit",
          byPerformer: false,
        });
      }
    }
  }

  const detail = groupDetail("changed", row, existing);
  await writeAccessAuditRow(tx, {
    actor: input.actorId,
    workspaceId,
    kind: "group",
    ...scopeColumns(row),
    detail: input.approval === undefined ? detail : `${detail} ${input.approval}`,
    occurredAt: deps.clock.now(),
  });
  return row;
}

// Editing a group you are in is one way to give yourself response access, so with second
// approval on such an edit is held, and nothing, the name included, changes until approved.
export function makeUpdateAccessGroupHandler(
  deps: Deps,
): RouteHandler<typeof updateAccessGroupRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = principalOf(c);

    const exec = deps.databases.control;
    const outcome = await exec.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      // Every read the hold rests on is taken here: a holder add that commits between
      // the check and this write would otherwise leave the actor holding the response
      // role the check exists to hold.
      const workspace = await openWorkspaceOf(tx, workspaceId);
      const existing = await getAccessGroup(tx, teamId);
      if (existing === undefined || existing.workspaceId !== workspaceId) {
        throw fail.groupNotFound();
      }

      const checked = await validateGroup(tx, body);
      if (
        holdsAsSelfGrant({
          actorHolds: await holdsAccessGroup(tx, teamId, actor.userId),
          requireSecondApprover: workspace.requireSecondApprover,
          before: existing,
          after: checked,
        })
      ) {
        const held = await holdWorkspaceRequest(tx, deps.clock.now(), {
          kind: "self-grant",
          workspaceId,
          target: teamId,
          requester: actor.userId,
          payload: {
            roles: [...checked.roles],
            environments: [...checked.environments],
            previousRoles: [...existing.roles],
            previousEnvironments: [...existing.environments],
          },
        });
        return { group: existing, held };
      }

      if (await isAccessGroupNameTaken(tx, workspaceId, body.name, teamId)) {
        throw fail.nameTaken(body.name);
      }
      const row = await applyGroupEdit(tx, deps, {
        workspaceId,
        existing,
        name: body.name,
        roles: checked.roles,
        environments: checked.environments,
        actorId: actor.userId,
      });
      return { group: row, held: undefined };
    });

    const group = await groupView(exec, outcome.group);
    if (outcome.held !== undefined) {
      return c.json({ group, request: requestView(outcome.held) }, 202);
    }
    return c.json({ group }, 200);
  };
}

// `teamMember` cascades on `team` delete, so the holders must be read before the delete
// and one `revoke` row written per holder in the same transaction, or the removals are
// invisible.
export function makeDeleteAccessGroupHandler(
  deps: Deps,
): RouteHandler<typeof deleteAccessGroupRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId } = c.req.valid("param");
    const actor = principalOf(c);
    await workspaceOf(deps, workspaceId);

    const site = agentStepSite(c);
    await deps.databases.control.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      const group = await getAccessGroup(tx, teamId);
      if (group === undefined || group.workspaceId !== workspaceId) throw fail.groupNotFound();

      for (const holder of await listAccessGroupHolders(tx, teamId)) {
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "revoke",
          ...scopeColumns(group),
          detail: scopeDetail(group, `subject=${holder.userId} group=${group.name}`),
          occurredAt: deps.clock.now(),
        });
      }
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "group",
        ...scopeColumns(group),
        detail: groupDetail("deleted", group),
        occurredAt: deps.clock.now(),
      });
      await liftMarkersOfDeletedGroup(tx, { teamId, by: actor.userId, at: deps.clock.now() });
      const removed = await deleteAccessGroup(tx, teamId);
      if (!removed) throw fail.groupNotFound();
      await writeAgentStep(tx, site, teamId, deps.clock.now());
    });

    return c.body(null, 204);
  };
}

// Team membership is the grant. The holder also needs a `member` row with the empty role,
// because the auth plugin's team queries assume a team member belongs to the
// organisation.
export function makeAddHolderHandler(deps: Deps): RouteHandler<typeof addHolderRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = principalOf(c);

    const exec = deps.databases.control;
    const site = agentStepSite(c);
    const group = await exec.transaction(
      async (tx): Promise<{ group: AccessGroupRow; request: ApprovalRequestRow | undefined }> => {
        await lockWorkspaceMembership(tx, workspaceId);
        // Read here for the same reason the group edit does, and the `grant` row names this
        // row's roles, so it records what the group carried when the hold was written.
        const workspace = await openWorkspaceOf(tx, workspaceId);
        const held = await getAccessGroup(tx, teamId);
        if (held === undefined || held.workspaceId !== workspaceId) throw fail.groupNotFound();

        const subject =
          body.userId !== undefined
            ? (await findUsersByIds(tx, [body.userId]))[0]
            : await findUserByEmail(tx, body.email as string);
        if (subject === undefined) throw fail.cannotAdd();
        // One answer by address for an unknown, a disabled and an unclaimed account, so a
        // Workspace administrator learns nothing about the directory from a refusal. Granting
        // an unclaimed account is the Site administrator's act, by id, audited below.
        if (body.email !== undefined && accountStatusOf(subject) !== "active") {
          throw fail.cannotAdd();
        }
        // Only the installation administrator browses the account directory; anybody else
        // adds a newcomer by exact address, so an id must already belong to this workspace.
        if (
          body.userId !== undefined &&
          !holdsInstallationClaim(actor.role) &&
          (await resolveMembership(tx, subject.userId, workspaceId)).memberRole === undefined
        ) {
          throw fail.cannotAdd();
        }

        if (await holdsAccessGroup(tx, teamId, subject.userId)) throw fail.alreadyHolds();

        // The test is "is this account giving itself a response role", so the installation
        // claim is not a way around the rule. The request binds the group as it is now.
        if (
          subject.userId === actor.userId &&
          carriesResponsesRole(held.roles) &&
          workspace.requireSecondApprover
        ) {
          const request = await holdWorkspaceRequest(tx, deps.clock.now(), {
            kind: "self-grant",
            workspaceId,
            target: teamId,
            requester: actor.userId,
            payload: { roles: [...held.roles], environments: [...held.environments] },
          });
          return { group: held, request };
        }

        await applyGrant(tx, deps, { workspaceId, group: held, subject, actorId: actor.userId });
        await writeAgentStep(tx, site, teamId, deps.clock.now());
        return { group: held, request: undefined };
      },
    );

    const view = await groupView(exec, group.group);
    if (group.request !== undefined) {
      return c.json({ group: view, request: requestView(group.request) }, 202);
    }
    return c.json({ group: view }, 201);
  };
}

/** Write one hold with its `grant` row, and the site row a grant to an unclaimed account takes. */
export async function applyGrant(
  tx: Executor,
  deps: Deps,
  input: {
    readonly workspaceId: string;
    readonly group: AccessGroupRow;
    readonly subject: GrantSubjectRow;
    readonly actorId: string;
    readonly approval?: string;
  },
): Promise<void> {
  const { group, subject, workspaceId } = input;
  const suspended = await writeHold(tx, {
    group,
    userId: subject.userId,
    actorId: input.actorId,
    at: deps.clock.now(),
  });
  const parts = [`subject=${subject.userId} group=${group.name}`];
  if (suspended) parts.push("suspended=1");
  if (input.approval !== undefined) parts.push(input.approval);
  await writeAccessAuditRow(tx, {
    actor: input.actorId,
    workspaceId,
    kind: "grant",
    ...scopeColumns(group),
    detail: scopeDetail(group, parts.join(" ")),
    occurredAt: deps.clock.now(),
  });
  // A grant made while the account is still unclaimed is a site act too, so it is
  // findable in the site audit as well as in this workspace's own.
  if (subject.claimedAt === null) {
    await writeSiteAuditRow(tx, {
      actor: input.actorId,
      subject: subject.userId,
      workspaceId,
      kind: "account",
      detail: `act=grant-while-unclaimed group=${group.name}`,
      occurredAt: deps.clock.now(),
    });
  }
}

// Suspended where the hold still owes a re-confirmation, or the grantor performed the run or
// is the account. The account's lock is tried after the workspace's, as the re-confirmation
// takes them; a reset holds only the account's.
async function writeHold(
  tx: Executor,
  input: {
    readonly group: AccessGroupRow;
    readonly userId: string;
    readonly actorId: string;
    readonly at: Date;
  },
): Promise<boolean> {
  const { group, userId } = input;
  const responses = carriesResponsesRole(group.roles);
  if (responses && !(await tryLockAccount(tx, userId))) throw fail.accountBusy();
  await ensureWorkspaceMember(tx, group.workspaceId, userId);
  await addAccessGroupHolder(tx, group.teamId, userId);
  if (!responses) return false;
  const by = await suspendingGrantor(tx, userId, group.teamId, input.actorId);
  if (by === undefined) return false;
  await suspendHold(tx, { teamId: group.teamId, userId, by, at: input.at });
  await markHoldSuspended(tx, { userId, teamId: group.teamId, performedBy: by, at: input.at });
  return true;
}

// A group edit that gives a hold a response role grants it as an add does, so the same rule
// suspends it; a hold already suspended keeps the performer it answers to. An edit by an
// administrator who took no part in a pending reset is their re-confirmation of the hold.
async function keepSuspensionOnGain(
  tx: Executor,
  input: {
    readonly group: AccessGroupRow;
    readonly userId: string;
    readonly actorId: string;
    readonly at: Date;
  },
): Promise<"suspended" | "reconfirmed" | undefined> {
  const { group, userId } = input;
  if (!(await tryLockAccount(tx, userId))) throw fail.accountBusy();
  const hold = await findHoldSuspension(tx, group.teamId, userId);
  if (hold === undefined || hold.suspendedAt !== null) return undefined;
  const by = await suspendingGrantor(tx, userId, group.teamId, input.actorId);
  if (by !== undefined) {
    await suspendHold(tx, { teamId: group.teamId, userId, by, at: input.at });
    await markHoldSuspended(tx, { userId, teamId: group.teamId, performedBy: by, at: input.at });
    return "suspended";
  }
  return (await hasOpenSuspension(tx, userId)) ? "reconfirmed" : undefined;
}

async function writeReconfirmAudit(
  tx: Executor,
  deps: Deps,
  input: {
    readonly actorId: string;
    readonly workspaceId: string;
    readonly group: AccessGroupRow;
    readonly userId: string;
    readonly via: "reconfirm" | "edit";
    readonly byPerformer: boolean;
  },
): Promise<void> {
  const { group, userId } = input;
  const via = input.via === "edit" ? " via=edit" : "";
  const extra = `subject=${userId} group=${group.name} act=reconfirm${via}`;
  await writeAccessAuditRow(tx, {
    actor: input.actorId,
    workspaceId: input.workspaceId,
    kind: "grant",
    ...scopeColumns(group),
    detail: scopeDetail(group, input.byPerformer ? `${extra} byPerformer=1` : extra),
    occurredAt: deps.clock.now(),
  });
  const [subject] = await findUsersByIds(tx, [userId]);
  if (subject?.claimedAt === null) {
    await writeSiteAuditRow(tx, {
      actor: input.actorId,
      subject: userId,
      workspaceId: input.workspaceId,
      kind: "account",
      detail: `act=grant-while-unclaimed group=${group.name} reconfirm=1${via}`,
      occurredAt: deps.clock.now(),
    });
  }
}

export function makeRemoveHolderHandler(
  deps: Deps,
): RouteHandler<typeof removeHolderRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId, userId } = c.req.valid("param");
    const actor = principalOf(c);
    await workspaceOf(deps, workspaceId);

    const site = agentStepSite(c);
    await deps.databases.control.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      const group = await getAccessGroup(tx, teamId);
      if (group === undefined || group.workspaceId !== workspaceId) throw fail.groupNotFound();
      const removed = await removeAccessGroupHolder(tx, teamId, userId);
      if (!removed) throw fail.notAHolder();
      await writeAgentStep(tx, site, userId, deps.clock.now());
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "revoke",
        ...scopeColumns(group),
        detail: scopeDetail(group, `subject=${userId} group=${group.name}`),
        occurredAt: deps.clock.now(),
      });
    });

    return c.body(null, 204);
  };
}

/**
 * The rows are read inside {@link lockWorkspaceMembership}, so the administrators counted
 * are the ones standing when the suspension is lifted.
 */
export function makeReconfirmHolderHandler(
  deps: Deps,
): RouteHandler<typeof reconfirmHolderRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId, userId } = c.req.valid("param");
    const actor = principalOf(c);
    if (userId === actor.userId) throw fail.reconfirmOwn();

    const exec = deps.databases.control;
    const site = agentStepSite(c);
    const group = await exec.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      await openWorkspaceOf(tx, workspaceId);
      const held = await getAccessGroup(tx, teamId);
      if (held === undefined || held.workspaceId !== workspaceId) throw fail.groupNotFound();
      // Taken after the workspace lock, as the grant takes it, and tried, so a reset in
      // flight never has its suspension lifted from a read made before it committed.
      if (!(await tryLockAccount(tx, userId))) throw fail.accountBusy();
      const hold = await findHoldSuspension(tx, teamId, userId);
      if (hold === undefined) throw fail.notAHolder();
      if (hold.suspendedAt === null) throw fail.notSuspended();

      const byPerformer =
        hold.suspendedBy === actor.userId ||
        (await suspensionPerformers(tx, userId)).includes(actor.userId);
      if (byPerformer) {
        const others = (await listActiveAdministratorsFor(tx, workspaceId)).filter(
          (administrator) => administrator !== actor.userId && administrator !== userId,
        );
        if (others.length > 0) throw fail.reconfirmByPerformer();
      }

      await reconfirmHold(tx, teamId, userId);
      await liftHoldMarkers(tx, { userId, teamId, by: actor.userId, at: deps.clock.now() });
      await writeReconfirmAudit(tx, deps, {
        actorId: actor.userId,
        workspaceId,
        group: held,
        userId,
        via: "reconfirm",
        byPerformer,
      });
      await writeAgentStep(tx, site, teamId, deps.clock.now());
      return held;
    });

    return c.json({ group: await groupView(exec, group) }, 200);
  };
}

/** Turn the switch, writing its `setting` row; `approval` names the request that held it. */
export async function applySecondApprovalSetting(
  tx: Executor,
  deps: Deps,
  input: {
    readonly workspaceId: string;
    readonly value: boolean;
    readonly actorId: string;
    readonly approval?: string;
  },
): Promise<boolean> {
  const value = await setRequireSecondApprover(tx, input.workspaceId, input.value);
  if (value === undefined) throw fail.notFound();
  const detail = `setting=requireSecondApprover value=${String(value)}`;
  await writeAccessAuditRow(tx, {
    actor: input.actorId,
    workspaceId: input.workspaceId,
    kind: "setting",
    detail: input.approval === undefined ? detail : `${detail} ${input.approval}`,
    occurredAt: deps.clock.now(),
  });
  return value;
}

// Turning the switch on is refused where nobody else could approve; turning it off while it
// is on is held as a workspace approval request. A write that changes nothing writes no row.
export function makeWorkspaceSettingsHandler(
  deps: Deps,
): RouteHandler<typeof workspaceSettingsRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const body = c.req.valid("json");
    const actor = principalOf(c);

    const site = agentStepSite(c);
    const outcome = await deps.databases.control.transaction(async (tx) => {
      // The same lock the membership writes take: this switch is what their self-grant
      // check turns on, and who could approve is read from them.
      await lockWorkspaceMembership(tx, workspaceId);
      const workspace = await requireOpenWorkspace(tx, workspaceId);
      if (body.requireSecondApprover === workspace.requireSecondApprover) {
        await writeAgentStep(tx, site, workspaceId, deps.clock.now());
        return { value: workspace.requireSecondApprover, held: undefined };
      }

      if (!body.requireSecondApprover) {
        const held = await holdWorkspaceRequest(tx, deps.clock.now(), {
          kind: "second-approval-off",
          workspaceId,
          target: workspaceId,
          requester: actor.userId,
          payload: {},
        });
        return { value: true, held };
      }

      const shortfall = await secondApprovalShortfall(tx, {
        workspaceId,
        requester: actor.userId,
      });
      if (nobodyElseCouldApprove(shortfall)) throw fail.noSecondApprover(shortfall);
      const value = await applySecondApprovalSetting(tx, deps, {
        workspaceId,
        value: true,
        actorId: actor.userId,
      });
      await writeAgentStep(tx, site, workspaceId, deps.clock.now());
      return { value, held: undefined };
    });

    if (outcome.held !== undefined) {
      return c.json(
        { workspaceId, requireSecondApprover: outcome.value, request: requestView(outcome.held) },
        202,
      );
    }
    return c.json({ workspaceId, requireSecondApprover: outcome.value }, 200);
  };
}

/**
 * The switch and whether nobody other than the caller could approve, which is the Settings
 * warning while the rule is on and the turn-on refusal while it is off.
 */
export function makeReadWorkspaceSettingsHandler(
  deps: Deps,
): RouteHandler<typeof readWorkspaceSettingsRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const actor = principalOf(c);
    const workspace = await workspaceOf(deps, workspaceId);
    const shortfall = await secondApprovalShortfall(deps.databases.control, {
      workspaceId,
      requester: actor.userId,
    });
    return c.json(
      {
        workspaceId,
        requireSecondApprover: workspace.requireSecondApprover,
        nobodyElseCouldApprove: nobodyElseCouldApprove(shortfall),
        missingApprover: shortfall,
      },
      200,
    );
  };
}

function auditWindow(query: {
  readonly page?: string | undefined;
  readonly pageSize?: string | undefined;
}): { readonly page: number; readonly pageSize: number } {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 50 : Math.min(Number(query.pageSize), 200);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new ApiError("INVALID_QUERY", 400, "page and pageSize must be positive integers");
  }
  return { page, pageSize };
}

// The actor id is deliberately not a foreign key, so a removed account shows as an id
// with no address rather than making the audit row disappear.
export function makeAuditHandler(deps: Deps): RouteHandler<typeof auditRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const query = c.req.valid("query");
    await workspaceOf(deps, workspaceId);

    const { page, pageSize } = auditWindow(query);

    const exec = deps.databases.control;
    const { rows, total } = await listAccessAudit(exec, workspaceId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(query.kind === undefined ? {} : { kind: query.kind }),
    });

    const actors = await findUsersByIds(exec, [...new Set(rows.map((row) => row.actor))]);
    const addresses = new Map(actors.map((actor) => [actor.userId, actor.email]));

    return c.json(
      {
        workspaceId,
        rows: rows.map((row) => ({
          id: row.id,
          actor: row.actor,
          actorEmail: addresses.get(row.actor) ?? null,
          environment: row.environment,
          formId: row.formId,
          kind: row.kind,
          occurredAt: row.occurredAt.toISOString(),
          detail: row.detail,
        })),
        page,
        pageSize,
        total,
      },
      200,
    );
  };
}

/**
 * The site audit, which names no workspace: the route row is `installationOnly`, so the
 * grant middleware has already refused everybody but a Site administrator.
 */
export function makeSiteAuditHandler(deps: Deps): RouteHandler<typeof siteAuditRoute, ApiEnv> {
  return async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = auditWindow(query);

    const exec = deps.databases.control;
    const { rows, total } = await listSiteAudit(exec, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(query.kind === undefined ? {} : { kind: query.kind }),
    });

    const actors = await findUsersByIds(exec, [...new Set(rows.map((row) => row.actor))]);
    const addresses = new Map(actors.map((actor) => [actor.userId, actor.email]));

    return c.json(
      {
        rows: rows.map((row) => ({
          id: row.id,
          actor: row.actor,
          actorEmail: addresses.get(row.actor) ?? null,
          subject: row.subject,
          workspaceId: row.workspaceId,
          kind: row.kind,
          occurredAt: row.occurredAt.toISOString(),
          detail: row.detail,
        })),
        page,
        pageSize,
        total,
      },
      200,
    );
  };
}

/**
 * The agent audit for one workspace, scoped and authorised exactly as the access audit above: the same
 * `audit: read` cell, the same workspace from the path, the same actor resolution, and a `detail` that
 * carries a non-content fact and nothing else.
 */
export function makeAgentAuditHandler(deps: Deps): RouteHandler<typeof agentAuditRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const query = c.req.valid("query");
    await workspaceOf(deps, workspaceId);

    const { page, pageSize } = auditWindow(query);

    const exec = deps.databases.control;
    const { rows, total } = await listAgentActions(exec, workspaceId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(query.kind === undefined ? {} : { kind: query.kind }),
    });

    const actors = await findUsersByIds(exec, [...new Set(rows.map((row) => row.actor))]);
    const addresses = new Map(actors.map((actor) => [actor.userId, actor.email]));

    return c.json(
      {
        workspaceId,
        rows: rows.map((row) => ({
          id: row.id,
          proposalId: row.proposalId,
          stepIndex: row.stepIndex,
          stepCount: row.stepCount,
          actor: row.actor,
          actorEmail: addresses.get(row.actor) ?? null,
          environment: row.environment,
          formId: row.formId,
          kind: row.kind,
          screen: row.screen,
          proposedAt: row.proposedAt.toISOString(),
          confirmedAt: row.confirmedAt.toISOString(),
          detail: row.detail,
        })),
        page,
        pageSize,
        total,
      },
      200,
    );
  };
}
