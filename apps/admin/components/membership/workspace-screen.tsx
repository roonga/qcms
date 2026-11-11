import Link from "next/link";
import type { ReactNode } from "react";

import { Alert } from "@/components/kit";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { RememberWorkspace } from "@/components/shell/shell-chrome";
import { t } from "@/lib/i18n/en";
import { WORKSPACE_SECTION_LABELS, type WorkspaceSection } from "@/lib/membership/sections";
import type { WorkspaceListItem } from "@/lib/membership/types";
import { secureCookies } from "@/lib/server/config";
import { listWorkspaces } from "@/lib/server/membership";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession, type AdminSession } from "@/lib/server/session";
import { permitsPath, WORKSPACES_PATH } from "@/lib/shell/modes";

export type WorkspaceScreen =
  | { readonly kind: "denied"; readonly element: ReactNode }
  | {
      readonly kind: "ready";
      readonly session: AdminSession;
      readonly workspaceId: string;
      readonly workspace: WorkspaceListItem | undefined;
    };

/** The session, the gate and the workspace every section screen starts from. */
export async function loadWorkspaceScreen(workspaceId: string): Promise<WorkspaceScreen> {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, WORKSPACES_PATH)) {
    return { kind: "denied", element: <DeniedRecovery capabilities={capabilities} /> };
  }
  const workspaces = await listWorkspaces(session);
  const workspace = workspaces.ok
    ? workspaces.data.find((entry) => entry.workspaceId === workspaceId)
    : undefined;
  return { kind: "ready", session, workspaceId, workspace };
}

export async function workspaceSectionTitle(
  section: WorkspaceSection,
  workspaceId: string,
): Promise<string> {
  const session = await requireAdminSession();
  const workspaces = await listWorkspaces(session);
  const workspace = workspaces.ok
    ? workspaces.data.find((entry) => entry.workspaceId === workspaceId)
    : undefined;
  return t("title.workspaceSection", {
    section: t(WORKSPACE_SECTION_LABELS[section]),
    workspace: workspace?.name ?? workspaceId,
  });
}

/**
 * One section screen: why it is about no workspace, then the section itself. The breadcrumb and
 * the switcher already name the workspace, so the frame does not repeat it.
 */
export function WorkspaceScreenFrame({
  workspaceId,
  workspace,
  children,
}: {
  readonly workspaceId: string;
  readonly workspace: WorkspaceListItem | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {workspace === undefined ? (
        <Alert variant="warning">
          {t("membership.workspace.notFound")}{" "}
          <Link className="qcms-text-link" href={WORKSPACES_PATH}>
            {t("membership.workspace.allWorkspaces")}
          </Link>
        </Alert>
      ) : (
        <RememberWorkspace workspaceId={workspaceId} secureCookies={secureCookies()} />
      )}
      {children}
    </div>
  );
}
