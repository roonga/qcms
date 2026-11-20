import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/kit";
import { AccountActions } from "@/components/site/account-actions";
import { AccountStatusTag, loadSiteScreen } from "@/components/site/site-screen";
import { t } from "@/lib/i18n/en";
import { formatList } from "@/lib/i18n/format";
import { workspaceSectionHref } from "@/lib/membership/sections";
import { pageMetadata } from "@/lib/page-title";
import { countActiveSiteAdministrators, readAccount, readHoldings } from "@/lib/server/accounts";
import { appLocale } from "@/lib/server/config";
import {
  ACCOUNTS_PATH,
  accountControls,
  heldGroupLabel,
  holdingsByWorkspace,
  lastAdministratorWorkspaces,
  type WorkspaceHolding,
} from "@/lib/site/accounts";

import {
  disableAccountAction,
  reactivateAccountAction,
  resendSignInLinkAction,
  resetAccountAction,
} from "../actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.accounts.account"));
}

function holdingLine(holding: WorkspaceHolding, locale: string): string {
  const parts = [
    ...(holding.administrator ? [t("site.accounts.holds.administrator")] : []),
    ...holding.groups.map((group) => heldGroupLabel(group, locale)),
  ];
  return t("site.accounts.holds.line", {
    workspace: holding.workspaceName,
    holds: formatList(parts, locale),
  });
}

export default async function AccountPage({
  params,
}: {
  readonly params: Promise<{ accountId: string }>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return screen.element;
  const { accountId } = await params;
  const { session } = screen;
  const [account, holdings, siteAdministrators] = await Promise.all([
    readAccount(session, accountId),
    readHoldings(session, accountId),
    countActiveSiteAdministrators(session),
  ]);

  if (!account.ok) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("site.accounts.account")}</h1>
        <Alert variant="error">
          {account.code === "ACCOUNT_NOT_FOUND"
            ? t("site.accounts.error.notFound")
            : t("site.accounts.loadFailed", { message: account.message })}
        </Alert>
        <Link className="qcms-text-link" href={ACCOUNTS_PATH}>
          {t("site.accounts.back")}
        </Link>
      </div>
    );
  }

  const locale = appLocale();
  const subject = account.data;
  const held = holdings.ok ? holdingsByWorkspace(holdings.data) : [];
  // An unread count offers no act that the count guards; the API refuses regardless.
  const controls = accountControls(subject, {
    userId: session.userId,
    activeSiteAdministrators: siteAdministrators.ok ? siteAdministrators.data : 1,
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-(--color-text)">{subject.name}</h1>
        <AccountStatusTag status={subject.status} />
        {subject.siteAdministrator && (
          <span className="qcms-tag qcms-tag--draft">{t("site.accounts.siteAdministrator")}</span>
        )}
      </div>

      <AccountActions
        account={subject}
        controls={controls}
        holdingsSummary={held.map((holding) => holdingLine(holding, locale))}
        lastAdministratorOf={holdings.ok ? lastAdministratorWorkspaces(holdings.data) : []}
        locale={locale}
        resend={resendSignInLinkAction}
        disable={disableAccountAction}
        reactivate={reactivateAccountAction}
        reset={resetAccountAction}
      />

      <dl className="qcms-detail-list flex flex-col gap-3" data-testid="qcms-account-details">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-(--color-text-muted)">{t("site.accounts.column.email")}</dt>
          <dd>{subject.email}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-(--color-text-muted)">
            {t("site.accounts.column.siteAdministrator")}
          </dt>
          <dd>{subject.siteAdministrator ? t("site.accounts.yes") : t("site.accounts.no")}</dd>
        </div>
      </dl>

      <section aria-labelledby="qcms-account-holds" className="flex min-w-0 flex-col gap-3">
        <h2 id="qcms-account-holds" className="text-lg font-semibold text-(--color-text)">
          {t("site.accounts.holds.heading")}
        </h2>
        {!holdings.ok && (
          <Alert variant="error">
            {t("site.accounts.holds.loadFailed", { message: holdings.message })}
          </Alert>
        )}
        {holdings.ok && held.length === 0 && (
          <p className="text-sm text-(--color-text-muted)">{t("site.accounts.holds.none")}</p>
        )}
        {held.length > 0 && (
          <ul className="flex flex-col gap-3" data-testid="qcms-account-holdings">
            {held.map((holding) => (
              <li key={holding.workspaceId} className="flex flex-col gap-1">
                <span className="font-medium">{holding.workspaceName}</span>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {holding.administrator && (
                    <li>
                      {t("site.accounts.holds.administrator")}
                      {holding.lastAdministrator && (
                        <span className="text-(--color-text-muted)">
                          {" "}
                          {t("site.accounts.holds.lastAdministrator")}
                        </span>
                      )}
                    </li>
                  )}
                  {holding.groups.map((group) => (
                    <li key={group.groupId}>
                      <Link
                        className="qcms-text-link"
                        href={workspaceSectionHref(holding.workspaceId, "access-groups")}
                      >
                        {heldGroupLabel(group, locale)}
                      </Link>
                      {group.suspended && (
                        <span className="qcms-tag qcms-tag--deprecated ml-2">
                          <span aria-hidden="true">{t("access.status.suspended")}</span>
                          <span className="qcms-visually-hidden">
                            {t("site.accounts.holds.suspendedName")}
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
