import type { Metadata } from "next";

import { MembersPanel } from "@/components/membership/members-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { groupTitlesByName } from "@/lib/membership/access-group-form";
import { pageMetadata } from "@/lib/page-title";
import { listAccessGroups, listMembers } from "@/lib/server/membership";

import { setMemberRoleAction } from "../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageMetadata(await workspaceSectionTitle("members", workspaceId));
}

export default async function WorkspaceMembersPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  // A member row carries its groups by stored name, which is wire vocabulary; the groups read
  // is what turns each one into its role and scope. A failed read leaves the stored names.
  const [members, groups] = await Promise.all([
    listMembers(screen.session, workspaceId),
    listAccessGroups(screen.session, workspaceId),
  ]);
  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      <MembersPanel
        workspaceId={workspaceId}
        members={members.ok ? members.data : undefined}
        message={members.ok ? undefined : members.message}
        groups={groupTitlesByName(groups.ok ? groups.data.groups : [])}
        setRole={setMemberRoleAction}
      />
    </WorkspaceScreenFrame>
  );
}
