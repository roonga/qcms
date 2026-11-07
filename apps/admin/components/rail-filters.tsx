import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/kit";
import { t, tPlural } from "@/lib/i18n/en";

/* Use prose labels in the rail: it precedes main, so headings here would break the page outline. */
export function RailFilters({
  activeCount,
  clearHref,
  children,
}: {
  readonly activeCount: number;
  readonly clearHref: string;
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
      {activeCount > 0 && (
        <p className="qcms-rail__filters-title" data-testid="qcms-rail-filters-title">
          <span className="qcms-tag qcms-tag--draft" data-rail-filters-active={activeCount}>
            {activeFilterCount(activeCount)}
          </span>
        </p>
      )}
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

export function activeFilterCount(count: number): string {
  return tPlural("rail.filters.activeOne", "rail.filters.active", count);
}
