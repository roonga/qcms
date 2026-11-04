import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { AccessGroupsPanel } from "@/components/membership/access-groups-panel";
import { AgentAuditPanel } from "@/components/membership/agent-audit-panel";
import { AuditPanel } from "@/components/membership/audit-panel";
import { MembersPanel } from "@/components/membership/members-panel";
import { WorkspaceSettingsPanel } from "@/components/membership/workspace-settings-panel";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { RememberWorkspace } from "@/components/shell/shell-chrome";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { listEnvironments } from "@/lib/server/environments";
import {
  listAccessGroups,
  listMembers,
  listWorkspaces,
  readAgentAudit,
  readAudit,
} from "@/lib/server/membership";
import { secureCookies } from "@/lib/server/config";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { permitsPath, WORKSPACES_PATH } from "@/lib/shell/modes";

import {
  createAccessGroupAction,
  grantAccessGroupAction,
  removeAccessGroupAction,
  revokeAccessGroupAction,
  saveWorkspaceSettingsAction,
  setMemberRoleAction,
} from "./actions";

const TEAM_ROLES = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "responses.viewer",
  "responses.eraser",
] as const;

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  const session = await requireAdminSession();
  const workspaces = await listWorkspaces(session);
  const workspace = workspaces.ok
    ? workspaces.data.find((entry) => entry.workspaceId === workspaceId)
    : undefined;
  return pageMetadata(workspace?.name ?? t("membership.area.title"));
}

export default async function WorkspacePage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, WORKSPACES_PATH)) {
    return <DeniedRecovery capabilities={capabilities} />;
  }
  const [workspaces, members, groups, audit, agentAudit, environments] = await Promise.all([
    listWorkspaces(session),
    listMembers(session, workspaceId),
    listAccessGroups(session, workspaceId),
    readAudit(session, workspaceId),
    readAgentAudit(session, workspaceId),
    listEnvironments(session),
  ]);

  const workspace = workspaces.ok
    ? workspaces.data.find((entry) => entry.workspaceId === workspaceId)
    : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("membership.workspace.title", { name: workspace?.name ?? workspaceId })}
        </h1>
        {workspace === undefined && (
          <Alert variant="warning">
            {t("membership.workspace.notFound")}{" "}
            <Link className="qcms-text-link" href={WORKSPACES_PATH}>
              {t("membership.workspace.allWorkspaces")}
            </Link>
          </Alert>
        )}
      </div>
      {workspace !== undefined && (
        <RememberWorkspace workspaceId={workspaceId} secureCookies={secureCookies()} />
      )}

      <MembersPanel
        workspaceId={workspaceId}
        members={members.ok ? members.data : undefined}
        message={members.ok ? undefined : members.message}
        setRole={setMemberRoleAction}
      />

      <AccessGroupsPanel
        list={groups.ok ? groups.data : undefined}
        message={groups.ok ? undefined : groups.message}
        environments={environments.ok ? environments.data.map((entry) => entry.name) : []}
        roles={TEAM_ROLES}
        create={createAccessGroupAction}
        remove={removeAccessGroupAction}
        grant={grantAccessGroupAction}
        revoke={revokeAccessGroupAction}
      />

      {workspace !== undefined && (
        <WorkspaceSettingsPanel
          settings={{
            workspaceId,
            requireSecondApprover: workspace.requireSecondApprover,
            seedNewEditorsWithTestData: workspace.seedNewEditorsWithTestData,
          }}
          save={saveWorkspaceSettingsAction}
        />
      )}

      <AuditPanel
        audit={audit.ok ? audit.data : undefined}
        message={audit.ok ? undefined : audit.message}
      />

      <AgentAuditPanel
        audit={agentAudit.ok ? agentAudit.data : undefined}
        message={agentAudit.ok ? undefined : agentAudit.message}
      />
    </div>
  );
}
