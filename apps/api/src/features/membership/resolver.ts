// Runs on the control pool: an environment role holds no privilege on `member`, `team` or
// `teamMember`, so a defect on the respondent path cannot read a grant row (SEC-3).

import {
  listGrantsForUser,
  listMemberWorkspacesForUser,
  listWorkspaces,
  resolveMembership,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import { type AccessDecision, type AccessRequest, type HeldGrant, decideAccess } from "./policy.js";

// The better-auth field is declared `input: false`, so no request body can set it.
export const INSTALLATION_CLAIM = "admin";

export function holdsInstallationClaim(role: string | undefined): boolean {
  return role === INSTALLATION_CLAIM;
}

// The installation claim is modelled as a `forms.owner` grant in whichever workspace is
// asked about, so one code path judges every caller. That role's silence about `response`
// is what keeps a claim holder out of response data.
const CLAIM_GRANT: HeldGrant = {
  role: "forms.owner",
  environments: ["all"],
  forms: ["all"],
};

export interface ResolvedMembership {
  readonly workspaceId: string;
  readonly memberRole: string | undefined;
  readonly grants: readonly HeldGrant[];
}

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

// A workspace nobody granted the caller anything in is absent, which is what keeps two
// groups sharing an installation from seeing each other's forms and questions.
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
    // Including workspaces the claim holder has no membership row in: the claim is
    // installation-wide.
    for (const workspace of await listWorkspaces(exec)) slot(workspace.id);
  }

  return [...byWorkspace.entries()].map(([workspaceId, held]) => ({
    workspaceId,
    memberRole: held.memberRole,
    grants: input.claim ? [...held.grants, CLAIM_GRANT] : held.grants,
  }));
}

// The same decision function the middleware uses, per workspace, so a list can never
// show a row an act on that row would be refused for.
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
