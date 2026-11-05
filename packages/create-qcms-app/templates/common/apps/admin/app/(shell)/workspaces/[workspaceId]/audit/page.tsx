import type { Metadata } from "next";

import { AuditPanel } from "@/components/membership/audit-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { pageMetadata } from "@/lib/page-title";
import { readAudit } from "@/lib/server/membership";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageMetadata(await workspaceSectionTitle("audit", workspaceId));
}

export default async function WorkspaceAuditPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  const audit = await readAudit(screen.session, workspaceId);
  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      <AuditPanel
        audit={audit.ok ? audit.data : undefined}
        message={audit.ok ? undefined : audit.message}
      />
    </WorkspaceScreenFrame>
  );
}
