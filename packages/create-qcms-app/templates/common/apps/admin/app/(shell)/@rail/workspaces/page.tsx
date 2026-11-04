import { WorkspacesRail } from "@/components/membership/workspaces-rail";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

export default async function WorkspacesRailSlot() {
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
    />
  );
}
