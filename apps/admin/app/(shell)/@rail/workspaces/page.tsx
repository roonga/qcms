import { WorkspacesRail } from "@/components/membership/workspaces-rail";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The workspaces screen's rail.
 *
 * `listWorkspaces` is memoized per request, so this shares the page's round trip. A failed
 * read becomes no rows: the page reports the failure.
 */
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
