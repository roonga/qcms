import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  authMember,
  authOrganization,
  authTeam,
  authTeamMember,
  authUser,
} from "../schema/control/auth.js";
import { environments } from "../schema/control/environments.js";
import type { Executor } from "./executor.js";

// Grants are written only through QCMS endpoints, never the plugin's own: those endpoints
// are where the validation and the SEC-15 rows live, and the plugin's removal cascades
// run below any endpoint QCMS could gate.

/** A role whose statements are empty: a row carrying it grants nothing. */
export const EMPTY_MEMBER_ROLE = "member";

/** The one `member` role that is a grant: the workspace owner. */
export const OWNER_MEMBER_ROLE = "forms.owner";

/** The scope token meaning "every environment" or "every form". */
const SCOPE_ALL = "all";

function mintId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** One access group: a team row, which is one grant with its scope. */
export interface AccessGroupRow {
  readonly teamId: string;
  readonly workspaceId: string;
  /** The stored name, `<environments>.<plane>.<role>[.<label>]`. */
  readonly name: string;
  /** Any role but `forms.owner`, which is the member row's. */
  readonly role: string;
  /** `["all"]`, or one or more environment names. */
  readonly environments: readonly string[];
  /** `["all"]`, or one or more form ids. */
  readonly forms: readonly string[];
  /** The external directory join key, written only by the group sync path. */
  readonly externalGroupId: string | null;
  readonly createdAt: Date;
}

const groupColumns = {
  teamId: authTeam.id,
  workspaceId: authTeam.organizationId,
  name: authTeam.name,
  role: authTeam.role,
  environments: authTeam.environments,
  forms: authTeam.forms,
  externalGroupId: authTeam.externalGroupId,
  createdAt: authTeam.createdAt,
} as const;

/** One grant a caller holds: an access group plus the workspace it is in. */
export interface HeldGrant extends AccessGroupRow {
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly workspaceArchived: boolean;
}

/** What a caller holds in one workspace: the member row's role, and every team grant. */
export interface Membership {
  readonly workspaceId: string;
  /** `undefined` when the caller has no member row. {@link EMPTY_MEMBER_ROLE} is not a grant. */
  readonly memberRole: string | undefined;
  readonly grants: readonly AccessGroupRow[];
}

/**
 * Resolve one caller's membership in one workspace: the `member` row and the teams. Runs
 * on the control pool, the only one with any privilege on these tables.
 */
export async function resolveMembership(
  exec: Executor,
  userId: string,
  workspaceId: string,
): Promise<Membership> {
  const members = await exec
    .select({ role: authMember.role })
    .from(authMember)
    .where(and(eq(authMember.userId, userId), eq(authMember.organizationId, workspaceId)))
    .limit(1);

  const grants = await exec
    .select(groupColumns)
    .from(authTeamMember)
    .innerJoin(authTeam, eq(authTeam.id, authTeamMember.teamId))
    .where(and(eq(authTeamMember.userId, userId), eq(authTeam.organizationId, workspaceId)))
    .orderBy(asc(authTeam.name));

  return { workspaceId, memberRole: members[0]?.role, grants };
}

/** Every grant one caller holds, across every workspace. */
export async function listGrantsForUser(
  exec: Executor,
  userId: string,
): Promise<readonly HeldGrant[]> {
  return exec
    .select({
      ...groupColumns,
      workspaceSlug: authOrganization.slug,
      workspaceName: authOrganization.name,
      workspaceArchived: sql<boolean>`${authOrganization.archivedAt} is not null`,
    })
    .from(authTeamMember)
    .innerJoin(authTeam, eq(authTeam.id, authTeamMember.teamId))
    .innerJoin(authOrganization, eq(authOrganization.id, authTeam.organizationId))
    .where(eq(authTeamMember.userId, userId))
    .orderBy(asc(authOrganization.slug), asc(authTeam.name));
}

/** One workspace a caller has a `member` row in, with that row's role. */
export interface MemberWorkspace {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly role: string;
  readonly archived: boolean;
}

/**
 * Every workspace one caller has a `member` row in. A caller may hold this without a team
 * grant or the other way round, so deciding an act needs both this and
 * {@link listGrantsForUser}.
 */
export async function listMemberWorkspacesForUser(
  exec: Executor,
  userId: string,
): Promise<readonly MemberWorkspace[]> {
  return exec
    .select({
      workspaceId: authMember.organizationId,
      slug: authOrganization.slug,
      name: authOrganization.name,
      role: authMember.role,
      archived: sql<boolean>`${authOrganization.archivedAt} is not null`,
    })
    .from(authMember)
    .innerJoin(authOrganization, eq(authOrganization.id, authMember.organizationId))
    .where(eq(authMember.userId, userId))
    .orderBy(asc(authOrganization.slug));
}

/** One member row as the membership list reports it. */
export interface WorkspaceMemberRow {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly createdAt: Date;
}

/**
 * Every `member` row in one workspace. The API must restrict this to that workspace's
 * owners and the installation administrator.
 */
export async function listWorkspaceMembers(
  exec: Executor,
  workspaceId: string,
): Promise<readonly WorkspaceMemberRow[]> {
  return exec
    .select({
      userId: authMember.userId,
      email: authUser.email,
      name: authUser.name,
      role: authMember.role,
      createdAt: authMember.createdAt,
    })
    .from(authMember)
    .innerJoin(authUser, eq(authUser.id, authMember.userId))
    .where(eq(authMember.organizationId, workspaceId))
    .orderBy(asc(authUser.email));
}

/** Every access group in one workspace, oldest name first. */
export async function listAccessGroups(
  exec: Executor,
  workspaceId: string,
): Promise<readonly AccessGroupRow[]> {
  return exec
    .select(groupColumns)
    .from(authTeam)
    .where(eq(authTeam.organizationId, workspaceId))
    .orderBy(asc(authTeam.name));
}

/** One access group by id, or `undefined`. */
export async function getAccessGroup(
  exec: Executor,
  teamId: string,
): Promise<AccessGroupRow | undefined> {
  const rows = await exec
    .select(groupColumns)
    .from(authTeam)
    .where(eq(authTeam.id, teamId))
    .limit(1);
  return rows[0];
}

/**
 * Whether a stored name is already taken in this workspace. Uniqueness is the write
 * path's to enforce; the plugin does not enforce it on team names.
 */
export async function isAccessGroupNameTaken(
  exec: Executor,
  workspaceId: string,
  name: string,
  exceptTeamId?: string,
): Promise<boolean> {
  const rows = await exec
    .select({ id: authTeam.id })
    .from(authTeam)
    .where(and(eq(authTeam.organizationId, workspaceId), eq(authTeam.name, name)));
  return rows.some((row) => row.id !== exceptTeamId);
}

/** Who holds one access group's grant. */
export async function listAccessGroupHolders(
  exec: Executor,
  teamId: string,
): Promise<readonly WorkspaceMemberRow[]> {
  return exec
    .select({
      userId: authTeamMember.userId,
      email: authUser.email,
      name: authUser.name,
      role: authTeam.role,
      createdAt: authTeamMember.createdAt,
    })
    .from(authTeamMember)
    .innerJoin(authUser, eq(authUser.id, authTeamMember.userId))
    .innerJoin(authTeam, eq(authTeam.id, authTeamMember.teamId))
    .where(eq(authTeamMember.teamId, teamId))
    .orderBy(asc(authUser.email));
}

/** What {@link createAccessGroup} writes. */
export interface NewAccessGroup {
  readonly workspaceId: string;
  readonly name: string;
  readonly role: string;
  readonly environments: readonly string[];
  readonly forms: readonly string[];
}

/**
 * Create one access group; validation and the SEC-15 row are the caller's.
 * `externalGroupId` is deliberately not a parameter: only the sync path may write it.
 */
export async function createAccessGroup(
  exec: Executor,
  group: NewAccessGroup,
): Promise<AccessGroupRow> {
  const rows = await exec
    .insert(authTeam)
    .values({
      id: mintId("tm"),
      name: group.name,
      organizationId: group.workspaceId,
      role: group.role,
      environments: [...group.environments],
      forms: [...group.forms],
    })
    .returning(groupColumns);
  const created = rows[0];
  if (created === undefined) throw new Error("the access group insert returned no row");
  return created;
}

/**
 * Re-scope or rename one access group. The role is deliberately not changeable: moving
 * one would change what every holder holds without an audited act.
 */
export async function updateAccessGroupScope(
  exec: Executor,
  teamId: string,
  update: {
    readonly name: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
    readonly updatedAt: Date;
  },
): Promise<AccessGroupRow | undefined> {
  const rows = await exec
    .update(authTeam)
    .set({
      name: update.name,
      environments: [...update.environments],
      forms: [...update.forms],
      updatedAt: update.updatedAt,
    })
    .where(eq(authTeam.id, teamId))
    .returning(groupColumns);
  return rows[0];
}

/**
 * Remove one access group, and with it every grant it carried. The caller must read the
 * holders and write one SEC-15 `revoke` row each in the same transaction, or the cascade
 * goes unaudited.
 */
export async function deleteAccessGroup(exec: Executor, teamId: string): Promise<boolean> {
  const rows = await exec.delete(authTeam).where(eq(authTeam.id, teamId)).returning({
    id: authTeam.id,
  });
  return rows.length > 0;
}

/**
 * Make somebody a member with the empty role, unless they already have a member row.
 * Every grant holder needs one, because the plugin's team queries assume it. Never
 * downgrades an owner: an existing row is left exactly as it is.
 */
export async function ensureWorkspaceMember(
  exec: Executor,
  workspaceId: string,
  userId: string,
): Promise<{ readonly created: boolean; readonly role: string }> {
  const existing = await exec
    .select({ role: authMember.role })
    .from(authMember)
    .where(and(eq(authMember.organizationId, workspaceId), eq(authMember.userId, userId)))
    .limit(1);
  const held = existing[0];
  if (held !== undefined) return { created: false, role: held.role };

  await exec.insert(authMember).values({
    id: mintId("mbr"),
    organizationId: workspaceId,
    userId,
    role: EMPTY_MEMBER_ROLE,
  });
  return { created: true, role: EMPTY_MEMBER_ROLE };
}

/**
 * Set a member row's role. Returns `undefined` when there is no member row, rather than
 * creating one.
 */
export async function setMemberRole(
  exec: Executor,
  workspaceId: string,
  userId: string,
  role: string,
): Promise<string | undefined> {
  const rows = await exec
    .update(authMember)
    .set({ role })
    .where(and(eq(authMember.organizationId, workspaceId), eq(authMember.userId, userId)))
    .returning({ role: authMember.role });
  return rows[0]?.role;
}

/** How many `forms.owner` rows a workspace has. The last-owner guard's read. */
export async function countWorkspaceOwners(exec: Executor, workspaceId: string): Promise<number> {
  const rows = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(authMember)
    .where(and(eq(authMember.organizationId, workspaceId), eq(authMember.role, OWNER_MEMBER_ROLE)));
  return rows[0]?.total ?? 0;
}

/** Add one holder to an access group: team membership is the grant. */
export async function addAccessGroupHolder(
  exec: Executor,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const existing = await exec
    .select({ id: authTeamMember.id })
    .from(authTeamMember)
    .where(and(eq(authTeamMember.teamId, teamId), eq(authTeamMember.userId, userId)))
    .limit(1);
  if (existing.length > 0) return false;

  await exec.insert(authTeamMember).values({
    id: mintId("tmm"),
    teamId,
    userId,
    // The plugin's own uniqueness key, optional on its side. Written so a double grant
    // is a constraint violation rather than two rows.
    membershipKey: `${teamId}:${userId}`,
  });
  return true;
}

/** Take one holder out of an access group. The caller writes the SEC-15 revoke row. */
export async function removeAccessGroupHolder(
  exec: Executor,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const rows = await exec
    .delete(authTeamMember)
    .where(and(eq(authTeamMember.teamId, teamId), eq(authTeamMember.userId, userId)))
    .returning({ id: authTeamMember.id });
  return rows.length > 0;
}

/** Whether somebody holds one access group's grant. */
export async function holdsAccessGroup(
  exec: Executor,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const rows = await exec
    .select({ id: authTeamMember.id })
    .from(authTeamMember)
    .where(and(eq(authTeamMember.teamId, teamId), eq(authTeamMember.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** One access group naming an environment, as the drop command's refusal lists it. */
export interface EnvironmentNamingGroup {
  readonly teamId: string;
  readonly workspaceSlug: string;
  readonly name: string;
}

/**
 * Every access group whose environment scope names this environment. The drop command
 * must refuse while any group does, and never re-scope a grant itself.
 *
 * A group scoped to `all` is not a match: dropping an environment narrows what `all`
 * means rather than silencing the grant.
 */
export async function listGroupsNamingEnvironment(
  exec: Executor,
  environment: string,
): Promise<readonly EnvironmentNamingGroup[]> {
  return exec
    .select({
      teamId: authTeam.id,
      workspaceSlug: authOrganization.slug,
      name: authTeam.name,
    })
    .from(authTeam)
    .innerJoin(authOrganization, eq(authOrganization.id, authTeam.organizationId))
    .where(sql`${environment} = any(${authTeam.environments})`)
    .orderBy(asc(authOrganization.slug), asc(authTeam.name));
}

/** The live environment set, in `control.environments` row order. */
export async function listEnvironmentNames(exec: Executor): Promise<readonly string[]> {
  const rows = await exec
    .select({ name: environments.name })
    .from(environments)
    .orderBy(asc(environments.position));
  return rows.map((row) => row.name);
}

/**
 * Turn the per-workspace seed setting on or off, the setting's one write path. The caller
 * must write the SEC-15 `setting` row in the same transaction.
 */
export async function setSeedNewEditorsWithTestData(
  exec: Executor,
  workspaceId: string,
  value: boolean,
): Promise<boolean | undefined> {
  const rows = await exec
    .update(authOrganization)
    .set({ seedNewEditorsWithTestData: value })
    .where(eq(authOrganization.id, workspaceId))
    .returning({ value: authOrganization.seedNewEditorsWithTestData });
  return rows[0]?.value;
}

/**
 * Turn the per-workspace two-person switch on or off; it covers `prod` releases, `prod`
 * endpoint changes and the self-grant rule alike. The caller must write the SEC-15
 * `setting` row in the same transaction.
 */
export async function setRequireSecondApprover(
  exec: Executor,
  workspaceId: string,
  value: boolean,
): Promise<boolean | undefined> {
  const rows = await exec
    .update(authOrganization)
    .set({ requireSecondApprover: value })
    .where(eq(authOrganization.id, workspaceId))
    .returning({ value: authOrganization.requireSecondApprover });
  return rows[0]?.value;
}

/** Whether a workspace's seed setting is on. */
export async function readSeedNewEditorsWithTestData(
  exec: Executor,
  workspaceId: string,
): Promise<boolean | undefined> {
  const rows = await exec
    .select({ value: authOrganization.seedNewEditorsWithTestData })
    .from(authOrganization)
    .where(eq(authOrganization.id, workspaceId))
    .limit(1);
  return rows[0]?.value;
}

/** Resolve an account by its address, for a grant write that names a person. */
export async function findUserByEmail(
  exec: Executor,
  email: string,
): Promise<{ readonly userId: string; readonly email: string; readonly name: string } | undefined> {
  const rows = await exec
    .select({ userId: authUser.id, email: authUser.email, name: authUser.name })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1);
  return rows[0];
}

/** Resolve accounts by id, for a list that names people. */
export async function findUsersByIds(
  exec: Executor,
  userIds: readonly string[],
): Promise<readonly { readonly userId: string; readonly email: string }[]> {
  if (userIds.length === 0) return [];
  return exec
    .select({ userId: authUser.id, email: authUser.email })
    .from(authUser)
    .where(inArray(authUser.id, [...userIds]));
}

/** Whether a scope is the whole set. */
export function isScopeAll(scope: readonly string[]): boolean {
  return scope.length === 1 && scope[0] === SCOPE_ALL;
}
