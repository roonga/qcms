import Link from "next/link";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { QuestionsTable } from "@/components/questions/questions-table";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { optionalProp } from "@/lib/questions/errors";
import { readQuestionListFilters } from "@/lib/questions/list-filters";
import { listQuestions } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question library list (task 032; screen contract "list toolbar" + "list `table`").
 *
 * A server component that proxies one call and renders the answer. Every filter is the
 * API's own (`status`, `type`, and `search` which matches the slug or any locale of the
 * label), which is why they live in the URL rather than in component state: a filtered
 * library is a place an author can link to and come back to, and the filtering stays
 * where the data is instead of being re-implemented over a page of rows.
 *
 * The filter controls are `components/questions/questions-list-rail.tsx`, in the `@rail` slot
 * beside this column; this page keeps only the reading of them, through the same
 * `readQuestionListFilters` the slot reads. The filtered-empty panel keeps its own
 * "Clear filters" beside the rail's (contract §3).
 *
 * ## The one column the screen contract asks for that is not here
 *
 * **Updated** is drawn in the screen contract and there is nothing to draw it from: nothing in
 * the schema records when a version was last edited. `question_versions` carries
 * `published_at` and nothing else, and `questions.created_at` is the identity's birthday
 * rather than the latest version's. So the honest options are a `question_versions`
 * schema change (a new column plus a touch-on-write trigger, on the table whose whole
 * point is that published rows are frozen - I1) or a column labelled "Updated" showing a
 * publish date and blank for every draft, which is precisely the row that changes most.
 * Neither is this screen's call to make, so the created date is what is shown, under its
 * own name, and the choice is recorded on issue #218 for the Code Owner.
 *
 * Pagination is absent by the screen contract's own note (`[upstream gap]`): the list route
 * takes no page or cursor parameter, and client-side paging over a full result set would
 * be a worse answer than none at launch scale.
 */

/** The browser-tab title for this route (issue #536). */
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
    search,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-(--color-text)">{t("questions.title")}</h1>
          <p className="text-sm text-(--color-text-muted)">{t("questions.intro")}</p>
        </div>
        {/* The header's creating action, rendered except in the one state where the
            empty panel below carries it instead: an unfiltered library with nothing in
            it. Two controls with the same accessible name on one screen are ambiguous to
            anyone navigating by name, and `plan/admin-design-contracts.md` §3 asks the
            empty state to OFFER the creating action rather than to sit beside a copy of
            it. A filtered-empty library is not that state: the library is not empty, the
            way out is the clear link, and this link stays. */}
        {!(result.ok && result.data.length === 0 && !isFiltered) && (
          <Link href="/questions/new" className="qcms-button-link">
            {t("questions.new")}
          </Link>
        )}
      </div>

      {!result.ok && (
        <Alert variant="error">
          {t("questions.error.listFailed", { message: result.message })}
        </Alert>
      )}

      {/* §3's panel, in both variants: the filtered one drops the explanatory sentence and
          offers the clear link, the unfiltered one offers the creating action. */}
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
