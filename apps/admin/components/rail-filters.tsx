import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/kit";
import { t, tPlural } from "@/lib/i18n/en";

/**
 * The rail's Filters part: a native GET form, so the URL carries the filter state
 * (`plan/admin-design-contracts.md` §7.0 ruling 2.4).
 *
 * "Filters" is a paragraph rather than a heading because the rail renders before `<main>`,
 * where a heading breaks `heading-order`.
 */
export function RailFilters({
  activeCount,
  clearHref,
  children,
}: {
  /** How many of this screen's filters are set. Zero hides the count and the clear link. */
  readonly activeCount: number;
  /** The screen's unfiltered address. */
  readonly clearHref: string;
  /** The screen's controls, in the ruled order: search, status, type or other, then sort. */
  readonly children: ReactNode;
}) {
  return (
    <form
      method="get"
      role="search"
      aria-label={t("rail.filters")}
      className="qcms-filters qcms-rail__filters"
      data-testid="qcms-rail-filters"
    >
      <p className="qcms-rail__filters-title" data-testid="qcms-rail-filters-title">
        <span>{t("rail.filters")}</span>
        {activeCount > 0 && (
          <span className="qcms-tag qcms-tag--draft" data-rail-filters-active={activeCount}>
            {activeFilterCount(activeCount)}
          </span>
        )}
      </p>
      {children}
      <div className="qcms-rail__filters-apply">
        <Button type="submit" variant="secondary" size="md">
          {t("rail.filters.apply")}
        </Button>
        {activeCount > 0 && (
          <Link href={clearHref} className="qcms-text-link">
            {t("rail.filters.clear")}
          </Link>
        )}
      </div>
    </form>
  );
}

/** The active-filter count, shared by the Filters part and the Header's collapsed summary. */
export function activeFilterCount(count: number): string {
  return tPlural("rail.filters.activeOne", "rail.filters.active", count);
}
