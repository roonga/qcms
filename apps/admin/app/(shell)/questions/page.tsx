import Link from "next/link";

import { Alert, Button, Card, Select, TextField, type TableRow } from "@/components/kit";
import { QuestionsTable } from "@/components/questions/questions-table";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import { optionalProp } from "@/lib/questions/errors";
import type { QuestionListItem, QuestionStatus } from "@/lib/questions/types";
import { listQuestions } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question library list (task 032; wireframe "list toolbar" + "list `table`").
 *
 * A server component that proxies one call and renders the answer. Both filters are the
 * API's own (`status`, and `search` which matches the slug or any locale of the label),
 * which is why they live in the URL rather than in component state: a filtered library is
 * a place an author can link to and come back to, and the filtering stays where the data
 * is instead of being re-implemented over a page of rows.
 *
 * ## The two columns the wireframe asks for that are not here
 *
 * **Type** and **updated** are drawn in the wireframe, and neither is in the payload
 * `GET /admin/questions` returns: it carries `questionId`, `slug`, `createdAt`,
 * `latestVersion`, `latestStatus`, `publishedAt` and the label, and nothing about the
 * question's type or its last edit. A type column would need either a read per row or a
 * new field on the API, and 032 is an `apps/admin` task, so this ships the columns the
 * API affords and the gap is recorded as an issue rather than papered over with a fetch
 * storm. The type is shown on the detail screen, where the definition is in hand.
 *
 * Pagination is absent for the same reason: the list route takes no page or cursor
 * parameter, and client-side paging over a full result set would be a worse answer than
 * none at launch scale.
 */

/** One raw search-param value, as Next hands it over. */
type SearchParam = string | string[] | undefined;

/** The status filter's four states. `undefined` means "any". */
function parseStatus(raw: SearchParam): QuestionStatus | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "draft" || value === "published" || value === "deprecated" ? value : undefined;
}

function firstValue(raw: SearchParam): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? "";
}

/** ISO day. Formatted on the server so the client renders the identical string. */
function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function toRow(question: QuestionListItem): TableRow {
  return {
    id: question.questionId,
    data: {
      questionId: question.questionId,
      label: textOf(question.label ?? undefined),
      version: `v${String(question.latestVersion)}`,
      status: t(`questions.status.${question.latestStatus}`),
      created: isoDay(question.createdAt),
    },
  };
}

export default async function QuestionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const status = parseStatus(params["status"]);
  const search = firstValue(params["q"]);
  const isFiltered = status !== undefined || search.trim() !== "";

  const result = await listQuestions(session, { ...optionalProp("status", status), search });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-(--color-text)">{t("questions.title")}</h1>
          <p className="text-sm text-(--color-text-muted)">{t("questions.intro")}</p>
        </div>
        <Link href="/questions/new" className="qcms-button-link">
          {t("questions.new")}
        </Link>
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
                <div className="flex items-end gap-2">
                  <Button type="submit" variant="secondary" size="md">
                    {t("questions.filter.apply")}
                  </Button>
                  {isFiltered && (
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

      {result.ok && result.data.length === 0 && (
        <div className="qcms-card">
          <Card padding="md" radius="md" border>
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-(--color-text)">
                {isFiltered ? t("questions.empty.filtered") : t("questions.empty.title")}
              </h2>
              {!isFiltered && (
                <p className="text-sm text-(--color-text-muted)">{t("questions.empty.body")}</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {result.ok && result.data.length > 0 && (
        <div className="flex flex-col gap-2">
          <QuestionsTable
            rows={result.data.map(toRow)}
            columns={[
              { id: "questionId", label: t("questions.column.id"), isRowHeader: true },
              { id: "label", label: t("questions.column.label") },
              { id: "version", label: t("questions.column.version") },
              { id: "status", label: t("questions.column.status") },
              { id: "created", label: t("questions.column.created") },
            ]}
          />
          <p className="text-sm text-(--color-text-muted)">{t("questions.table.hint")}</p>
        </div>
      )}
    </div>
  );
}
