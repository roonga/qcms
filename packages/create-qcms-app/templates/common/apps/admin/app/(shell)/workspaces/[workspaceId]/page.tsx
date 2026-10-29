import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { AccessGroupsPanel } from "@/components/membership/access-groups-panel";
import { AuditPanel } from "@/components/membership/audit-panel";
import { MembersPanel } from "@/components/membership/members-panel";
import { WorkspaceSettingsPanel } from "@/components/membership/workspace-settings-panel";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { RememberWorkspace } from "@/components/shell/shell-chrome";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { listEnvironments } from "@/lib/server/environments";
import { listAccessGroups, listMembers, listWorkspaces, readAudit } from "@/lib/server/membership";
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

/**
 * The five roles an access group may carry (Q32, Q38).
 *
 * `forms.owner` is **absent**, and that is the model rather than an omission: it is the
 * one role that lives on the `member` row, so a team carrying it would be a grant in a
 * place nothing reads it from. The members panel is where it is set.
 *
 * Written here rather than fetched because the role set is static by decision -
 * `dynamicAccessControl` is off, deliberately - and a route that served it would be a
 * route serving a constant. The API refuses a role outside the six whatever this list
 * says, which is what keeps the list from being a second authority.
 */
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

/**
 * One workspace's membership, access groups, settings and access audit (ADR-41, SEC-15;
 * task 069).
 *
 * # Four panels, and each one is a different authority
 *
 * The **membership list** and the **access audit** are the workspace's owners' and the
 * installation administrator's to read (Q35, SEC-15), the **access groups** are where
 * every grant is written (Q45: the QCMS endpoints are the only write path), and the
 * **settings** are the two per-workspace switches. Every one of the four is gated by the
 * API, so a panel whose read was refused renders its own message rather than an empty
 * state: an empty table would say "nothing is granted here" to somebody who was told
 * nothing at all.
 *
 * The rail's Sections are the four panels and its Header is the way back (§7.0 ruling 3), so
 * this column carries no "All workspaces" link. `listWorkspaces` is memoized per request, so
 * the rail reading the name costs no second round trip.
 *
 * # Why the reads are parallel and the writes are not
 *
 * The four reads are independent and are issued together. The writes are Server Actions
 * that revalidate this path, so a grant and the audit row it wrote appear in the same
 * refresh - which matters here more than elsewhere, because "the grant is on the record"
 * is the claim the audit panel exists to make good.
 */
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
  const [workspaces, members, groups, audit, environments] = await Promise.all([
    listWorkspaces(session),
    listMembers(session, workspaceId),
    listAccessGroups(session, workspaceId),
    readAudit(session, workspaceId),
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
        {/* A rejected bookmark still has All workspaces, and the mode keeps it: the
            identifier is the one already in the address bar, and no name is resolved for
            it. Remembering it as this mode's context would make a revoked grant the thing
            that decides where re-entering lands. */}
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
    </div>
  );
}
