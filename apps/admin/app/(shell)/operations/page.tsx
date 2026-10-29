import type { Metadata } from "next";

import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { permitsPath } from "@/lib/shell/modes";

export function generateMetadata(): Metadata {
  return pageMetadata(t("shell.mode.operations.name"));
}

/**
 * Operations, where the forms table a caller operates lands.
 *
 * The capability gate here is what a denied bookmark meets, and it renders a recovery that
 * names nothing it refused. It is not the authority: `GET /admin/operations/forms` and every
 * operational route re-decide, and a discovery read that failed denies nothing.
 */
export default async function OperationsPage() {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, "/operations")) {
    return <DeniedRecovery capabilities={capabilities} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("shell.mode.operations.name")}
        </h1>
        <p className="text-sm text-(--color-text-muted)">{t("operations.intro")}</p>
      </div>
    </div>
  );
}
