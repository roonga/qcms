import Link from "next/link";

import { Checkbox, Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import {
  ACCOUNT_SEARCH_MAX_LENGTH,
  ACCOUNT_STATUSES,
  ACCOUNTS_PATH,
  NEW_ACCOUNT_PATH,
  type AccountFilters,
} from "@/lib/site/accounts";
import { SHARED_LIBRARY_PATH } from "@/lib/membership/site";

export type SiteRailRow = "accounts" | "newAccount" | "sharedLibrary";

/**
 * The Site configuration rail: its rows, and on the Accounts list the directory filters. The
 * Shared question library row is drawn at two or more workspaces only (`docs/WORKSPACE_ACCESS.md`
 * section 9).
 */
export function SiteRail({
  current,
  offersLibrary,
  filters,
  account,
}: {
  readonly current: SiteRailRow;
  readonly offersLibrary: boolean;
  readonly filters?: AccountFilters;
  /** The account page's subject, for the breadcrumb. */
  readonly account?: string;
}) {
  const subject = t("site.title");
  const status = (row: SiteRailRow) => (row === current ? { "aria-current": "page" as const } : {});
  return (
    <RailFrame
      subject={subject}
      testId="qcms-site-rail"
      {...(account === undefined ? {} : { crumbs: { account } })}
      {...(filters !== undefined && filters.activeCount > 0
        ? { count: <RailCount>{activeFilterCount(filters.activeCount)}</RailCount> }
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
          {offersLibrary ? (
            <li>
              <Link
                href={SHARED_LIBRARY_PATH}
                className="qcms-rail__link"
                data-rail-item="section:shared-library"
                {...status("sharedLibrary")}
              >
                {t("site.library.title")}
              </Link>
            </li>
          ) : null}
        </ul>
      }
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
