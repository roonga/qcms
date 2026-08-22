import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Card, Select, TextField } from "@/components/kit";
import { QuestionsTable } from "@/components/questions/questions-table";
import { t } from "@/lib/i18n/en";
import { optionalProp } from "@/lib/questions/errors";
import { QUESTION_TYPES, type QuestionStatus, type QuestionType } from "@/lib/questions/types";
import { listQuestions } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question library list (task 032; wireframe "list toolbar" + "list `table`").
 *
 * A server component that proxies one call and renders the answer. Every filter is the
 * API's own (`status`, `type`, and `search` which matches the slug or any locale of the
 * label), which is why they live in the URL rather than in component state: a filtered
 * library is a place an author can link to and come back to, and the filtering stays
 * where the data is instead of being re-implemented over a page of rows.
 *
 * ## The one column the wireframe asks for that is not here
 *
 * **Updated** is drawn in the wireframe and there is nothing to draw it from: nothing in
 * the schema records when a version was last edited. `question_versions` carries
 * `published_at` and nothing else, and `questions.created_at` is the identity's birthday
 * rather than the latest version's. So the honest options are a `question_versions`
 * schema change (a new column plus a touch-on-write trigger, on the table whose whole
 * point is that published rows are frozen - I1) or a column labelled "Updated" showing a
 * publish date and blank for every draft, which is precisely the row that changes most.
 * Neither is this screen's call to make, so the created date is what is shown, under its
 * own name, and the choice is recorded on issue #218 for the Code Owner.
 *
 * Pagination is absent by the wireframe's own note (`[upstream gap]`): the list route
 * takes no page or cursor parameter, and client-side paging over a full result set would
 * be a worse answer than none at launch scale.
 */

/** One raw search-param value, as Next hands it over. */
type SearchParam = string | string[] | undefined;

/** The status filter's four states. `undefined` means "any". */
function parseStatus(raw: SearchParam): QuestionStatus | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "draft" || value === "published" || value === "deprecated" ? value : undefined;
}

/** The type filter's eight states. `undefined` means "any". */
function parseType(raw: SearchParam): QuestionType | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return QUESTION_TYPES.find((type) => type === value);
}

function firstValue(raw: SearchParam): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? "";
}

export default async function QuestionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const status = parseStatus(params["status"]);
  const type = parseType(params["type"]);
  const search = firstValue(params["q"]);
  const isFiltered = status !== undefined || type !== undefined || search.trim() !== "";

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
            panel's CTA is "Clear filters", and this link stays. */}
        {!(result.ok && result.data.length === 0 && !isFiltered) && (
          <Link href="/questions/new" className="qcms-button-link">
            {t("questions.new")}
          </Link>
        )}
      </div>

      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          {/* A GET form, so a filtered library is a URL: shareable, bookmarkable, and
              still operable with JavaScript off even though the editor is not. */}
          <form method="get" className="qcms-filters">
            <fieldset className="qcms-fieldset qcms-fieldset--flat">
              <legend className="qcms-visually-hidden">{t("questions.filter.legend")}</legend>
              <div className="qcms-filters__row">
                <TextField
                  name="q"
                  label={t("questions.filter.search")}
                  description={t("questions.filter.searchHint")}
                  defaultValue={search}
                />
                <Select
                  name="status"
                  label={t("questions.filter.status")}
                  defaultValue={status ?? ""}
                  placeholder={t("questions.filter.statusAll")}
                  items={[
                    { label: t("questions.filter.statusAll"), value: "" },
                    { label: t("questions.status.draft"), value: "draft" },
                    { label: t("questions.status.published"), value: "published" },
                    { label: t("questions.status.deprecated"), value: "deprecated" },
                  ]}
                />
                <Select
                  name="type"
                  label={t("questions.filter.type")}
                  defaultValue={type ?? ""}
                  placeholder={t("questions.filter.typeAll")}
                  items={[
                    { label: t("questions.filter.typeAll"), value: "" },
                    ...QUESTION_TYPES.map((value) => ({
                      label: t(`questions.type.${value}`),
                      value,
                    })),
                  ]}
                />
                <div className="flex items-end gap-2">
                  <Button type="submit" variant="secondary" size="md">
                    {t("questions.filter.apply")}
                  </Button>
                  {/* The filter's own reset, rendered except when the filtered-empty
                      panel below is carrying it as its CTA
                      (`plan/admin-design-contracts.md` §3). Same rule as the header's
                      creating action above and the webhook screen's Add button: the
                      empty panel OFFERS the way out rather than sitting beside a second
                      control with the same accessible name. Two "Clear filters" links on
                      one screen are ambiguous to anyone navigating by name, and the
                      browser suite said so - `questions-lifecycle.pw.ts` resolved the
                      name to two elements. */}
                  {isFiltered && !(result.ok && result.data.length === 0) && (
                    <Link href="/questions" className="qcms-text-link">
                      {t("questions.filter.clear")}
                    </Link>
                  )}
                </div>
              </div>
            </fieldset>
          </form>
        </Card>
      </div>

      {!result.ok && (
        <Alert variant="error">
          {t("questions.error.listFailed", { message: result.message })}
        </Alert>
      )}

      {/* `plan/admin-design-contracts.md` §3's panel, in both of its variants. The
          filtered one keeps the panel and the clear-filters action, swaps the heading
          to the screen's own "no matches" line, and drops the explanatory sentence:
          an operator who has just typed a filter is not asking what the library is
          for. The unfiltered one keeps the sentence and offers the creating action,
          which is the same destination as the header link - an empty screen is where
          a first-time operator looks, not the corner of the header. */}
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
