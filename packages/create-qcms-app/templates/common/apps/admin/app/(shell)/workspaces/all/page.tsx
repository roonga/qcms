import Link from "next/link";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { t } from "@/lib/i18n/en";
import { workspaceHref } from "@/lib/membership/sections";
import { pageMetadata } from "@/lib/page-title";
import { listWorkspaces } from "@/lib/server/membership";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { permitsPath, WORKSPACES_PATH } from "@/lib/shell/modes";

export function generateMetadata(): Metadata {
  return pageMetadata(t("membership.workspace.allWorkspaces"));
}

/** The whole list, which the area's own root never shows: it lands on the current workspace. */
export default async function AllWorkspacesPage() {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, WORKSPACES_PATH)) {
    return <DeniedRecovery capabilities={capabilities} />;
  }
  const workspaces = await listWorkspaces(session);
  const rows = workspaces.ok
    ? [...workspaces.data].sort((left, right) => left.name.localeCompare(right.name, "en"))
    : [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="sr-only">{t("membership.workspace.allWorkspaces")}</h1>

      {!workspaces.ok && (
        <Alert variant="error">
          {t("membership.area.loadFailed", { message: workspaces.message })}
        </Alert>
      )}

      {workspaces.ok && rows.length === 0 && (
        <EmptyState
          heading={t("membership.area.noWorkspaces")}
          testId="qcms-all-workspaces-empty"
        />
      )}

      {rows.length > 0 && (
        <div className="qcms-table">
          <table data-testid="qcms-all-workspaces-table">
            <caption className="qcms-visually-hidden">
              {t("membership.allWorkspaces.table")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("membership.allWorkspaces.column.name")}</th>
                <th scope="col" className="qcms-cell--num">
                  {t("membership.allWorkspaces.column.forms")}
                </th>
                <th scope="col" className="qcms-cell--num">
                  {t("membership.allWorkspaces.column.questions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((workspace) => (
                <tr key={workspace.workspaceId} data-workspace={workspace.workspaceId}>
                  <th scope="row">
                    <Link
                      className="qcms-text-link"
                      href={workspaceHref(workspace.workspaceId)}
                      data-testid="qcms-all-workspaces-name"
                    >
                      {workspace.name}
                    </Link>
                    {workspace.archivedAt !== null && (
                      <span className="qcms-tag qcms-tag--deprecated">
                        {t("membership.allWorkspaces.archived")}
                      </span>
                    )}
                  </th>
                  <td className="qcms-cell--num">{workspace.forms}</td>
                  <td className="qcms-cell--num">{workspace.questions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
