import Link from "next/link";

import { Select, TextField } from "@/components/kit";
import { WorkspaceSummary } from "@/components/membership/workspace-summary";
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
  type OperationsWorkspace,
} from "@/lib/ops/operations-forms";
import { operationsRailItems } from "@/lib/shell/area-rails";
import { OPERATIONS_PATH } from "@/lib/shell/modes";

const FORMS_PER_WORKSPACE = 8;

function workspaceHref(state: OperationsListState, workspaceId: string): string {
  const query = new URLSearchParams();
  if (state.environment !== undefined) query.set("env", state.environment);
  query.set("workspace", workspaceId);
  return `${OPERATIONS_PATH}?${query.toString()}`;
}

/** One workspace per group, the chosen one (or the first) open; a lone workspace is always open. */
function WorkspaceGroups({
  state,
  workspaces,
  forms,
}: {
  readonly state: OperationsListState;
  readonly workspaces: readonly OperationsWorkspace[];
  readonly forms: readonly OperationsFormRow[];
}) {
  if (workspaces.length === 0) return null;
  const openId = state.workspaceId ?? workspaces[0]?.workspaceId;
  return (
    <ul className="qcms-rail__group" data-rail-group="workspaces">
      {workspaces.map((workspace) => {
        const own = forms.filter((form) => form.workspace.workspaceId === workspace.workspaceId);
        const href = workspaceHref(state, workspace.workspaceId);
        const rows = (
          <ul className="qcms-rail__group pl-3" data-rail-group="workspace-forms">
            {own.slice(0, FORMS_PER_WORKSPACE).map((form) => (
              <li key={form.formId}>
                <Link
                  href={formContextHref(form.formId, "responses")}
                  className="qcms-rail__link"
                  data-rail-item={`form:${form.formId}`}
                >
                  {form.displayName}
                </Link>
              </li>
            ))}
            {own.length > FORMS_PER_WORKSPACE && (
              <li>
                <Link href={href} className="qcms-rail__link" data-rail-item="more">
                  {t("operations.rail.more")}
                </Link>
              </li>
            )}
          </ul>
        );
        return (
          <li key={workspace.workspaceId}>
            {workspaces.length === 1 ? (
              <>
                <Link
                  href={href}
                  className="qcms-rail__link"
                  data-rail-item={`workspace:${workspace.workspaceId}`}
                  aria-expanded
                >
                  {workspace.name}
                </Link>
                {rows}
              </>
            ) : (
              <details
                name="qcms-operations-accordion"
                className="qcms-rail__accordion"
                open={workspace.workspaceId === openId}
              >
                <WorkspaceSummary href={href} railItem={`workspace:${workspace.workspaceId}`}>
                  {workspace.name}
                </WorkspaceSummary>
                {rows}
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function OperationsFormsRail({
  state,
  workspaces,
  forms,
  showQueues,
}: {
  readonly state: OperationsListState;
  readonly workspaces: readonly OperationsWorkspace[];
  readonly forms: readonly OperationsFormRow[];
  readonly showQueues: boolean;
}) {
  const { search, intake, sort, activeCount } = state;
  const queues = operationsRailItems("forms", showQueues);

  return (
    <RailFrame
      subject={t("shell.mode.operations.name")}
      testId="qcms-operations-rail"
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      sections={
        <>
          {queues.length > 0 && <RailTree items={queues} />}
          <WorkspaceGroups state={state} workspaces={workspaces} forms={forms} />
        </>
      }
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
