/**
 * The resolver (SEC-3, ADR-41's mechanism bullet; task 069).
 *
 * One job: turn a caller and a workspace into the grants they hold there, so
 * {@link decideAccess} can judge an act. It runs on the **control** pool, because an
 * environment role holds no privilege at all on `member`, `team` or `teamMember` (Q40) -
 * which is the property that makes "a defect on the respondent path cannot read a grant
 * row" true at the database rather than in a review.
 *
 * # The installation claim, as a grant shape rather than a special case
 *
 * Q29: the claim **administers and reads no data anywhere**. Settings, user accounts,
 * memberships and environments across every workspace; no response read, no export and
 * no erasure, and authoring needs a `forms.` grant in that form's workspace.
 *
 * That administration set is **exactly `forms.owner`'s statements**, applied to every
 * workspace rather than to one. So the claim is modelled as a `forms.owner` grant in
 * whichever workspace is being asked about, and nothing else: it reaches membership, the
 * workspace's settings and the audit everywhere, and it reaches no form, release, link,
 * webhook or response anywhere. The matrix's `never` row falls out of the same shape
 * rather than being written twice.
 *
 * The four acts the claim holds **alone** - creating a workspace, marking the shared one,
 * the environment list and the installation-wide dead-letter list - are the
 * `installationOnly` rows of `route-policy.ts`, which no role reaches at all.
 */

import {
  listGrantsForUser,
  listMemberWorkspacesForUser,
  listWorkspaces,
  resolveMembership,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import { type AccessDecision, type AccessRequest, type HeldGrant, decideAccess } from "./policy.js";

/**
 * The SEC-3 claim's value on `user.role`.
 *
 * `input: false` on the better-auth field, so no request body can set it, and it is
 * installation-wide: a claim is not a membership and carries no workspace.
 */
export const INSTALLATION_CLAIM = "admin";

/** Whether this principal holds the installation-wide claim. */
export function holdsInstallationClaim(role: string | undefined): boolean {
  return role === INSTALLATION_CLAIM;
}

/**
 * The claim's grant, in whichever workspace is being asked about.
 *
 * `forms.owner`'s statements with the whole of both scopes. The scopes are irrelevant to
 * it - workspace administration has no environment or form dimension at all - so `all`
 * widens nothing, and the role's own silence about `response` is what keeps the matrix's
 * `never` row true for this account.
 */
const CLAIM_GRANT: HeldGrant = {
  role: "forms.owner",
  environments: ["all"],
  forms: ["all"],
};

/** What the caller holds in one workspace, with the claim folded in. */
export interface ResolvedMembership {
  readonly workspaceId: string;
  readonly memberRole: string | undefined;
  readonly grants: readonly HeldGrant[];
}

/**
 * Resolve one caller's grants in one workspace.
 *
 * Two reads and no join, because the member row and the team rows answer different
 * questions (`queries/grants.ts` says why). The claim is added as a grant rather than
 * short-circuiting the decision, so one code path judges every caller and a claim holder
 * is refused a response read by the same statement evaluation that refuses anybody else.
 */
export async function resolveGrants(
  exec: Executor,
  input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly claim: boolean;
  },
): Promise<ResolvedMembership> {
  const membership = await resolveMembership(exec, input.userId, input.workspaceId);
  const grants: HeldGrant[] = membership.grants.map((grant) => ({
    role: grant.role,
    environments: grant.environments,
    forms: grant.forms,
    name: grant.name,
  }));
  if (input.claim) grants.push(CLAIM_GRANT);
  return { workspaceId: input.workspaceId, memberRole: membership.memberRole, grants };
}

/** Decide one act in one workspace. */
export async function decideInWorkspace(
  exec: Executor,
  input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly claim: boolean;
    readonly request: AccessRequest;
  },
): Promise<AccessDecision> {
  const resolved = await resolveGrants(exec, input);
  return decideAccess({
    memberRole: resolved.memberRole,
    grants: resolved.grants,
    request: input.request,
  });
}

/**
 * Every workspace the caller could act in at all, with what they hold in each.
 *
 * The read behind the `caller` workspace source and behind the capability endpoint. One
 * pair of statements for the whole installation rather than one per workspace, so a
 * caller holding grants in five workspaces costs two round trips and not ten.
 *
 * **For a claim holder it is every workspace**, because the claim's administration spans
 * all of them; for everybody else it is the workspaces they have a `member` row or a team
 * grant in. A workspace nobody granted them anything in is absent, which is what makes
 * the library lists a filter rather than a yes: ADR-41's whole premise is that two groups
 * share an installation without seeing each other's forms and questions.
 */
export async function resolveCallerWorkspaces(
  exec: Executor,
  input: { readonly userId: string; readonly claim: boolean },
): Promise<readonly ResolvedMembership[]> {
  const [memberships, teamGrants] = await Promise.all([
    listMemberWorkspacesForUser(exec, input.userId),
    listGrantsForUser(exec, input.userId),
  ]);

  const byWorkspace = new Map<string, { memberRole?: string; grants: HeldGrant[] }>();
  const slot = (workspaceId: string): { memberRole?: string; grants: HeldGrant[] } => {
    const existing = byWorkspace.get(workspaceId);
    if (existing !== undefined) return existing;
    const fresh: { memberRole?: string; grants: HeldGrant[] } = { grants: [] };
    byWorkspace.set(workspaceId, fresh);
    return fresh;
  };

  for (const membership of memberships) slot(membership.workspaceId).memberRole = membership.role;
  for (const grant of teamGrants) {
    slot(grant.workspaceId).grants.push({
      role: grant.role,
      environments: grant.environments,
      forms: grant.forms,
      name: grant.name,
    });
  }

  if (input.claim) {
    // Every workspace, including ones the claim holder has no row in at all. An
    // administrator's administration is installation-wide (Q29), and a workspace they
    // were never made a member of is still one they administer.
    for (const workspace of await listWorkspaces(exec)) slot(workspace.id);
  }

  return [...byWorkspace.entries()].map(([workspaceId, held]) => ({
    workspaceId,
    memberRole: held.memberRole,
    grants: input.claim ? [...held.grants, CLAIM_GRANT] : held.grants,
  }));
}

/**
 * The workspaces, out of {@link resolveCallerWorkspaces}, in which the caller holds one
 * act.
 *
 * The narrowing the library lists apply to their own reads. It is the same decision
 * function the middleware uses, per workspace, so a list can never show a row an act on
 * that row would be refused for.
 */
export function workspacesAllowing(
  resolved: readonly ResolvedMembership[],
  request: AccessRequest,
): readonly string[] {
  return resolved
    .filter(
      (membership) =>
        decideAccess({
          memberRole: membership.memberRole,
          grants: membership.grants,
          request,
        }).allowed,
    )
    .map((membership) => membership.workspaceId);
}
