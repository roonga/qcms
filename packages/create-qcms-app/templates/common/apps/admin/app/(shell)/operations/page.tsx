import Link from "next/link";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { OperationsFormsTable } from "@/components/ops/operations-forms-table";
import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { shownEnvironment } from "@/lib/environment";
import { t, tPlural } from "@/lib/i18n/en";
import {
  operationsApiQuery,
  operationsClearHref,
  operationsHref,
  operationsInEnvironment,
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
 * The filters, the order and the page position are the address, so a filtered table is a
 * link, survives a refresh and is restored by browser back; the `@rail` slot beside this
 * column reads that same address. The environment is the header's own control, and the
 * address records which one a view was built for so that leaving it resets the page.
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

  const resolved = await resolvedEnvironment(session);
  // One authority for the environment, and it is the header's control rather than the
  // address: a chip saying `prod` beside a table reading `test` is the disagreement A12
  // exists to prevent.
  const environment = shownEnvironment(resolved);
  const read = readOperationsListState(await searchParams);
  const state = environment === undefined ? read : operationsInEnvironment(read, environment);
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

      {environment === undefined && (
        <Alert variant="warning">{t("operations.environmentUnknown")}</Alert>
      )}

      {result?.status === "failed" && (
        <Alert variant="error">{t("operations.loadFailed", { message: result.message })}</Alert>
      )}

      {/* A refusal says this caller operates no form, which is the unfiltered empty panel
          and not the alert above: the two states are told apart here rather than merged. */}
      {result?.status === "denied" && <NoForms state={{ ...state, isFiltered: false }} />}

      {/* The table, both empty states and the pager are inside the ok branch: a read that
          failed knows nothing about how many forms this installation has. */}
      {result?.status === "ok" &&
        (result.page.forms.length === 0 ? (
          <NoForms state={state} />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-(--color-text-muted)" data-testid="qcms-operations-count">
              {tPlural("operations.count.one", "operations.count.other", result.page.total)}
            </p>
            <OperationsFormsTable rows={result.page.forms} />
            <Pager state={state} next={result.page.nextCursor} />
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
