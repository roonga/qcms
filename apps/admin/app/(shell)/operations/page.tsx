import Link from "next/link";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { OperationsEnvironment } from "@/components/ops/operations-environment";
import { OperationsFormsTable } from "@/components/ops/operations-forms-table";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { shownEnvironment } from "@/lib/environment";
import { t, tPlural } from "@/lib/i18n/en";
import {
  operationsApiQuery,
  operationsClearHref,
  operationsHref,
  readOperationsListState,
  type OperationsListState,
} from "@/lib/ops/operations-forms";
import { pageMetadata } from "@/lib/page-title";
import { resolvedEnvironment } from "@/lib/server/environments";
import { listOperationsForms } from "@/lib/server/operations";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { permitsPath } from "@/lib/shell/modes";

export function generateMetadata(): Metadata {
  return pageMetadata(t("shell.mode.operations.name"));
}

/**
 * Operations: the forms a caller operates in one explicitly chosen environment.
 *
 * The whole view is the address, so the filters, the order, the page position and the
 * environment survive a bookmark, a refresh and browser back, and the `@rail` slot beside
 * this column reads that same address.
 *
 * The capability gate here is what a denied bookmark meets, and it names nothing it
 * refused. It is not the authority: `GET /admin/operations/forms` re-decides per form,
 * cell and environment, and a discovery read that failed denies nothing.
 */
export default async function OperationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, "/operations")) {
    return <DeniedRecovery capabilities={capabilities} />;
  }

  const state = readOperationsListState(await searchParams);
  const resolved = await resolvedEnvironment(session);
  // The address first, then the remembered selection: a convenience for a bare link and
  // never an authority, since the API decides what the name reaches.
  const environment = state.environment ?? shownEnvironment(resolved);
  const result =
    environment === undefined
      ? undefined
      : await listOperationsForms(session, operationsApiQuery(state, environment));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("shell.mode.operations.name")}
        </h1>
        <p className="text-sm text-(--color-text-muted)">{t("operations.intro")}</p>
      </div>

      {resolved.status === "known" && environment !== undefined ? (
        <OperationsEnvironment
          environments={resolved.environments}
          selected={environment}
          state={state}
        />
      ) : (
        <Alert variant="warning">{t("environment.unknown")}</Alert>
      )}

      {result !== undefined && !result.ok && (
        <Alert variant="error">{t("operations.loadFailed", { message: result.message })}</Alert>
      )}

      {/* The table, both empty states and the pager are inside the ok branch: a read that
          failed knows nothing about how many forms this installation has. */}
      {result?.ok === true &&
        (result.data.forms.length === 0 ? (
          <NoForms state={state} />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-(--color-text-muted)" data-testid="qcms-operations-count">
              {tPlural("operations.count.one", "operations.count.other", result.data.total)}
            </p>
            <OperationsFormsTable rows={result.data.forms} />
            <Pager state={state} next={result.data.nextCursor} />
          </div>
        ))}
    </div>
  );
}

/**
 * Nothing to show, in its two variants: a filter that matched nothing keeps the panel and
 * offers the way out, while an installation this caller operates nothing in says why.
 */
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

/**
 * Forward paging, plus the way back to the first page. The route issues a position rather
 * than an offset and no backward cursor, so there is no previous-page link to render;
 * browser back walks the positions already visited.
 */
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
