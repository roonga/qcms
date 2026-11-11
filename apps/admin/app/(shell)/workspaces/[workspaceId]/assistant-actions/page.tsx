import type { Metadata } from "next";

import { AgentAuditPanel } from "@/components/membership/agent-audit-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { emailsById, groupTitlesById } from "@/lib/membership/audit-wording";
import { pageMetadata } from "@/lib/page-title";
import { listAccessGroups, listMembers, readAgentAudit } from "@/lib/server/membership";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageMetadata(await workspaceSectionTitle("assistant-actions", workspaceId));
}

export default async function WorkspaceAssistantActionsPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  // The groups and the members this workspace holds today, so a row's one stored id reads as the
  // thing it named. Both are the same cell as the audit read, and a failed one leaves the id.
  const [audit, groups, members] = await Promise.all([
    readAgentAudit(screen.session, workspaceId),
    listAccessGroups(screen.session, workspaceId),
    listMembers(screen.session, workspaceId),
  ]);
  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      <AgentAuditPanel
        audit={audit.ok ? audit.data : undefined}
        message={audit.ok ? undefined : audit.message}
        names={{
          groups: groupTitlesById(groups.ok ? groups.data.groups : []),
          people: emailsById(members.ok ? members.data : []),
        }}
      />
    </WorkspaceScreenFrame>
  );
}
