import type { Metadata } from "next";

import { AuditPanel } from "@/components/membership/audit-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { WorkspaceRequestsPanel } from "@/components/membership/workspace-requests-panel";
import { heldRequests } from "@/lib/membership/approval-wording";
import { readAuditFilters } from "@/lib/membership/audit-filters";
import { emailsById } from "@/lib/membership/audit-wording";
import { workspaceSectionHref } from "@/lib/membership/sections";
import { pageMetadata } from "@/lib/page-title";
import { appLocale } from "@/lib/server/config";
import { listMembers, listWorkspaceRequests, readAuditPage } from "@/lib/server/membership";

import { decideWorkspaceRequestAction } from "../actions";

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
  searchParams,
}: {
  readonly params: Promise<{ workspaceId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  const filters = readAuditFilters(await searchParams);
  const [audit, requests, members] = await Promise.all([
    readAuditPage(screen.session, workspaceId, filters.kind, filters.page),
    listWorkspaceRequests(screen.session, workspaceId),
    listMembers(screen.session, workspaceId),
  ]);

  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      <WorkspaceRequestsPanel
        workspaceId={workspaceId}
        requests={requests.ok ? heldRequests(requests.data.requests, new Date()) : undefined}
        message={requests.ok ? undefined : requests.message}
        viewerId={screen.session.userId}
        people={emailsById(members.ok ? members.data : [])}
        decide={decideWorkspaceRequestAction}
      />
      <AuditPanel
        audit={audit.ok ? audit.data : undefined}
        message={audit.ok ? undefined : audit.message}
        filters={filters}
        basePath={workspaceSectionHref(workspaceId, "audit")}
        locale={appLocale()}
      />
    </WorkspaceScreenFrame>
  );
}
