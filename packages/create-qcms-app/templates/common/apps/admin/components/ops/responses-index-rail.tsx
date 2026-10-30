import Link from "next/link";

import { TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import type { ResponsesIndexFilters } from "@/lib/ops/list-filters";

/**
 * The responses index's rail: the erasure log as its one Section, and a search over the
 * forms in the way-in list (`plan/admin-design-contracts.md` §7.0).
 */
export function ResponsesIndexRail({ filters }: { readonly filters: ResponsesIndexFilters }) {
  const { search, activeCount } = filters;

  return (
    <RailFrame
      subject={t("ops.area.responses.title")}
      title={t("ops.area.responses.title")}
      testId="qcms-responses-rail"
      filterCount={activeCount}
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          <li>
            <Link
              href="/responses/erasures"
              className="qcms-rail__link"
              data-rail-item="section:erasures"
            >
              {t("ops.area.responses.erasureLog")}
            </Link>
          </li>
        </ul>
      }
      filters={
        <RailFilters activeCount={activeCount} clearHref="/responses">
          <TextField
            name="q"
            label={t("ops.area.responses.filter.search")}
            description={t("ops.area.responses.filter.searchHint")}
            defaultValue={search}
            // The API answers 400 past this length.
            maxLength={LIBRARY_SEARCH_MAX_LENGTH}
          />
        </RailFilters>
      }
    />
  );
}
