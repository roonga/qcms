import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import { formContextHref } from "@/lib/ops/form-contexts";
import {
  OPERATIONS_INTAKES,
  OPERATIONS_SORTS,
  operationsClearHref,
  type OperationsFormRow,
  type OperationsListState,
} from "@/lib/ops/operations-forms";
import { operationsRailItems } from "@/lib/shell/area-rails";

/* The rows are already the current workspace's, because the switcher in the top bar is the only chooser:
   the rail names forms, never workspaces. */

export function OperationsFormsRail({
  state,
  forms,
  showQueues,
}: {
  readonly state: OperationsListState;
  readonly forms: readonly OperationsFormRow[];
  readonly showQueues: boolean;
}) {
  const { search, intake, sort, activeCount } = state;
  const items = [
    ...operationsRailItems("forms", showQueues),
    ...forms.map((form) => ({
      key: `form:${form.formId}`,
      href: formContextHref(form.formId, "responses"),
      label: form.displayName,
    })),
  ];

  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      testId="qcms-operations-rail"
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      {...(items.length === 0 ? {} : { sections: <RailTree items={items} /> })}
      filters={
        <RailFilters activeCount={activeCount} clearHref={operationsClearHref(state)}>
          {state.environment !== undefined && (
            <input type="hidden" name="env" value={state.environment} />
          )}
          <TextField
            name="q"
            label={t("operations.filter.search")}
            description={t("operations.filter.searchHint")}
            defaultValue={search}
            maxLength={LIBRARY_SEARCH_MAX_LENGTH}
          />
          <Select
            name="intake"
            label={t("operations.filter.intake")}
            defaultValue={intake ?? ""}
            placeholder={t("operations.filter.intakeAll")}
            items={[
              { label: t("operations.filter.intakeAll"), value: "" },
              ...OPERATIONS_INTAKES.map((value) => ({
                label: t(`operations.intake.${value}`),
                value,
              })),
            ]}
          />
          <Select
            name="sort"
            label={t("operations.filter.sort")}
            defaultValue={sort}
            items={OPERATIONS_SORTS.map((value) => ({
              label: t(`operations.filter.sort.${value}`),
              value,
            }))}
          />
        </RailFilters>
      }
    />
  );
}
