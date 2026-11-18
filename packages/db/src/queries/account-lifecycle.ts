import { and, asc, eq, inArray, isNotNull, isNull, like, ne, sql } from "drizzle-orm";

import { carriesResponsesRole } from "../access-groups.js";
import {
  authAccount,
  authMember,
  authOrganization,
  authSession,
  authTeam,
  authTeamMember,
  authUser,
  authVerification,
} from "../schema/control/auth.js";
import { signInLinks } from "../schema/control/sign-in-links.js";
import { suspensionMarkers } from "../schema/control/suspension-markers.js";
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
  await exec
    .update(authUser)
    .set({ claimedAt: null, updatedAt: at })
    .where(eq(authUser.id, userId));
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
 * What an unclaimed account's newest link still holds back. `link`: it is unspent and the
 * account holds no live session, so no path may open one. `claim-session`: no password sign-in
 * but the claim route's own, while an unspent link or a spent reset awaits a verified factor.
 */
export type SignInLinkHold = "link" | "claim-session";

export async function signInLinkHold(
  exec: Executor,
  userId: string,
): Promise<SignInLinkHold | undefined> {
  const [row] = await exec
    .select({ usedAt: signInLinks.usedAt, purpose: signInLinks.purpose })
    .from(signInLinks)
    .innerJoin(authUser, eq(authUser.id, signInLinks.userId))
    .where(and(eq(signInLinks.userId, userId), isNull(authUser.claimedAt)))
    .orderBy(sql`${signInLinks.createdAt} desc`, sql`${signInLinks.id} desc`)
    .limit(1);
  if (row === undefined) return undefined;
  if (row.usedAt === null) {
    // A session already held is the claim's own, minted before a resend crossed it; a reset
    // and a reactivation delete every session in the transaction that issues their link.
    const live = await exec
      .select({ id: authSession.id })
      .from(authSession)
      .where(and(eq(authSession.userId, userId), sql`${authSession.expiresAt} > now()`))
      .limit(1);
    return live.length === 0 ? "link" : "claim-session";
  }
  return row.purpose === "reset" ? "claim-session" : undefined;
}

/** Whether the account was ever sent a reset or reactivation link. */
export async function wasSentResetOrReactivationLink(
  exec: Executor,
  userId: string,
): Promise<boolean> {
  const rows = await exec
    .select({ id: signInLinks.id })
    .from(signInLinks)
    .where(
      and(eq(signInLinks.userId, userId), inArray(signInLinks.purpose, ["reset", "reactivated"])),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Delete every second-factor challenge the vendor holds open for the account, and its attempt
 * counter, so a sign-in begun before a reset or a disable cannot be finished after it.
 */
export async function deletePendingTwoFactorSignIns(exec: Executor, userId: string): Promise<void> {
  const challenges = await exec
    .delete(authVerification)
    .where(and(like(authVerification.identifier, "2fa-%"), eq(authVerification.value, userId)))
    .returning({ identifier: authVerification.identifier });
  if (challenges.length === 0) return;
  await exec.delete(authVerification).where(
    inArray(
      authVerification.identifier,
      challenges.map((row) => `2fa-attempts-${row.identifier}`),
    ),
  );
}

/** Delete every device the vendor remembers as having passed the account's second factor. */
export async function deleteTrustedDevices(exec: Executor, userId: string): Promise<void> {
  await exec
    .delete(authVerification)
    .where(
      and(like(authVerification.identifier, "trust-device-%"), eq(authVerification.value, userId)),
    );
}

/** The newest link the account was sent, or `undefined` when it has none. */
export async function newestSignInLink(
  exec: Executor,
  userId: string,
): Promise<{ readonly purpose: string; readonly issuedBy: string } | undefined> {
  const [row] = await exec
    .select({ purpose: signInLinks.purpose, issuedBy: signInLinks.issuedBy })
    .from(signInLinks)
    .where(eq(signInLinks.userId, userId))
    .orderBy(sql`${signInLinks.createdAt} desc`, sql`${signInLinks.id} desc`)
    .limit(1);
  return row;
}

/** The purpose of the newest link the account was sent, or `undefined` when it has none. */
export async function newestSignInLinkPurpose(
  exec: Executor,
  userId: string,
): Promise<string | undefined> {
  return (await newestSignInLink(exec, userId))?.purpose;
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

/** Suspend one hold, recording who performed the act the suspension answers to. */
export async function suspendHold(
  exec: Executor,
  input: {
    readonly teamId: string;
    readonly userId: string;
    readonly by: string;
    readonly at: Date;
  },
): Promise<void> {
  await exec
    .update(authTeamMember)
    .set({ suspendedAt: input.at, suspendedBy: input.by })
    .where(and(eq(authTeamMember.teamId, input.teamId), eq(authTeamMember.userId, input.userId)));
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
  return [...new Set([...workspaceAdministrators, ...siteAdministrators].map((row) => row.userId))];
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

/** Every active, claimed Site administrator, the only ones any guard counts. */
export async function listActiveSiteAdministratorIds(exec: Executor): Promise<readonly string[]> {
  const rows = await exec
    .select({ userId: authUser.id })
    .from(authUser)
    .where(
      and(
        eq(authUser.role, SITE_ADMINISTRATOR_ROLE),
        isNull(authUser.disabledAt),
        isNotNull(authUser.claimedAt),
      ),
    )
    .orderBy(asc(authUser.id));
  return rows.map((row) => row.userId);
}

/** Make the account a Site administrator, or take the role away. */
export async function setSiteAdministrator(
  exec: Executor,
  input: { readonly userId: string; readonly administrator: boolean; readonly at: Date },
): Promise<void> {
  await exec
    .update(authUser)
    .set({ role: input.administrator ? SITE_ADMINISTRATOR_ROLE : null, updatedAt: input.at })
    .where(eq(authUser.id, input.userId));
}

const SITE_ADMINISTRATORS_LOCK_CLASS = "qcms.site-administrators";

/**
 * Serialise every act that can change who counts as an active Site administrator, so two
 * acts never each see the other's target as a second one. Tried, never waited for.
 */
export async function tryLockSiteAdministrators(exec: Executor): Promise<boolean> {
  const result = await exec.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtext(${SITE_ADMINISTRATORS_LOCK_CLASS}), 0) as locked`,
  );
  return result.rows[0]?.locked === true;
}

const openMarker = isNull(suspensionMarkers.liftedAt);

/**
 * Open the account's suspension run for one reset or reactivation: an account-wide marker
 * naming the performer, and one per access group whose hold the act suspended.
 */
export async function openSuspensionRun(
  exec: Executor,
  input: {
    readonly userId: string;
    readonly performedBy: string;
    readonly at: Date;
    readonly teamIds: readonly string[];
  },
): Promise<void> {
  const teams: (string | null)[] = [null, ...input.teamIds];
  await exec
    .insert(suspensionMarkers)
    .values(
      teams.map((teamId) => ({
        userId: input.userId,
        teamId,
        performedBy: input.performedBy,
        createdAt: input.at,
      })),
    )
    .onConflictDoNothing();
}

/** Who performed a reset or reactivation the account still owes a re-confirmation for. */
export async function suspensionPerformers(
  exec: Executor,
  userId: string,
): Promise<readonly string[]> {
  const rows = await exec
    .selectDistinct({ performedBy: suspensionMarkers.performedBy })
    .from(suspensionMarkers)
    .where(and(eq(suspensionMarkers.userId, userId), openMarker))
    .orderBy(asc(suspensionMarkers.performedBy));
  return rows.map((row) => row.performedBy);
}

/** Whether the account's suspension run is open. */
export async function hasOpenSuspension(exec: Executor, userId: string): Promise<boolean> {
  const rows = await exec
    .select({ id: suspensionMarkers.id })
    .from(suspensionMarkers)
    .where(and(eq(suspensionMarkers.userId, userId), openMarker))
    .limit(1);
  return rows.length > 0;
}

/** Who an open marker on this account's hold of this group names, or `undefined`. */
export async function openHoldMarker(
  exec: Executor,
  userId: string,
  teamId: string,
): Promise<string | undefined> {
  const [row] = await exec
    .select({ performedBy: suspensionMarkers.performedBy })
    .from(suspensionMarkers)
    .where(
      and(eq(suspensionMarkers.userId, userId), eq(suspensionMarkers.teamId, teamId), openMarker),
    )
    .orderBy(asc(suspensionMarkers.createdAt))
    .limit(1);
  return row?.performedBy;
}

/** Mark one hold as owing a re-confirmation, naming who wrote it suspended. */
export async function markHoldSuspended(
  exec: Executor,
  input: {
    readonly userId: string;
    readonly teamId: string;
    readonly performedBy: string;
    readonly at: Date;
  },
): Promise<void> {
  await exec
    .insert(suspensionMarkers)
    .values({
      userId: input.userId,
      teamId: input.teamId,
      performedBy: input.performedBy,
      createdAt: input.at,
    })
    .onConflictDoNothing();
}

/**
 * Lift every marker on one hold, as a re-confirmation by `by` does, then end the account's
 * run if nothing more is owed.
 */
export async function liftHoldMarkers(
  exec: Executor,
  input: {
    readonly userId: string;
    readonly teamId: string;
    readonly by: string;
    readonly at: Date;
  },
): Promise<void> {
  await exec
    .update(suspensionMarkers)
    .set({ liftedAt: input.at, liftedBy: input.by })
    .where(
      and(
        eq(suspensionMarkers.userId, input.userId),
        eq(suspensionMarkers.teamId, input.teamId),
        openMarker,
      ),
    );
  await settleSuspensionRun(exec, input);
}

/**
 * End the account's run when it is claimed and active and no group marker is open. The claim
 * and every lift call it, so a run with nothing left to re-confirm never outlives the claim.
 */
export async function settleSuspensionRun(
  exec: Executor,
  input: { readonly userId: string; readonly by: string; readonly at: Date },
): Promise<void> {
  const [account] = await exec
    .select({ claimedAt: authUser.claimedAt, disabledAt: authUser.disabledAt })
    .from(authUser)
    .where(eq(authUser.id, input.userId))
    .limit(1);
  if (account === undefined || account.claimedAt === null || account.disabledAt !== null) return;
  const owed = await exec
    .select({ id: suspensionMarkers.id })
    .from(suspensionMarkers)
    .where(
      and(
        eq(suspensionMarkers.userId, input.userId),
        isNotNull(suspensionMarkers.teamId),
        openMarker,
      ),
    )
    .limit(1);
  if (owed.length > 0) return;
  await exec
    .update(suspensionMarkers)
    .set({ liftedAt: input.at, liftedBy: input.by })
    .where(
      and(eq(suspensionMarkers.userId, input.userId), isNull(suspensionMarkers.teamId), openMarker),
    );
}

/**
 * Lift the markers a deleted group leaves, for every account `by` took no part in: neither the
 * account itself nor a performer of its run. Theirs stay open, so deleting a group never ends
 * a run for either of them.
 */
export async function liftMarkersOfDeletedGroup(
  exec: Executor,
  input: { readonly teamId: string; readonly by: string; readonly at: Date },
): Promise<void> {
  const owed = await exec
    .selectDistinct({ userId: suspensionMarkers.userId })
    .from(suspensionMarkers)
    .where(
      and(
        eq(suspensionMarkers.teamId, input.teamId),
        ne(suspensionMarkers.userId, input.by),
        openMarker,
      ),
    );
  for (const { userId } of owed) {
    if ((await suspensionPerformers(exec, userId)).includes(input.by)) continue;
    await liftHoldMarkers(exec, { userId, teamId: input.teamId, by: input.by, at: input.at });
  }
}
