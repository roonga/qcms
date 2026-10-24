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
 * ## The filters are in the rail, and the way out of them is there too
 *
 * §7.0 ruling 4 (Code Owner, 2026-10-24; issue #1117) moves list filters out of the content
 * column: the three controls, their Apply and their clear link are
 * `components/questions/questions-list-rail.tsx`, rendered in the `@rail` slot beside this
 * column. What this page keeps is the reading of them, through the same
 * `readQuestionListFilters` the slot reads, because the two trees cannot hand each other a
 * value and a second parse is how they would start disagreeing.
 *
 * **The filtered-empty panel no longer carries "Clear filters".** It used to, as its call to
 * action, and the rail's link would have been a second control with the same accessible name
 * on the same screen - which is ambiguous to anyone navigating by name, and which the browser
 * suite has already caught once on this screen (`e2e/questions-lifecycle.pw.ts` resolved that
 * name to two elements). The panel still says that nothing matched; the way out of a filter
 * is where the filter is.
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
            way out is the rail's clear link, and this link stays. */}
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

      {/* `plan/admin-design-contracts.md` §3's panel, in both of its variants. The
          filtered one swaps the heading to the screen's own "no matches" line and drops
          the explanatory sentence: an operator who has just typed a filter is not asking
          what the library is for. It also carries NO action since issue #1117 - the way
          out of a filter is the rail's clear link, and a second "Clear filters" here
          would be two controls with one accessible name on one screen. The unfiltered
          one keeps the sentence and offers the creating action, which is the same
          destination as the header link - an empty screen is where a first-time operator
          looks, not the corner of the header. */}
      {result.ok &&
        result.data.length === 0 &&
        (isFiltered ? (
          <EmptyState heading={t("questions.empty.filtered")} testId="qcms-questions-empty" />
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
