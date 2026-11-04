import Link from "next/link";

import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import {
  OPERATIONS_INTAKES,
  OPERATIONS_SORTS,
  operationsClearHref,
  type OperationsListState,
  type OperationsWorkspace,
} from "@/lib/ops/operations-forms";

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
      title={t("shell.mode.operations.name")}
      testId="qcms-operations-rail"
      filterCount={activeCount}
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      {...(showQueues
        ? {
            sections: (
              <ul className="qcms-rail__group" data-rail-group="sections">
                <li>
                  <Link
                    href="/webhooks"
                    className="qcms-rail__link"
                    data-rail-item="queue:delivery-failures"
                  >
                    {t("operations.queue.deliveryFailures")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/responses/erasures"
                    className="qcms-rail__link"
                    data-rail-item="queue:erasure-log"
                  >
                    {t("operations.queue.erasureLog")}
                  </Link>
                </li>
              </ul>
            ),
          }
        : {})}
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
