import Link from "next/link";

import { TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import type { ResponsesIndexFilters } from "@/lib/ops/list-filters";

/**
 * The responses index's parts of the one rail (`plan/admin-design-contracts.md` §7.0,
 * Code Owner 2026-10-24; issue #1117).
 *
 * §7.0's table: "Responses | Responses | Erasure log | Search forms | -".
 *
 * - **Header:** "Responses", a top-level screen, with the active filter count below
 *   `--bp-sidebar`.
 * - **Sections:** one row, the erasure log. It is the screen's only sibling and a route of
 *   its own, which is exactly what a Section is for; the content column keeps its link too,
 *   because the log is also a thing an operator reads about on this screen rather than only
 *   navigates to from beside it.
 * - **Filters:** Search forms. The screen's body is a way IN - a list of forms to open
 *   responses for - so the one filter it can have narrows that list, and the label says
 *   "forms" rather than "Search" so nobody reads it as a search over answers.
 * - **Actions:** none. Nothing is created here.
 *
 * A server component. The filter is a fact about the address, read by the slot through the
 * same `readResponsesIndexFilters` the page reads.
 */
export function ResponsesIndexRail({ filters }: { readonly filters: ResponsesIndexFilters }) {
  const { search, activeCount } = filters;

  return (
    <RailFrame
      subject={t("ops.area.responses.title")}
      title={t("ops.area.responses.title")}
      testId="qcms-responses-rail"
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
            // The same cap the two library screens apply, and for the same reason: the API
            // answers 400 past it (issues #686, #862), so the control stops an operator
            // there instead.
            maxLength={LIBRARY_SEARCH_MAX_LENGTH}
          />
        </RailFilters>
      }
    />
  );
}
