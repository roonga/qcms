import Link from "next/link";

import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import type { FormListFilters } from "@/lib/forms/list-filters";
import { FORM_SORTS } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";

/**
 * The form library's parts of the one rail (`plan/admin-design-contracts.md` §7.0,
 * Code Owner 2026-10-24; issue #1117).
 *
 * The sibling of `components/questions/questions-list-rail.tsx` and deliberately the same
 * shape: §7.0's table gives both library screens a Header, no Sections, their filters and
 * one creating action, and a reader walking between the two should find the same rail with
 * different contents.
 *
 * - **Header:** "Forms", with the active filter count below `--bp-sidebar`.
 * - **Sections:** none. A row per form would be the rail repeating the table beside it,
 *   which `plan/admin-ux-audit.md` §5.4 rejects.
 * - **Filters:** Search, Status, Sort - the ruled order with the sort last.
 * - **Actions:** New form.
 *
 * **Sort is in the Filters part but is not counted as a filter.** A sort never removes a
 * row, so counting it would show "1 active" over an unnarrowed library beside a clear link
 * that changes nothing; `lib/forms/list-filters.ts` is where that is decided, once, for this
 * rail and for the page's empty state.
 *
 * A server component: which filters are set is a fact about the address, read by the slot
 * through the same `readFormListFilters` the page reads.
 */
export function FormsListRail({ filters }: { readonly filters: FormListFilters }) {
  const { status, sort, search, activeCount } = filters;

  return (
    <RailFrame
      subject={t("forms.title")}
      title={t("forms.title")}
      testId="qcms-forms-rail"
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      filters={
        <RailFilters activeCount={activeCount} clearHref="/forms">
          <TextField
            name="q"
            label={t("forms.filter.search")}
            description={t("forms.filter.searchHint")}
            defaultValue={search}
            // The API caps the term at the same number and answers 400 past it
            // (issues #686, #862); this stops the author there instead.
            maxLength={LIBRARY_SEARCH_MAX_LENGTH}
          />
          <Select
            name="status"
            label={t("forms.filter.status")}
            defaultValue={status ?? ""}
            placeholder={t("forms.filter.statusAll")}
            items={[
              { label: t("forms.filter.statusAll"), value: "" },
              { label: t("forms.status.open"), value: "open" },
              { label: t("forms.status.closed"), value: "closed" },
            ]}
          />
          {/* Sort has no "any" option, because there is no such order: the list comes back
              in some sequence whatever the URL says, so the control always shows the one in
              force. `sort` is resolved rather than raw for that reason - an unreadable key
              in the URL shows as the default here instead of leaving the control blank. */}
          <Select
            name="sort"
            label={t("forms.filter.sort")}
            defaultValue={sort}
            items={FORM_SORTS.map((value) => ({
              label: t(`forms.filter.sort.${value}`),
              value,
            }))}
          />
        </RailFilters>
      }
      actions={
        <Link href="/forms/new" className="qcms-rail__action-link">
          {t("forms.new")}
        </Link>
      }
    />
  );
}
