import type { GroupGrant } from "./access-patterns.ts";
import type { MyAccess, MyAccessWorkspace } from "./types.ts";

export const WORKSPACE_ADMINISTRATOR_ROLE = "forms.owner";

export function isWorkspaceAdministrator(workspace: MyAccessWorkspace): boolean {
  return workspace.memberRole === WORKSPACE_ADMINISTRATOR_ROLE;
}

/** No Site administrator role, no Workspace administrator role and no group anywhere. */
export function holdsNoAccess(access: MyAccess): boolean {
  return (
    !access.installationAdmin &&
    access.workspaces.every(
      (workspace) => workspace.grants.length === 0 && !isWorkspaceAdministrator(workspace),
    )
  );
}

/**
 * The caller's groups in one workspace, shaped for the access explanation. A group naming
 * no environment applies in every one, so it is expanded against the columns. Group names
 * are unique within a workspace, so the name stands in for the id.
 */
export function heldGroups(
  workspace: MyAccessWorkspace,
  siteEnvironments: readonly string[],
): readonly GroupGrant[] {
  return workspace.grants.map((grant) => ({
    id: grant.name,
    name: grant.name,
    roles: grant.roles,
    environments: grant.environments.length === 0 ? siteEnvironments : grant.environments,
  }));
}

/** The environments the API lets the caller see, else every one the caller holds anywhere. */
export function explanationEnvironments(
  access: MyAccess,
  siteEnvironments: readonly string[] | undefined,
): readonly string[] {
  if (siteEnvironments !== undefined && siteEnvironments.length > 0) return siteEnvironments;
  const held: string[] = [];
  for (const workspace of access.workspaces) {
    for (const name of workspace.environments) if (!held.includes(name)) held.push(name);
  }
  return held;
}
