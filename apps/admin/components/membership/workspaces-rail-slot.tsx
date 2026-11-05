import { WorkspacesRail } from "@/components/membership/workspaces-rail";
import type { WorkspaceSection } from "@/lib/membership/sections";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/** The Workspaces rail for any screen of the area, the selected workspace's sections expanded when there is one. */
export async function WorkspacesRailSlot({
  selected,
}: {
  readonly selected?: { readonly workspaceId: string; readonly section: WorkspaceSection };
}) {
  const session = await requireAdminSession();
  const workspaces = await listWorkspaces(session);
  return (
    <WorkspacesRail
      workspaces={
        workspaces.ok
          ? workspaces.data.map((entry) => ({
              workspaceId: entry.workspaceId,
              name: entry.name,
            }))
          : []
      }
      {...(selected === undefined ? {} : { selected })}
    />
  );
}
