import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { carriesResponsesRole } from "../access-groups.js";
import {
  authAccount,
  authMember,
  authOrganization,
  authTeam,
  authTeamMember,
  authUser,
} from "../schema/control/auth.js";
import { signInLinks } from "../schema/control/sign-in-links.js";
import { SITE_ADMINISTRATOR_ROLE } from "./auth.js";
import type { Executor } from "./executor.js";
import { listWorkspaceAdministrators, OWNER_MEMBER_ROLE } from "./grants.js";

// Disable, reactivation, credential and factor reset (`docs/WORKSPACE_ACCESS.md` section 7).
// Each helper runs inside the caller's transaction, under the account's lock.

/** The provider id better-auth stores an email and password credential under. */
const CREDENTIAL_PROVIDER_ID = "credential";

/**
 * Mark the account disabled and take away its Site administrator role, so a reactivation
 * never restores it. Memberships are kept.
 */
export async function disableAccount(exec: Executor, userId: string, at: Date): Promise<void> {
  await exec
    .update(authUser)
    .set({ disabledAt: at, role: null, updatedAt: at })
    .where(eq(authUser.id, userId));
}

/**
 * Clear the disabled flag and the claim together: the account holds nothing again until
 * the person signs in through the emailed link and verifies a new second factor.
 */
export async function reactivateAccount(exec: Executor, userId: string, at: Date): Promise<void> {
  await exec
    .update(authUser)
    .set({ disabledAt: null, claimedAt: null, updatedAt: at })
    .where(eq(authUser.id, userId));
}

/** Return a claimed account to unclaimed, which holds nothing until it is claimed again. */
export async function unclaimAccount(exec: Executor, userId: string, at: Date): Promise<void> {
  await exec.update(authUser).set({ claimedAt: null, updatedAt: at }).where(eq(authUser.id, userId));
}

/**
 * Delete the account's password credential, so `POST /sign-in/email` cannot admit it and the
 * emailed link is the only way to set a new one.
 */
export async function deleteAccountPassword(exec: Executor, userId: string): Promise<void> {
  await exec
    .delete(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, CREDENTIAL_PROVIDER_ID)));
}

/** Whether the account holds a password credential. Never reads the hash. */
export async function holdsAccountPassword(exec: Executor, userId: string): Promise<boolean> {
  const rows = await exec
    .select({ id: authAccount.id })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.userId, userId),
        eq(authAccount.providerId, CREDENTIAL_PROVIDER_ID),
        isNotNull(authAccount.password),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Whether an unclaimed account is waiting on an emailed link it has not used: its newest link
 * is unspent. A password sign-in is refused while it is, so a reset or a reactivation is
 * finished through the link and never with a password alone.
 */
export async function awaitsSignInLink(exec: Executor, userId: string): Promise<boolean> {
  const [row] = await exec
    .select({ usedAt: signInLinks.usedAt })
    .from(signInLinks)
    .innerJoin(authUser, eq(authUser.id, signInLinks.userId))
    .where(and(eq(signInLinks.userId, userId), isNull(authUser.claimedAt)))
    .orderBy(sql`${signInLinks.createdAt} desc`, sql`${signInLinks.id} desc`)
    .limit(1);
  return row !== undefined && row.usedAt === null;
}

/** The purpose of the newest link the account was sent, or `undefined` when it has none. */
export async function newestSignInLinkPurpose(
  exec: Executor,
  userId: string,
): Promise<string | undefined> {
  const [row] = await exec
    .select({ purpose: signInLinks.purpose })
    .from(signInLinks)
    .where(eq(signInLinks.userId, userId))
    .orderBy(sql`${signInLinks.createdAt} desc`, sql`${signInLinks.id} desc`)
    .limit(1);
  return row?.purpose;
}

/** How many Site administrators are active and claimed, the only ones any guard counts. */
export async function countActiveSiteAdministrators(exec: Executor): Promise<number> {
  const [row] = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(authUser)
    .where(
      and(
        eq(authUser.role, SITE_ADMINISTRATOR_ROLE),
        isNull(authUser.disabledAt),
        isNotNull(authUser.claimedAt),
      ),
    );
  return row?.total ?? 0;
}

/** One access-group membership suspended by a reset or a reactivation. */
export interface SuspendedHold {
  readonly teamId: string;
  readonly workspaceId: string;
  readonly groupName: string;
}

/**
 * Suspend every membership the account holds of a group carrying a response role, recording
 * who performed the act. Other memberships, and the Workspace administrator flag, are untouched.
 */
export async function suspendResponseMemberships(
  exec: Executor,
  input: { readonly userId: string; readonly by: string; readonly at: Date },
): Promise<readonly SuspendedHold[]> {
  const held = await exec
    .select({
      teamId: authTeam.id,
      workspaceId: authTeam.organizationId,
      groupName: authTeam.name,
      roles: authTeam.roles,
    })
    .from(authTeamMember)
    .innerJoin(authTeam, eq(authTeam.id, authTeamMember.teamId))
    .where(eq(authTeamMember.userId, input.userId))
    .orderBy(asc(authTeam.organizationId), asc(authTeam.name));
  const suspended = held.filter((row) => carriesResponsesRole(row.roles));
  if (suspended.length === 0) return [];
  await exec
    .update(authTeamMember)
    .set({ suspendedAt: input.at, suspendedBy: input.by })
    .where(
      and(
        eq(authTeamMember.userId, input.userId),
        inArray(
          authTeamMember.teamId,
          suspended.map((row) => row.teamId),
        ),
      ),
    );
  return suspended.map(({ teamId, workspaceId, groupName }) => ({
    teamId,
    workspaceId,
    groupName,
  }));
}

/** One membership's suspension, as the re-confirmation reads it. */
export interface HoldSuspension {
  readonly suspendedAt: Date | null;
  readonly suspendedBy: string | null;
}

/** The suspension state of one hold, or `undefined` when the account does not hold the group. */
export async function findHoldSuspension(
  exec: Executor,
  teamId: string,
  userId: string,
): Promise<HoldSuspension | undefined> {
  const [row] = await exec
    .select({ suspendedAt: authTeamMember.suspendedAt, suspendedBy: authTeamMember.suspendedBy })
    .from(authTeamMember)
    .where(and(eq(authTeamMember.teamId, teamId), eq(authTeamMember.userId, userId)))
    .limit(1);
  return row;
}

/** Lift one hold's suspension. */
export async function reconfirmHold(exec: Executor, teamId: string, userId: string): Promise<void> {
  await exec
    .update(authTeamMember)
    .set({ suspendedAt: null, suspendedBy: null })
    .where(and(eq(authTeamMember.teamId, teamId), eq(authTeamMember.userId, userId)));
}

/**
 * The active, claimed accounts that could re-confirm a membership in this workspace: its
 * Workspace administrators and every Site administrator.
 */
export async function listActiveAdministratorsFor(
  exec: Executor,
  workspaceId: string,
): Promise<readonly string[]> {
  const active = and(isNull(authUser.disabledAt), isNotNull(authUser.claimedAt));
  const workspaceAdministrators = await exec
    .select({ userId: authUser.id })
    .from(authMember)
    .innerJoin(authUser, eq(authUser.id, authMember.userId))
    .where(
      and(
        eq(authMember.organizationId, workspaceId),
        eq(authMember.role, OWNER_MEMBER_ROLE),
        active,
      ),
    );
  const siteAdministrators = await exec
    .select({ userId: authUser.id })
    .from(authUser)
    .where(and(eq(authUser.role, SITE_ADMINISTRATOR_ROLE), active));
  return [
    ...new Set([...workspaceAdministrators, ...siteAdministrators].map((row) => row.userId)),
  ];
}

/** One access group an account holds, as the disable confirmation lists it. */
export interface AccountGroupHolding {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly teamId: string;
  readonly groupName: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
  readonly suspended: boolean;
}

/** One workspace the account is a Workspace administrator of. */
export interface AccountAdministration {
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** No other active, claimed Workspace administrator of this workspace exists. */
  readonly last: boolean;
}

/** What an account holds across every workspace, for the disable confirmation. */
export interface AccountHoldings {
  readonly groups: readonly AccountGroupHolding[];
  readonly responseGroups: readonly AccountGroupHolding[];
  readonly administratorOf: readonly AccountAdministration[];
}

export async function listAccountHoldings(
  exec: Executor,
  userId: string,
): Promise<AccountHoldings> {
  const groups = await exec
    .select({
      workspaceId: authOrganization.id,
      workspaceName: authOrganization.name,
      teamId: authTeam.id,
      groupName: authTeam.name,
      roles: authTeam.roles,
      environments: authTeam.environments,
      suspended: sql<boolean>`${authTeamMember.suspendedAt} is not null`,
    })
    .from(authTeamMember)
    .innerJoin(authTeam, eq(authTeam.id, authTeamMember.teamId))
    .innerJoin(authOrganization, eq(authOrganization.id, authTeam.organizationId))
    .where(eq(authTeamMember.userId, userId))
    .orderBy(asc(authOrganization.name), asc(authTeam.name));

  const administered = await exec
    .select({ workspaceId: authOrganization.id, workspaceName: authOrganization.name })
    .from(authMember)
    .innerJoin(authOrganization, eq(authOrganization.id, authMember.organizationId))
    .where(and(eq(authMember.userId, userId), eq(authMember.role, OWNER_MEMBER_ROLE)))
    .orderBy(asc(authOrganization.name));
  const administratorOf: AccountAdministration[] = [];
  for (const row of administered) {
    const administrators = await listWorkspaceAdministrators(exec, row.workspaceId);
    const others = administrators.filter((admin) => admin.counts && admin.userId !== userId);
    administratorOf.push({ ...row, last: others.length === 0 });
  }

  return {
    groups,
    responseGroups: groups.filter((group) => carriesResponsesRole(group.roles)),
    administratorOf,
  };
}

/** Every workspace the account holds anything in, which is where a site act is mirrored. */
export async function listWorkspacesHeldBy(
  exec: Executor,
  userId: string,
): Promise<readonly string[]> {
  const members = await exec
    .select({ workspaceId: authMember.organizationId })
    .from(authMember)
    .where(eq(authMember.userId, userId));
  const teams = await exec
    .select({ workspaceId: authTeam.organizationId })
    .from(authTeamMember)
    .innerJoin(authTeam, eq(authTeam.id, authTeamMember.teamId))
    .where(eq(authTeamMember.userId, userId));
  return [...new Set([...members, ...teams].map((row) => row.workspaceId))].sort();
}
