import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import {
  OPERATIONS_INTAKES,
  OPERATIONS_SORTS,
  operationsClearHref,
  type OperationsListState,
  type OperationsWorkspace,
} from "@/lib/ops/operations-forms";
import { operationsRailItems } from "@/lib/shell/area-rails";

export function OperationsFormsRail({
  state,
  workspaces,
  showQueues,
}: {
  readonly state: OperationsListState;
  readonly workspaces: readonly OperationsWorkspace[];
  readonly showQueues: boolean;
}) {
  const { search, workspaceId, intake, sort, activeCount } = state;

  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      testId="qcms-operations-rail"
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      sections={<RailTree items={operationsRailItems("forms", showQueues)} />}
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
            name="workspace"
            label={t("operations.filter.workspace")}
            defaultValue={workspaceId ?? ""}
            placeholder={t("operations.filter.workspaceAll")}
            items={[
              { label: t("operations.filter.workspaceAll"), value: "" },
              ...workspaces.map((workspace) => ({
                label: workspace.name,
                value: workspace.workspaceId,
              })),
            ]}
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
