import Link from "next/link";
import type { ReactNode } from "react";

import { Checkbox, Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t, type MessageKey } from "@/lib/i18n/en";
import { ALL_WORKSPACES_PATH } from "@/lib/membership/sections";
import { NEW_WORKSPACE_PATH } from "@/lib/shell/modes";
import {
  ACCOUNT_SEARCH_MAX_LENGTH,
  ACCOUNT_STATUSES,
  ACCOUNTS_PATH,
  NEW_ACCOUNT_PATH,
  type AccountFilters,
} from "@/lib/site/accounts";
import { SITE_ADMINISTRATORS_PATH } from "@/lib/site/administrators";
import { APPROVAL_REQUESTS_PATH } from "@/lib/site/approvals";
import { SITE_AUDIT_PATH } from "@/lib/site/audit";

export type SiteRailRow =
  "accounts" | "newAccount" | "administrators" | "approvalRequests" | "siteAudit" | "newWorkspace";

/** The level-1 rows after Accounts, in the order Site configuration lists its screens. */
const LATER_ROWS: readonly {
  readonly row: SiteRailRow;
  readonly href: string;
  readonly item: string;
  readonly label: MessageKey;
}[] = [
  {
    row: "administrators",
    href: SITE_ADMINISTRATORS_PATH,
    item: "administrators",
    label: "site.administrators.title",
  },
  {
    row: "approvalRequests",
    href: APPROVAL_REQUESTS_PATH,
    item: "approval-requests",
    label: "site.requests.title",
  },
  { row: "siteAudit", href: SITE_AUDIT_PATH, item: "audit", label: "site.audit.title" },
];

/** The Site configuration rail: its rows, and on the Accounts list the directory filters. */
export function SiteRail({
  current,
  filters,
  screenFilters,
  account,
}: {
  readonly current: SiteRailRow;
  readonly filters?: AccountFilters;
  /** Another screen's own rail filters, with how many are set. */
  readonly screenFilters?: { readonly activeCount: number; readonly node: ReactNode };
  /** The account page's subject, for the breadcrumb. */
  readonly account?: string;
}) {
  const subject = t("site.title");
  const status = (row: SiteRailRow) => (row === current ? { "aria-current": "page" as const } : {});
  const activeCount = filters?.activeCount ?? screenFilters?.activeCount ?? 0;
  return (
    <RailFrame
      subject={subject}
      testId="qcms-site-rail"
      {...(account === undefined ? {} : { crumbs: { account } })}
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          <li>
            <Link
              href={ACCOUNTS_PATH}
              className="qcms-rail__link"
              data-rail-item="section:accounts"
              {...status("accounts")}
            >
              {t("site.accounts.title")}
            </Link>
            <ul className="qcms-rail__group">
              <li>
                <Link
                  href={NEW_ACCOUNT_PATH}
                  className="qcms-rail__link"
                  data-rail-item="section:accounts:new"
                  aria-label={t("site.accounts.new")}
                  {...status("newAccount")}
                >
                  {t("site.rail.new")}
                </Link>
              </li>
            </ul>
          </li>
          {LATER_ROWS.map((entry) => (
            <li key={entry.row}>
              <Link
                href={entry.href}
                className="qcms-rail__link"
                data-rail-item={`section:${entry.item}`}
                {...status(entry.row)}
              >
                {t(entry.label)}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={ALL_WORKSPACES_PATH}
              className="qcms-rail__link"
              data-rail-item="section:workspaces"
            >
              {t("site.workspaces.title")}
            </Link>
            <ul className="qcms-rail__group">
              <li>
                <Link
                  href={NEW_WORKSPACE_PATH}
                  className="qcms-rail__link"
                  data-rail-item="section:workspaces:new"
                  aria-label={t("site.workspaces.new")}
                  {...status("newWorkspace")}
                >
                  {t("site.rail.new")}
                </Link>
              </li>
            </ul>
          </li>
        </ul>
      }
      {...(screenFilters !== undefined ? { filters: screenFilters.node } : {})}
      {...(filters === undefined
        ? {}
        : {
            filters: (
              <RailFilters activeCount={filters.activeCount} clearHref={ACCOUNTS_PATH}>
                <TextField
                  name="q"
                  type="text"
                  label={t("access.filter.search")}
                  placeholder={t("access.filter.searchPlaceholder")}
                  defaultValue={filters.search}
                  maxLength={ACCOUNT_SEARCH_MAX_LENGTH}
                />
                <Select
                  name="status"
                  label={t("access.filter.status")}
                  defaultValue={filters.status ?? ""}
                  placeholder={t("access.filter.any")}
                  items={[
                    { label: t("access.filter.any"), value: "" },
                    ...ACCOUNT_STATUSES.map((value) => ({
                      label: t(`access.status.${value}`),
                      value,
                    })),
                  ]}
                />
                <Checkbox
                  name="role"
                  value="site-administrator"
                  label={t("site.accounts.filter.siteAdministrators")}
                  defaultSelected={filters.siteAdministrators}
                />
              </RailFilters>
            ),
          })}
    />
  );
}
