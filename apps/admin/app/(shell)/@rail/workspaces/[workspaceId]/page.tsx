import { WorkspaceRail } from "@/components/membership/workspace-rail";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/**
 * One workspace's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * ## Why the name falls back to the id rather than to no rail at all
 *
 * The form and question rails return `null` when their subject cannot be read, and let the
 * screen's own 404 or alert speak. The difference here is that the workspace's four panels
 * are four separate reads with four separate authorities: an operator can be refused the
 * membership list and still be shown the settings, and the page renders exactly that rather
 * than a 404. So the screen is still there when `GET /admin/workspaces` has not named this
 * workspace - it says so in a warning - and a rail that vanished would take the way back
 * with it, on the one screen where an operator most needs it.
 *
 * The id is what the page's own heading falls back to on the same read, so the two agree:
 * `membership.workspace.title` is `{name}` and the page passes `workspace?.name ??
 * workspaceId`.
 *
 * `listWorkspaces` is memoized per request, so this shares the page's round trip.
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
