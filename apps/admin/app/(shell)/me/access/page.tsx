import type { Metadata } from "next";

import { NoAccessHome } from "@/components/access/no-access-home";
import { MyAccessPanel } from "@/components/membership/my-access-panel";
import { t } from "@/lib/i18n/en";
import { explanationEnvironments, holdsNoAccess } from "@/lib/membership/my-access";
import { pageMetadata } from "@/lib/page-title";
import { appLocale } from "@/lib/server/config";
import { listEnvironments } from "@/lib/server/environments";
import { readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

export function generateMetadata(): Metadata {
  return pageMetadata(t("access.title"));
}

/* My access needs no feature grant: it is the landing page for an account that holds nothing. */
export default async function MyAccessPage() {
  const session = await requireAdminSession();
  const [mine, live] = await Promise.all([readMyAccess(session), listEnvironments(session)]);
  const siteEnvironments = live.ok
    ? [...live.data].sort((a, b) => a.position - b.position).map((option) => option.name)
    : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="sr-only">{t("access.title")}</h1>

      {mine.ok && holdsNoAccess(mine.data) && (
        <NoAccessHome
          siteAdministrators={mine.data.siteAdministrators}
          locale={appLocale()}
          accessHref="#qcms-my-access-heading"
        />
      )}

      <MyAccessPanel
        access={mine.ok ? mine.data : undefined}
        message={mine.ok ? undefined : mine.message}
        environments={mine.ok ? explanationEnvironments(mine.data, siteEnvironments) : []}
      />
    </div>
  );
}
