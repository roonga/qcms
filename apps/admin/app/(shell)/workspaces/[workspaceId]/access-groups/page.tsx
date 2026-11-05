import type { Metadata } from "next";

import { AccessGroupsPanel } from "@/components/membership/access-groups-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { pageMetadata } from "@/lib/page-title";
import { orderedEnvironments } from "@/lib/membership/access-group-form";
import { listEnvironments } from "@/lib/server/environments";
import { listAllForms } from "@/lib/server/forms";
import { listAccessGroups, listMembers } from "@/lib/server/membership";

import {
  createAccessGroupAction,
  grantAccessGroupAction,
  removeAccessGroupAction,
  revokeAccessGroupAction,
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
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  const [groups, members, environments, forms] = await Promise.all([
    listAccessGroups(screen.session, workspaceId),
    listMembers(screen.session, workspaceId),
    listEnvironments(screen.session),
    // The caller's own form read: a form they cannot read is never offered by name.
    listAllForms(screen.session),
  ]);

  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      <AccessGroupsPanel
        list={groups.ok ? groups.data : undefined}
        message={groups.ok ? undefined : groups.message}
        environments={environments.ok ? orderedEnvironments(environments.data) : []}
        forms={
          forms.ok
            ? forms.data
                .filter((form) => form.workspaceId === workspaceId)
                .map((form) => ({ formId: form.formId, name: form.slug }))
            : []
        }
        members={
          members.ok
            ? members.data.map((member) => ({
                userId: member.userId,
                email: member.email,
                name: member.name,
              }))
            : []
        }
        create={createAccessGroupAction}
        remove={removeAccessGroupAction}
        grant={grantAccessGroupAction}
        revoke={revokeAccessGroupAction}
      />
    </WorkspaceScreenFrame>
  );
}
