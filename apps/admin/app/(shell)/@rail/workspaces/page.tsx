import { WorkspacesRail } from "@/components/membership/workspaces-rail";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The workspaces screen's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * It exported `NoRailSection` until §7.0, and `lib/rail-routes.test.ts` carried the reason:
 * a rail here would repeat the page's own body. §7.0's table rules the other way for this one
 * screen, and `components/membership/workspaces-rail.tsx` records what makes it different
 * from the two library screens.
 *
 * `listWorkspaces` is memoized per request, so this is the same round trip the page makes
 * rather than a second one. A failed read becomes no rows: the page reports the failure in
 * its own alert, and a rail listing nothing under it claims nothing.
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
