import { WorkspaceRail } from "@/components/membership/workspace-rail";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

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
