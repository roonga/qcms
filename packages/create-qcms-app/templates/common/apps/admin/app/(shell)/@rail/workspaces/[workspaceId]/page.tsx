import { WorkspaceRail } from "@/components/membership/workspace-rail";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/**
 * One workspace's rail.
 *
 * The name falls back to the id rather than the rail vanishing: the four panels are four
 * reads with four authorities, so this screen still renders when the workspace list does not
 * name it, and a vanishing rail would take the way back with it. The page's own heading
 * falls back the same way.
 */
export default async function WorkspaceRailSlot({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await requireAdminSession();
  const workspaces = await listWorkspaces(session);
  const workspace = workspaces.ok
    ? workspaces.data.find((entry) => entry.workspaceId === workspaceId)
    : undefined;
  return <WorkspaceRail name={workspace?.name ?? workspaceId} />;
}
