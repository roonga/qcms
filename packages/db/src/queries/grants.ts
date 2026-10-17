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

/**
 * Membership and grants, as rows (ADR-41, Q32, Q45; task 069).
 *
 * # Why QCMS writes these rows at all, when they are better-auth's tables
 *
 * Q45: **grants are written only through QCMS endpoints**, and the plugin's own team and
 * member write endpoints are refused for everyone, a `forms.owner` included. Two reasons
 * the two-path shape could not answer. The QCMS endpoints are where the validation and
 * the SEC-15 rows live, so a second path is a path on which a grant changes without an
 * audit row. And the plugin's **removal cascades** run inside the library, below any
 * endpoint QCMS could gate, so the only way to be sure a removal is audited is for no
 * removal to originate there.
 *
 * So the writes are here, in the package that owns the schema, and the API slice is what
 * validates and audits around them. The reads are here too, for the resolver, the
 * capability endpoint and the membership list.
 *
 * # The shape, read off ADR-41 rather than invented
 *
 *   - A **workspace** is an `organization` row (task 068).
 *   - **`forms.owner` is the `member` row's role**, which is the plugin's `creatorRole`.
 *   - **Every other grant is a `team`** whose typed additional fields carry one role and
 *     its scope: `environments` as a set or `all`, `forms` as a list or `all`. Team
 *     membership is the grant, so a user in three teams holds three grants.
 *   - **Every grant holder carries a `member` row with the empty role** (finding G),
 *     because the plugin's own team queries assume a team member is a member of the
 *     organisation the team belongs to. That row grants nothing;
 *     {@link ensureWorkspaceMember} is what writes it and {@link EMPTY_MEMBER_ROLE} is
 *     the name whose statements are empty.
 *
 * # Ids
 *
 * better-auth mints its own ids on the rows it writes; these rows are QCMS's, so they
 * carry a QCMS-minted id with a readable prefix. Nothing joins on the shape of an id and
 * no id is parsed - the prefix is for an operator reading a row in `psql`.
 */

/**
 * The `member` role whose statements are empty (Q32's configuration guards, finding G).
 *
 * The plugin's own default name, overridden in `features/auth/instance.ts` with an empty
 * statement set, so a row carrying it grants nothing at all and exists only to make the
 * person a member of the workspace.
 */
export const EMPTY_MEMBER_ROLE = "member";

/** The `member` role that is a grant: ADR-41's workspace owner (Q32, Q38). */
export const OWNER_MEMBER_ROLE = "forms.owner";

/** The scope token meaning "every environment" or "every form". */
const SCOPE_ALL = "all";

/** A QCMS-minted id for a row in one of the plugin's tables. */
function mintId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** One access group: a team row, which is one grant with its scope. */
export interface AccessGroupRow {
  readonly teamId: string;
  readonly workspaceId: string;
  /** The stored name, `<environments>.<plane>.<role>[.<label>]` (Q37). */
  readonly name: string;
  /** One of Q38's six roles, minus `forms.owner`, which is the member row's. */
  readonly role: string;
  /** The environment scope: `["all"]`, or one or more environment names. */
  readonly environments: readonly string[];
  /** The form scope: `["all"]`, or one or more form ids (Q28). */
  readonly forms: readonly string[];
  /** Task C3's join key. Declared now, written by nothing in this task (Q39). */
  readonly externalGroupId: string | null;
  readonly createdAt: Date;
}

/** The columns {@link AccessGroupRow} carries, as one Drizzle projection. */
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
  /** True while the workspace is archived, so a caller can see why nothing works. */
  readonly workspaceArchived: boolean;
}

/** What a caller holds in one workspace: the member row's role, and every team grant. */
export interface Membership {
  readonly workspaceId: string;
  /**
   * The `member` row's role, or `undefined` when the caller has no member row at all.
   *
   * `forms.owner` is a grant; {@link EMPTY_MEMBER_ROLE} is not - it grants nothing and
   * exists to make a team grant expressible (finding G).
   */
  readonly memberRole: string | undefined;
  /** Every team grant the caller holds in this workspace. */
  readonly grants: readonly AccessGroupRow[];
}

/**
 * Resolve one caller's membership in one workspace: the `member` row and the teams.
 *
 * The resolver's one read (SEC-3). Two statements rather than a join, because the member
 * row and the team rows answer different questions and a caller may hold either without
 * the other - an owner with no access group, and (until finding G's rule is enforced
 * everywhere) a team grant whose member row is what {@link ensureWorkspaceMember}
 * guarantees.
 *
 * Runs on the **control** pool: an environment role holds no privilege at all on
 * `member`, `team` or `teamMember` (Q40).
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

/**
 * Every grant one caller holds, across every workspace.
 *
 * The capability endpoint's read (Q35): it is how everybody who is not an owner or the
 * installation administrator learns their own grants, since the membership list itself is
 * theirs alone to see. One statement, so a caller holding grants in five workspaces costs
 * one round trip rather than five.
 */
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

/** One member row as the membership list reports it. */
export interface WorkspaceMemberRow {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly createdAt: Date;
}

/**
 * Every `member` row in one workspace, with the account's name and address.
 *
 * Readable by that workspace's **owners** and by the installation administrator, and by
 * nobody else (Q35). The API is what enforces the readership; this is the read.
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
 * Whether a stored name is already taken **in this workspace**.
 *
 * Uniqueness is per workspace and is the QCMS write path's, because the plugin does not
 * enforce it on team names (Q37 rule 4). The same name in another workspace is accepted,
 * which is what criterion 12 asserts on both halves.
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

/** What {@link createAccessGroup} writes. The name is the caller's, already validated. */
export interface NewAccessGroup {
  readonly workspaceId: string;
  readonly name: string;
  readonly role: string;
  readonly environments: readonly string[];
  readonly forms: readonly string[];
}

/**
 * Create one access group.
 *
 * The validation is the API slice's, because that is where the refusals have to be
 * legible and where the SEC-15 row is written. What this does is the one insert, with a
 * QCMS-minted id.
 *
 * **`externalGroupId` is not a parameter.** It is `input: false` and is written only by
 * the task C3 sync path (Q39), so there is no argument here for a caller to set it
 * through - which is the absence criterion 15 asserts.
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
 * Re-scope or rename one access group.
 *
 * The role is **not** changeable: a different role is a different grant, and an update
 * that moved one would make "team membership is the grant" a statement about a row whose
 * meaning had changed under the people holding it. The API refuses the change and the
 * operator deletes the group and creates the one they meant, which is two audited acts
 * rather than one unaudited change of meaning.
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
 * Remove one access group, and with it every grant it carried.
 *
 * `teamMember` references `team` with `ON DELETE cascade`, so the holders' rows go with
 * it - which is exactly the cascade Q45 says must not originate at a plugin endpoint.
 * Here it originates at a QCMS endpoint, which is what lets the revoke be audited: the
 * API reads the holders first, writes one SEC-15 `revoke` row per holder, and then calls
 * this inside the same transaction.
 */
export async function deleteAccessGroup(exec: Executor, teamId: string): Promise<boolean> {
  const rows = await exec.delete(authTeam).where(eq(authTeam.id, teamId)).returning({
    id: authTeam.id,
  });
  return rows.length > 0;
}

/**
 * Make somebody a member of a workspace with the **empty** role, unless they already have
 * a member row (finding G).
 *
 * Every grant holder carries one, because the plugin's own team endpoints and queries
 * assume the user is a member of the organisation the team belongs to, so a person
 * holding only a team grant and no member row is a shape the library does not model. The
 * row grants nothing on its own: criterion 17 asserts that a person holding it and no
 * team reaches exactly what an administrator with no grant reaches, which is nothing.
 *
 * **It never downgrades an owner.** An existing row is left exactly as it is, so adding a
 * `forms.owner` to an access group does not quietly take their ownership away.
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
 * Set a member row's role: `forms.owner`, or back to the empty role.
 *
 * The only grant that is not a team (Q32). Returns `undefined` when there is no member
 * row to set, so the API answers a 404 rather than silently creating one: a workspace
 * owner is somebody who was made a member first.
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

/** Add one holder to an access group. The grant itself (Q32: team membership is the grant). */
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
    // The plugin's own uniqueness key, `input: false` and optional on its side. QCMS
    // writes it so the pair is unique at the database as well as in the read above,
    // which is what makes a double grant a constraint violation rather than two rows.
    membershipKey: `${teamId}:${userId}`,
  });
  return true;
}

/** Take one holder out of an access group. The revoke (Q56: it writes an audit row). */
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

/** One access group naming an environment, named in the drop command's refusal (Q44). */
export interface EnvironmentNamingGroup {
  readonly teamId: string;
  readonly workspaceSlug: string;
  /** The stored name. The refusal prints the **derived** full name beside it. */
  readonly name: string;
}

/**
 * Every access group whose environment scope names this environment (Q24 with Q43, Q44).
 *
 * The access-group half of the environment drop check, which Q44 moved from task 064 to
 * this one because a team carrying an `environments` field exists only from here. The
 * command **refuses** while any group names the environment and **names those groups**,
 * so an operator sees which grants the drop would silence rather than discovering it
 * afterwards. It refuses and never archives (Q43): a command that quietly re-scoped a
 * grant an owner wrote would be editing the authorisation model as a side effect of an
 * operator act.
 *
 * **A group scoped to `all` is not a match**, and that is the ruling rather than an
 * omission: `all` names no environment, so dropping one does not silence that grant - it
 * narrows what `all` means, which is what `all` is for. Q61 draws the same line one
 * control over, where a grant scoped to `all` leaves the audit row's `environment` empty
 * because the act names none.
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

/**
 * The live environment set, in the order of the rows in `control.environments`.
 *
 * Q42's ordering is "the order of the rows", and the rows carry a `position`, so this is
 * that order read once and handed to the name derivation rather than each call site
 * sorting for itself.
 */
export async function listEnvironmentNames(exec: Executor): Promise<readonly string[]> {
  const rows = await exec
    .select({ name: environments.name })
    .from(environments)
    .orderBy(asc(environments.position));
  return rows.map((row) => row.name);
}

/**
 * Turn the per-workspace seed setting on or off (Q39, Q57).
 *
 * `seedNewEditorsWithTestData` is `input: false` on the plugin's side, so no request body
 * sets it and this is its one write path. Returns the value as stored, or `undefined`
 * when there is no such workspace.
 *
 * Turning it on is an owner's deliberate act and **writes a SEC-15 row of kind
 * `setting`** (Q61). That row is the API slice's, written in the same transaction as this
 * update, because a setting change without its audit row is the one failure this control
 * may not have.
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
