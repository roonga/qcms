import {
  OWNER_MEMBER_ROLE,
  createAccessGroup,
  insertWorkspace,
  listEnvironmentNames,
  starterGroups,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { AccessGroupRow, Executor, WorkspaceRow } from "@roonga/qcms-db";

/** Create the four starter groups in a workspace, with no people in them. */
export async function createStarterGroups(
  tx: Executor,
  workspaceId: string,
): Promise<readonly AccessGroupRow[]> {
  const live = await listEnvironmentNames(tx);
  const groups: AccessGroupRow[] = [];
  for (const group of starterGroups(live)) {
    groups.push(
      await createAccessGroup(tx, {
        workspaceId,
        name: group.name,
        roles: group.roles,
        environments: group.environments,
      }),
    );
  }
  return groups;
}

/**
 * Create a workspace, its first Workspace administrator and the four starter groups, and
 * audit the appointment. Must run inside the caller's transaction so all of it lands or none.
 */
export async function createWorkspaceWithStarterGroups(
  tx: Executor,
  input: {
    readonly name: string;
    readonly slug: string;
    readonly firstAdministratorId: string;
    readonly actor: string;
    readonly occurredAt?: Date;
    readonly auditPrefix?: string;
  },
): Promise<{ readonly workspace: WorkspaceRow; readonly groups: readonly AccessGroupRow[] }> {
  const workspace = await insertWorkspace(tx, {
    name: input.name,
    slug: input.slug,
    firstAdministratorId: input.firstAdministratorId,
  });
  const groups = await createStarterGroups(tx, workspace.id);
  const parts = [
    `memberRole=${OWNER_MEMBER_ROLE}`,
    `subject=${input.firstAdministratorId}`,
    `workspace created with starter groups ${groups.map((group) => group.name).join(",")}`,
  ];
  if (input.auditPrefix !== undefined) parts.unshift(input.auditPrefix);
  await writeAccessAuditRow(tx, {
    actor: input.actor,
    workspaceId: workspace.id,
    kind: "grant",
    detail: parts.join(" "),
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
  });
  return { workspace, groups };
}
