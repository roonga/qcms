import type { Metadata } from "next";

import { HelpTip } from "@/components/help-tip";
import { Alert } from "@/components/kit";
import { SiteAdministratorsPanel } from "@/components/site/site-administrators-panel";
import { loadSiteScreen } from "@/components/site/site-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { countActiveSiteAdministrators } from "@/lib/server/accounts";
import { listSiteAdministrators, searchAccounts } from "@/lib/server/site-admin";
import {
  demoteControl,
  PROMOTE_CANDIDATE_LIMIT,
  promoteCandidates,
  promoteControl,
  readPromoteSearch,
} from "@/lib/site/administrators";

import { demoteAction, promoteAction } from "../actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.administrators.title"));
}

export default async function SiteAdministratorsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return screen.element;
  const { session } = screen;
  const { search } = readPromoteSearch(await searchParams);
  const [administrators, count, matches] = await Promise.all([
    listSiteAdministrators(session),
    countActiveSiteAdministrators(session),
    search === "" ? undefined : searchAccounts(session, search, PROMOTE_CANDIDATE_LIMIT * 2),
  ]);
  // An unread count offers no act that the count guards; the API refuses regardless.
  const viewer = { userId: session.userId, activeSiteAdministrators: count.ok ? count.data : 1 };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="qcms-help-head">
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("site.administrators.title")}
        </h1>
        <HelpTip>{t("site.administrators.intro")}</HelpTip>
      </div>

      {!administrators.ok && (
        <Alert variant="error">
          {t("site.administrators.loadFailed", { message: administrators.message })}
        </Alert>
      )}
      {matches !== undefined && !matches.ok && (
        <Alert variant="error">
          {t("site.accounts.loadFailed", { message: matches.message })}
        </Alert>
      )}

      <SiteAdministratorsPanel
        administrators={(administrators.ok ? administrators.data : []).map((account) => ({
          account,
          control: demoteControl(account, viewer),
        }))}
        candidates={
          matches?.ok === true
            ? promoteCandidates(matches.data).map((account) => ({
                account,
                control: promoteControl(account, viewer),
              }))
            : undefined
        }
        search={search}
        promote={promoteAction}
        demote={demoteAction}
      />
    </div>
  );
}
