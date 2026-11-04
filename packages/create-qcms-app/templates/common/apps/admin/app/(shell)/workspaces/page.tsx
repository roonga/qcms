import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { listWorkspaces } from "@/lib/server/membership";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { permitsPath, WORKSPACES_PATH } from "@/lib/shell/modes";

export function generateMetadata(): Metadata {
  return pageMetadata(t("membership.area.title"));
}

export default async function WorkspacesPage() {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, WORKSPACES_PATH)) {
    return <DeniedRecovery capabilities={capabilities} />;
  }
  const workspaces = await listWorkspaces(session);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("membership.area.title")}</h1>
        <p className="text-sm text-(--color-text-muted)">{t("membership.area.intro")}</p>
      </div>

      {!workspaces.ok && (
        <Alert variant="error">
          {t("membership.area.loadFailed", { message: workspaces.message })}
        </Alert>
      )}

      {workspaces.ok &&
        (workspaces.data.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.area.noWorkspaces")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {workspaces.data.map((workspace) => (
              <li key={workspace.workspaceId} className="flex flex-col gap-1">
                <Link
                  href={`/workspaces/${workspace.workspaceId}`}
                  className="text-sm font-medium text-(--color-link) underline"
                >
                  {workspace.name}
                </Link>
                <p className="text-xs text-(--color-text-muted)">
                  {workspace.slug}
                  {" - "}
                  {t("membership.area.counts", {
                    forms: workspace.forms,
                    questions: workspace.questions,
                  })}
                  {workspace.isShared ? ` - ${t("membership.area.shared")}` : ""}
                  {workspace.requireSecondApprover ? ` - ${t("membership.area.twoPerson")}` : ""}
                  {workspace.archivedAt === null ? "" : ` - ${t("membership.area.archived")}`}
                </p>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
