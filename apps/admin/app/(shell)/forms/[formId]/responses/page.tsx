import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { ResponseBrowser } from "@/components/ops/response-browser";
import { formatList } from "@/lib/i18n/format";
import { t, tPlural } from "@/lib/i18n/en";
import { parseResponseQuery } from "@/lib/ops/response-filters";
import { readState } from "@/lib/read-state";
import { getForm } from "@/lib/server/forms";
import { listResponses } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

/**
 * One form's response browser (task 035; screen contract "browser toolbar / table").
 *
 * The filters live in the URL and the **server** applies them, by handing them
 * straight to the API's list route. That is what makes the paging honest: the count
 * and the page controls describe the filtered set the API computed, not a slice of it
 * this app filtered again afterwards.
 *
 * An erased session is absent here without this page doing anything about it: the API
 * reads a reporting view with a tombstone anti-join (023). There is deliberately no
 * "hide erased" logic in this app to get out of step with it.
 *
 * ## The filters are parsed once, and everything reads that parse
 *
 * The request, the toolbar's values, the page links and the choice of empty message all
 * come out of `parseResponseQuery`. They used to be derived separately, and separate
 * derivations drift: `?flagged=maybe` was too malformed to send yet still counted as an
 * applied filter, so this page told an operator "no response matches these filters"
 * about a filter it had silently discarded (issue 521). What did not parse is named on
 * screen instead.
 *
 * ## A failed read is not an empty result
 *
 * The list read reaches the browser as a `ReadState` (`lib/read-state.ts`, issue 543)
 * rather than as `ok ? data : an invented empty page`. That fallback made a failed read
 * indistinguishable from a form nobody has answered, so the screen printed "Nothing has
 * been submitted to this form yet." and "0 responses" directly under its own alert
 * saying the responses could not be loaded: an all-clear about data it never received,
 * which is the same untruth as the filter defect above, one read further out. Contract
 * section 3 in `plan/admin-design-contracts.md` settles it, and this is one of the sites
 * issue 572 lists. The component decides what a failure leaves standing; its own
 * docblock records that decision and the reason.
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

  const { applied, request, hasFilters, ignored, page } = parseResponseQuery(query);

  const [detail, responses] = await Promise.all([
    getForm(session, formId),
    listResponses(session, formId, { ...request, page }),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;

  const header = (
    <FormPageHeader
      formId={form.formId}
      slug={form.slug}
      section="responses"
      status={form.status}
    />
  );

  // A statement about the address bar, so it is true whether or not the list loaded.
  const ignoredNotice = ignored.length > 0 && (
    <Alert variant="warning">
      <span data-testid="qcms-responses-ignored-filters">
        {tPlural(
          "ops.responses.filter.ignored.one",
          "ops.responses.filter.ignored.other",
          ignored.length,
          { fields: formatList(ignored.map((field) => t(`ops.responses.filter.${field}`))) },
        )}
      </span>
    </Alert>
  );

  return (
    <div className="flex flex-col gap-6">
      {header}
      {!responses.ok && (
        <Alert variant="error">
          {t("ops.responses.listFailed", { message: responses.message })}
        </Alert>
      )}
      {ignoredNotice}
      <ResponseBrowser
        formId={form.formId}
        page={readState(responses)}
        versions={form.versions.map((version) => version.version).sort((a, b) => b - a)}
        filters={applied}
        hasFilters={hasFilters}
      />
    </div>
  );
}
