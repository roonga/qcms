import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { ResponseBrowser } from "@/components/ops/response-browser";
import { formatList } from "@/lib/i18n/format";
import { t, tPlural } from "@/lib/i18n/en";
import { exportableVersions } from "@/lib/ops/export";
import { clampedPage } from "@/lib/ops/paging";
import { parseResponseQuery } from "@/lib/ops/response-filters";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { appLocale } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { listResponses } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("responses", formId));
}

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

  const [detail, firstRead] = await Promise.all([
    getForm(session, formId),
    listResponses(session, formId, { ...request, page }),
  ]);

  // The total is known only after the first read, so clamping a nonempty result may require a second read.
  const clamp = firstRead.ok
    ? clampedPage(page, firstRead.data.total, firstRead.data.pageSize)
    : undefined;
  const responses =
    clamp === undefined
      ? firstRead
      : await listResponses(session, formId, { ...request, page: clamp });

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    // Only a refusal passes: a response viewer's list is still theirs, while a read that
    // failed for any other reason knows nothing and must not be rendered as a narrower grant.
    if (detail.code !== "FORBIDDEN") return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.ok ? detail.data : undefined;

  const versions = exportableVersions(
    form === undefined
      ? undefined
      : form.versions.map((version) => version.version).sort((left, right) => right - left),
    responses.ok ? responses.data.formVersions : undefined,
  );

  const header = (
    <FormPageHeader
      formId={formId}
      section="responses"
      {...(form === undefined ? {} : { status: form.status })}
    />
  );

  const ignoredNotice = ignored.length > 0 && (
    <Alert variant="warning">
      <span data-testid="qcms-responses-ignored-filters">
        {tPlural(
          "ops.responses.filter.ignored.one",
          "ops.responses.filter.ignored.other",
          ignored.length,
          {
            fields: formatList(
              ignored.map((field) => t(`ops.responses.filter.${field}`)),
              appLocale(),
            ),
          },
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
        formId={formId}
        page={readState(responses)}
        versions={versions}
        filters={applied}
        hasFilters={hasFilters}
      />
    </div>
  );
}
