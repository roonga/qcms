import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { SharedLibraryPanel } from "@/components/membership/shared-library-panel";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { listWorkspaces } from "@/lib/server/membership";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";

import { setSharedLibraryAction } from "./actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.library.title"));
}

/* Site administrators only: the mark changes what every other workspace may pin, so no
   workspace grant reaches it. */
export default async function SharedLibraryPage() {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!capabilities.siteConfiguration) {
    return <DeniedRecovery capabilities={capabilities} />;
  }

  const workspaces = await listWorkspaces(session);
  if (!workspaces.ok) {
    return <Alert variant="error">{workspaces.message}</Alert>;
  }
  const open = workspaces.data.filter((workspace) => workspace.archivedAt === null);
  const holder = open.find((workspace) => workspace.isShared === true);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h1 className="text-xl font-semibold text-(--color-text)">{t("site.library.title")}</h1>
      <SharedLibraryPanel
        workspaces={open.map((workspace) => ({
          workspaceId: workspace.workspaceId,
          name: workspace.name,
        }))}
        holder={holder?.workspaceId ?? null}
        save={setSharedLibraryAction}
      />
    </div>
  );
}
