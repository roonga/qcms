import type { RouteHandler } from "@hono/zod-openapi";
import {
  OWNER_MEMBER_ROLE,
  accountStatusOf,
  addAccessGroupHolder,
  carriesResponsesRole,
  createAccessGroup,
  deleteAccessGroup,
  ensureWorkspaceMember,
  findUserByEmail,
  findUsersByIds,
  getAccessGroup,
  getWorkspace,
  holdsAccessGroup,
  isAccessGroupNameTaken,
  isResponsesRole,
  listAccessAudit,
  listAccessGroupHolders,
  listAccessGroups,
  listAccessGroupsHeldIn,
  listAgentActions,
  listEnvironmentNames,
  listGrantsForUser,
  listMemberWorkspacesForUser,
  listSiteAudit,
  listWorkspaceAdministrators,
  listWorkspaceMembers,
  lockWorkspaceMembership,
  normaliseEnvironmentSet,
  refuseAccessGroupName,
  refuseAccessGroupRoles,
  refuseEnvironmentSet,
  removeAccessGroupHolder,
  removeMembership,
  resolveMembership,
  setMemberRole,
  setRequireSecondApprover,
  updateAccessGroup,
  writeAccessAuditRow,
  writeSiteAuditRow,
  type AccessGroupRow,
  type Executor,
  type WorkspaceAdministratorRow,
  type WorkspaceRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { agentStepSite, writeAgentStep } from "../agent/audit.js";
import { requireOpenWorkspace } from "../workspaces/resolve.js";
import { holdsStatement, type Resource } from "./policy.js";
import { holdsInstallationClaim, resolveCallerWorkspaces } from "./resolver.js";
import { OPERATIONAL_CELLS } from "./route-policy.js";
import type {
  addHolderRoute,
  agentAuditRoute,
  auditRoute,
  createAccessGroupRoute,
  deleteAccessGroupRoute,
  listAccessGroupsRoute,
  listMembersRoute,
  myAccessRoute,
  removeHolderRoute,
  removeMemberRoute,
  setMemberRoleRoute,
  siteAuditRoute,
  updateAccessGroupRoute,
  workspaceSettingsRoute,
} from "./route.js";

// The only membership write path: the auth plugin's team and member endpoints stay off the HTTP allowlist,
// as their removal cascades change grants with no audit row. Each write puts its grants and audit row in one
// control-pool transaction.

const fail = {
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
  selfGrant: (): ApiError =>
    new ApiError(
      "SELF_GRANT_REFUSED",
      409,
      "This workspace has Second approval on, so you cannot give yourself a response " +
        "role, or a new environment for one: another Workspace administrator, or a " +
        "Site administrator, has to make this change. A grant on response data " +
        "is a grant on personal data.",
    ),
  noPrincipal: (): ApiError => new ApiError("unauthorized", 401, "Admin authentication required"),
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

async function groupView(
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

async function validateGroup(
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

/** Whether the second-approver rule refuses this change as a self-grant. */
function refuseSelfGrant(input: {
  readonly actorHolds: boolean;
  readonly requireSecondApprover: boolean;
  readonly before: { readonly roles: readonly string[]; readonly environments: readonly string[] };
  readonly after: { readonly roles: readonly string[]; readonly environments: readonly string[] };
}): boolean {
  if (!input.actorHolds || !input.requireSecondApprover) return false;
  const gainedResponseRole = input.after.roles.some(
    (role) => isResponsesRole(role) && !input.before.roles.includes(role),
  );
  if (gainedResponseRole) return true;
  if (!carriesResponsesRole(input.after.roles)) return false;
  return input.after.environments.some((name) => !input.before.environments.includes(name));
}

// Grant-exempt, and safe to be: it names no person, so no shape of this request asks
// about anybody but the caller.
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
    return c.json(
      {
        userId: principal.userId,
        installationAdmin: claim,
        capabilities: await areasFor(exec, { userId: principal.userId, claim }),
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

// A rename or a change of roles or environments writes one `group` row naming both sides,
// which is the act; who holds the group is the group's own list. The self-grant check is
// here too: editing a group you are in is one of the ways to give yourself response access.
export function makeUpdateAccessGroupHandler(
  deps: Deps,
): RouteHandler<typeof updateAccessGroupRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = principalOf(c);

    const exec = deps.databases.control;
    const updated = await exec.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, workspaceId);
      // Every read the refusal rests on is taken here: a holder add that commits between
      // the check and this write would otherwise leave the actor holding the response
      // role the check exists to refuse.
      const workspace = await openWorkspaceOf(tx, workspaceId);
      const existing = await getAccessGroup(tx, teamId);
      if (existing === undefined || existing.workspaceId !== workspaceId) {
        throw fail.groupNotFound();
      }

      const checked = await validateGroup(tx, body);
      if (
        refuseSelfGrant({
          actorHolds: await holdsAccessGroup(tx, teamId, actor.userId),
          requireSecondApprover: workspace.requireSecondApprover,
          before: existing,
          after: checked,
        })
      ) {
        throw fail.selfGrant();
      }

      if (await isAccessGroupNameTaken(tx, workspaceId, body.name, teamId)) {
        throw fail.nameTaken(body.name);
      }
      const row = await updateAccessGroup(tx, teamId, {
        name: body.name,
        roles: checked.roles,
        environments: checked.environments,
        updatedAt: deps.clock.now(),
      });
      if (row === undefined) throw fail.groupNotFound();

      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "group",
        ...scopeColumns(row),
        detail: groupDetail("changed", row, existing),
        occurredAt: deps.clock.now(),
      });
      return row;
    });

    return c.json({ group: await groupView(exec, updated) }, 200);
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
    const group = await exec.transaction(async (tx) => {
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

      // The test is "is this account giving itself a response role", so the installation
      // claim is not a way around the rule.
      if (
        subject.userId === actor.userId &&
        carriesResponsesRole(held.roles) &&
        workspace.requireSecondApprover
      ) {
        throw fail.selfGrant();
      }

      if (await holdsAccessGroup(tx, teamId, subject.userId)) throw fail.alreadyHolds();
      await ensureWorkspaceMember(tx, workspaceId, subject.userId);
      await addAccessGroupHolder(tx, teamId, subject.userId);
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "grant",
        ...scopeColumns(held),
        detail: scopeDetail(held, `subject=${subject.userId} group=${held.name}`),
        occurredAt: deps.clock.now(),
      });
      // A grant made while the account is still unclaimed is a site act too, so it is
      // findable in the site audit as well as in this workspace's own.
      if (subject.claimedAt === null) {
        await writeSiteAuditRow(tx, {
          actor: actor.userId,
          subject: subject.userId,
          workspaceId,
          kind: "account",
          detail: `act=grant-while-unclaimed group=${held.name}`,
          occurredAt: deps.clock.now(),
        });
      }
      await writeAgentStep(tx, site, teamId, deps.clock.now());
      return held;
    });

    return c.json({ group: await groupView(exec, group) }, 201);
  };
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

// Turning the switch off is the act somebody would want to find afterwards, so it is
// audited. A write that changes nothing writes no row.
export function makeWorkspaceSettingsHandler(
  deps: Deps,
): RouteHandler<typeof workspaceSettingsRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const body = c.req.valid("json");
    const actor = principalOf(c);

    const site = agentStepSite(c);
    const requireSecondApprover = await deps.databases.control.transaction(async (tx) => {
      // The same lock the membership writes take: this switch is what their self-grant
      // check turns on, so it may not move between one of those checks and its write.
      await lockWorkspaceMembership(tx, workspaceId);
      const workspace = await requireOpenWorkspace(tx, workspaceId);
      if (body.requireSecondApprover === workspace.requireSecondApprover) {
        await writeAgentStep(tx, site, workspaceId, deps.clock.now());
        return workspace.requireSecondApprover;
      }

      const value = await setRequireSecondApprover(tx, workspaceId, body.requireSecondApprover);
      if (value === undefined) throw fail.notFound();
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "setting",
        detail: `setting=requireSecondApprover value=${String(value)}`,
        occurredAt: deps.clock.now(),
      });
      await writeAgentStep(tx, site, workspaceId, deps.clock.now());
      return value;
    });

    return c.json({ workspaceId, requireSecondApprover }, 200);
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
