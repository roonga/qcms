import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame, RailTree } from "@/components/rail-frame";
import type { FormListFilters } from "@/lib/forms/list-filters";
import { FORM_SORTS } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import { formsRailItems } from "@/lib/shell/area-rails";

export function FormsListRail({ filters }: { readonly filters: FormListFilters }) {
  const { status, sort, search, activeCount } = filters;

  return (
    <RailFrame
      subject={t("forms.title")}
      testId="qcms-forms-rail"
      sections={<RailTree items={formsRailItems("all")} />}
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
    />
  );
}
