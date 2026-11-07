import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Alert } from "@/components/kit";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { t } from "@/lib/i18n/en";
import { workspaceHref } from "@/lib/membership/sections";
import { pageMetadata } from "@/lib/page-title";
import { listWorkspaces } from "@/lib/server/membership";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";
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
  // The remembered workspace, or the first permitted one by name: a fresh browser has to
  // land somewhere, and the area's own list is a separate address.
  const landing = await currentWorkspaceId(session);
  if (landing !== undefined) redirect(workspaceHref(landing));
  const workspaces = await listWorkspaces(session);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="sr-only">{t("membership.area.title")}</h1>
      </div>

      {!workspaces.ok && (
        <Alert variant="error">
          {t("membership.area.loadFailed", { message: workspaces.message })}
        </Alert>
      )}

      {workspaces.ok && (
        <p className="text-sm text-(--color-text-muted)">{t("membership.area.noWorkspaces")}</p>
      )}
    </div>
  );
}
