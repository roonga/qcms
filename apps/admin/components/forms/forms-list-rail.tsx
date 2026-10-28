import Link from "next/link";

import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import type { FormListFilters } from "@/lib/forms/list-filters";
import { FORM_SORTS } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";

/**
 * The form library's rail: a Header, Search, Status, Sort and the creating action
 * (`plan/admin-design-contracts.md` §7.0).
 *
 * No Sections: a row per form would repeat the table beside it. The sort sits in the
 * Filters part but is not counted as active, since it hides no row.
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
            // The API answers 400 past this length (issue #862).
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
          {/* No "any" option: the list always comes back in some order, so the control shows
              the one in force, resolved rather than raw. */}
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
