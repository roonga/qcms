import type { Metadata } from "next";

import { MyAccessPanel } from "@/components/membership/my-access-panel";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

export function generateMetadata(): Metadata {
  return pageMetadata(t("access.title"));
}

/**
 * What this account holds, on a route of its own under the avatar.
 *
 * It needs no grant, because it **is** the answer to what the caller holds, which is why
 * it is also where a caller with no feature grant lands: a useful statement of their
 * access and who to ask, rather than an authoring screen they were never given.
 */
export default async function MyAccessPage() {
  const session = await requireAdminSession();
  const mine = await readMyAccess(session);
  const noGrants =
    mine.ok &&
    !mine.data.installationAdmin &&
    mine.data.workspaces.every((w) => w.grants.length === 0);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("access.title")}</h1>
        <p className="text-sm text-(--color-text-muted)">{t("access.intro")}</p>
      </div>

      {noGrants && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-access-none">
          {t("access.none")}
        </p>
      )}

      <MyAccessPanel
        access={mine.ok ? mine.data : undefined}
        message={mine.ok ? undefined : mine.message}
      />
    </div>
  );
}
