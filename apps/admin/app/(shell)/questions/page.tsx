import Link from "next/link";
import type { Metadata } from "next";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { QuestionsTable } from "@/components/questions/questions-table";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { optionalProp } from "@/lib/questions/errors";
import { readQuestionListFilters } from "@/lib/questions/list-filters";
import { listQuestions } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

/* The API exposes no updated timestamp or pagination; show the actual created date rather than inventing
   either. */

export function generateMetadata(): Metadata {
  return pageMetadata(t("questions.title"));
}

export default async function QuestionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { status, type, search, isFiltered } = readQuestionListFilters(await searchParams);

  const result = await listQuestions(session, {
    ...optionalProp("status", status),
    ...optionalProp("type", type),
    ...optionalProp("workspaceId", await currentWorkspaceId(session)),
    search,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="qcms-page-actionbar">
        <h1 className="sr-only">{t("questions.title")}</h1>
        {/* Offer creation once: the unfiltered empty panel owns it, while a filtered-empty list keeps the header
   action. */}
        {!(result.ok && result.data.length === 0 && !isFiltered) && (
          <HeadingMarker control="questions.create">
            <Link href="/questions/new" className="qcms-button-link">
              {t("questions.new")}
            </Link>
          </HeadingMarker>
        )}
      </div>

      {!result.ok && (
        <Alert variant="error">
          {t("questions.error.listFailed", { message: result.message })}
        </Alert>
      )}

      {result.ok &&
        result.data.length === 0 &&
        (isFiltered ? (
          <EmptyState
            heading={t("questions.empty.filtered")}
            testId="qcms-questions-empty"
            action={
              <Link href="/questions" className="qcms-button-link">
                {t("questions.filter.clear")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            heading={t("questions.empty.title")}
            body={t("questions.empty.body")}
            testId="qcms-questions-empty"
            action={
              <Link href="/questions/new" className="qcms-button-link">
                {t("questions.new")}
              </Link>
            }
          />
        ))}

      {result.ok && result.data.length > 0 && (
        <div className="flex flex-col gap-2">
          <QuestionsTable rows={result.data} />
          <p className="text-sm text-(--color-text-muted)">{t("questions.table.hint")}</p>
        </div>
      )}
    </div>
  );
}
