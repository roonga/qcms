import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { ResponseBrowser } from "@/components/ops/response-browser";
import { t } from "@/lib/i18n/en";
import { getForm } from "@/lib/server/forms";
import { listResponses } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

/**
 * One form's response browser (task 035; wireframe "browser toolbar / table").
 *
 * The filters live in the URL and the **server** applies them, by handing them
 * straight to the API's list route. That is what makes the paging honest: the count
 * and the page controls describe the filtered set the API computed, not a slice of it
 * this app filtered again afterwards.
 *
 * An erased session is absent here without this page doing anything about it: the API
 * reads a reporting view with a tombstone anti-join (023). There is deliberately no
 * "hide erased" logic in this app to get out of step with it.
 */
export default async function FormResponsesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const query = await searchParams;

  const filters = {
    version: one(query["version"]),
    from: one(query["from"]),
    to: one(query["to"]),
    flagged: one(query["flagged"]),
  };
  const page = Math.max(1, Number.parseInt(one(query["page"]) || "1", 10) || 1);

  const [detail, responses] = await Promise.all([
    getForm(session, formId),
    listResponses(session, formId, {
      ...(filters.version === "" ? {} : { version: filters.version }),
      ...(filters.from === "" ? {} : { from: `${filters.from}T00:00:00.000Z` }),
      ...(filters.to === "" ? {} : { to: `${filters.to}T23:59:59.999Z` }),
      ...(filters.flagged === "true" || filters.flagged === "false"
        ? { flagged: filters.flagged }
        : {}),
      page,
    }),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        slug={form.slug}
        section="responses"
        status={form.status}
      />
      {!responses.ok && (
        <Alert variant="error">
          {t("ops.responses.listFailed", { message: responses.message })}
        </Alert>
      )}
      <ResponseBrowser
        formId={form.formId}
        page={responses.ok ? responses.data : { responses: [], page: 1, pageSize: 50, total: 0 }}
        versions={form.versions.map((version) => version.version).sort((a, b) => b - a)}
        filters={filters}
        hasFilters={Object.values(filters).some((value) => value !== "")}
      />
    </div>
  );
}

/**
 * Read one value out of a search param.
 *
 * Next hands a repeated parameter back as an array. Taking the first rather than
 * joining is what a duplicated `?version=1&version=2` should mean here: one of them
 * is the filter, and concatenating them would build a value the API can only reject.
 */
function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
