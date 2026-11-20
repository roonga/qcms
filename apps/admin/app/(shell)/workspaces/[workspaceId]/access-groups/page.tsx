import type { Metadata } from "next";

import { AccessGroupsPanel } from "@/components/membership/access-groups-panel";
import { NewGroupPanel } from "@/components/membership/new-group-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { orderedEnvironments } from "@/lib/membership/access-group-form";
import { workspaceSectionHref } from "@/lib/membership/sections";
import {
  WORKSPACE_ADMINISTRATION,
  membersGrantHref,
  newGroupHref,
  readGroupsView,
} from "@/lib/membership/workspace-views";
import { pageMetadata } from "@/lib/page-title";
import { listEnvironments } from "@/lib/server/environments";
import { listAccessGroups, listMembers } from "@/lib/server/membership";

import {
  createAccessGroupAction,
  reconfirmHolderAction,
  removeAccessGroupAction,
  revokeAccessGroupAction,
  updateAccessGroupAction,
} from "../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageMetadata(await workspaceSectionTitle("access-groups", workspaceId));
}

export default async function WorkspaceAccessGroupsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ workspaceId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  const [groups, members, environments] = await Promise.all([
    listAccessGroups(screen.session, workspaceId),
    listMembers(screen.session, workspaceId),
    listEnvironments(screen.session),
  ]);
  const ordered = environments.ok ? orderedEnvironments(environments.data) : [];
  const listHref = workspaceSectionHref(workspaceId, "access-groups");
  const view = readGroupsView(
    query,
    groups.ok ? groups.data.groups.map((group) => group.teamId) : [],
  );

  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      {view.creating ? (
        <NewGroupPanel
          workspaceId={workspaceId}
          environments={ordered}
          listHref={listHref}
          create={createAccessGroupAction}
        />
      ) : (
        <AccessGroupsPanel
          list={groups.ok ? groups.data : undefined}
          message={groups.ok ? undefined : groups.message}
          environments={ordered}
          viewerId={screen.session.userId}
          requireSecondApprover={screen.workspace?.requireSecondApprover === true}
          capabilities={WORKSPACE_ADMINISTRATION}
          initialGroup={view.group}
          newHref={newGroupHref(workspaceId)}
          grantHref={membersGrantHref(workspaceId)}
          names={Object.fromEntries(
            (members.ok ? members.data : []).map((member) => [member.userId, member.name]),
          )}
          actions={{
            update: updateAccessGroupAction,
            remove: removeAccessGroupAction,
            revoke: revokeAccessGroupAction,
            reconfirm: reconfirmHolderAction,
          }}
        />
      )}
    </WorkspaceScreenFrame>
  );
}
