import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { OperationsFormsTable } from "@/components/ops/operations-forms-table";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { shownEnvironment } from "@/lib/environment";
import { t } from "@/lib/i18n/en";
import {
  operationsApiQuery,
  operationsClearHref,
  operationsHref,
  operationsInEnvironment,
  readOperationsListState,
  type OperationsListState,
} from "@/lib/ops/operations-forms";
import { resolvedEnvironment } from "@/lib/server/environments";
import { listOperationsForms } from "@/lib/server/operations";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";
import { permitsPath } from "@/lib/shell/modes";

/** The heading this area keeps while its discovery read is in flight. */
export function OperationsLoading() {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="qcms-operations-loading">
      <h1 className="sr-only">{t("shell.mode.operations.name")}</h1>
      <p className="text-sm text-(--color-text-muted)" role="status">
        {t("operations.loading")}
      </p>
    </div>
  );
}

export async function OperationsScreen({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, "/operations")) {
    return <DeniedRecovery capabilities={capabilities} />;
  }

  const [resolved, workspaceId] = await Promise.all([
    resolvedEnvironment(session),
    currentWorkspaceId(session),
  ]);
  const environment = shownEnvironment(resolved);
  const read = readOperationsListState(await searchParams);
  const state = environment === undefined ? read : operationsInEnvironment(read, environment);
  const result =
    environment === undefined
      ? undefined
      : await listOperationsForms(session, operationsApiQuery(state, environment, workspaceId));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="sr-only">{t("shell.mode.operations.name")}</h1>

      {environment === undefined && (
        <Alert variant="warning">{t("operations.environmentUnknown")}</Alert>
      )}

      {result?.status === "failed" && (
        <Alert variant="error">{t("operations.loadFailed", { message: result.message })}</Alert>
      )}

      {result?.status === "denied" && <NoForms state={{ ...state, isFiltered: false }} />}

      {result?.status === "ok" &&
        (result.page.forms.length === 0 ? (
          <NoForms state={state} />
        ) : (
          <div className="flex flex-col gap-2">
            <OperationsFormsTable rows={result.page.forms} />
            <Pager state={state} next={result.page.nextCursor} />
          </div>
        ))}
    </div>
  );
}

function NoForms({ state }: { readonly state: OperationsListState }) {
  if (state.isFiltered) {
    return (
      <EmptyState
        heading={t("operations.empty.filtered")}
        testId="qcms-operations-empty"
        action={
          <Link href={operationsClearHref(state)} className="qcms-button-link">
            {t("rail.filters.clear")}
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      heading={t("operations.empty.title")}
      body={t("operations.empty.body")}
      testId="qcms-operations-empty"
    />
  );
}

/* The API returns a forward cursor only; browser Back revisits earlier positions. */
function Pager({
  state,
  next,
}: {
  readonly state: OperationsListState;
  readonly next: string | null;
}) {
  if (state.cursor === undefined && next === null) return null;
  return (
    <nav
      aria-label={t("operations.pagination")}
      className="flex flex-wrap items-center gap-4"
      data-testid="qcms-operations-pager"
    >
      {state.cursor !== undefined && (
        <Link className="qcms-text-link" href={operationsHref(state, { cursor: undefined })}>
          {t("operations.page.first")}
        </Link>
      )}
      {next !== null && (
        <Link className="qcms-text-link" href={operationsHref(state, { cursor: next })}>
          {t("operations.page.next")}
        </Link>
      )}
    </nav>
  );
}
