import Link from "next/link";
import type { Metadata } from "next";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { readFormListFilters } from "@/lib/forms/list-filters";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { optionalProp } from "@/lib/questions/errors";
import { listForms } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

import { FormsTable } from "./forms-table";

export function generateMetadata(): Metadata {
  return pageMetadata(t("forms.title"));
}

export default async function FormsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { status, sort, search, isFiltered } = readFormListFilters(await searchParams);

  const result = await listForms(session, {
    ...optionalProp("status", status),
    ...optionalProp("workspaceId", await currentWorkspaceId(session)),
    search,
    sort,
  });

  const isEmpty = result.ok && result.data.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="qcms-page-actionbar">
        <h1 className="sr-only">{t("forms.title")}</h1>
        {!(isEmpty && !isFiltered) && (
          <HeadingMarker control="forms.create">
            <Link href="/forms/new" className="qcms-button-link">
              {t("forms.new")}
            </Link>
          </HeadingMarker>
        )}
      </div>

      {!result.ok && (
        <Alert variant="error">{t("forms.error.listFailed", { message: result.message })}</Alert>
      )}

      {isEmpty &&
        (isFiltered ? (
          <EmptyState
            heading={t("forms.empty.filtered")}
            testId="qcms-forms-empty"
            action={
              <Link href="/forms" className="qcms-button-link">
                {t("forms.filter.clear")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            heading={t("forms.empty.title")}
            body={t("forms.empty.body")}
            testId="qcms-forms-empty"
            action={
              <Link href="/forms/new" className="qcms-button-link">
                {t("forms.new")}
              </Link>
            }
          />
        ))}

      {result.ok && result.data.length > 0 && (
        <div className="flex flex-col gap-2">
          <FormsTable rows={result.data} />
          <p className="text-sm text-(--color-text-muted)">{t("forms.table.hint")}</p>
        </div>
      )}
    </div>
  );
}
