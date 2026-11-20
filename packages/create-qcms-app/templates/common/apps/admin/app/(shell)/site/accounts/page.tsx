import type { Metadata } from "next";
import Link from "next/link";

import { ResultPager } from "@/components/access/access-filters";
import { EmptyState } from "@/components/empty-state";
import { HelpTip } from "@/components/help-tip";
import { Alert } from "@/components/kit";
import { AccountStatusTag, loadSiteScreen } from "@/components/site/site-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { listAccounts } from "@/lib/server/accounts";
import { appLocale } from "@/lib/server/config";
import {
  accountHref,
  accountsPageHref,
  NEW_ACCOUNT_PATH,
  readAccountFilters,
} from "@/lib/site/accounts";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.accounts.title"));
}

export default async function AccountsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return screen.element;
  const filters = readAccountFilters(await searchParams);
  const result = await listAccounts(screen.session, filters);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="qcms-page-header">
        <div className="qcms-help-head">
          <h1 className="text-xl font-semibold text-(--color-text)">{t("site.accounts.title")}</h1>
          <HelpTip>{t("site.accounts.intro")}</HelpTip>
        </div>
        <div className="qcms-page-header__actions">
          <Link href={NEW_ACCOUNT_PATH} className="qcms-button-link">
            {t("site.accounts.new")}
          </Link>
        </div>
      </div>

      {!result.ok && (
        <Alert variant="error">{t("site.accounts.loadFailed", { message: result.message })}</Alert>
      )}

      {result.ok && result.data.accounts.length === 0 && (
        <EmptyState
          heading={
            filters.activeCount > 0 ? t("site.accounts.emptyFiltered") : t("site.accounts.empty")
          }
          testId="qcms-accounts-empty"
        />
      )}

      {result.ok && result.data.accounts.length > 0 && (
        <>
          <div className="qcms-table">
            <table data-testid="qcms-accounts-table">
              <caption className="qcms-visually-hidden">{t("site.accounts.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("site.accounts.column.name")}</th>
                  <th scope="col">{t("site.accounts.column.email")}</th>
                  <th scope="col">{t("site.accounts.column.status")}</th>
                  <th scope="col">{t("site.accounts.column.siteAdministrator")}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.accounts.map((account) => (
                  <tr key={account.userId} data-account={account.userId}>
                    <th scope="row">
                      <Link className="qcms-text-link" href={accountHref(account.userId)}>
                        {account.name}
                      </Link>
                    </th>
                    <td>{account.email}</td>
                    <td>
                      <AccountStatusTag status={account.status} />
                    </td>
                    <td>{account.siteAdministrator ? t("site.accounts.yes") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ResultPager
            page={result.data.page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            locale={appLocale()}
            pageHref={(page) => accountsPageHref(filters, page)}
          />
        </>
      )}
    </div>
  );
}
