import type { Metadata } from "next";

import { AgentAuditPanel } from "@/components/membership/agent-audit-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { pageMetadata } from "@/lib/page-title";
import { readAgentAudit } from "@/lib/server/membership";

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
  const audit = await readAgentAudit(screen.session, workspaceId);
  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      <AgentAuditPanel
        audit={audit.ok ? audit.data : undefined}
        message={audit.ok ? undefined : audit.message}
      />
    </WorkspaceScreenFrame>
  );
}
