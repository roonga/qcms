import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { VersionView } from "@/components/forms/version-view";
import { t } from "@/lib/i18n/en";
import { previewPortalTheme } from "@/lib/server/config";
import { getForm, getFormVersion } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

/**
 * One published version, rendered from its stored compiled documents (task 034, ADR-18).
 *
 * The only domain read this route makes is `GET /admin/forms/{id}/versions/{v}`, whose
 * `compiled` field is the JSONB frozen at publish time. Nothing here compiles, and the
 * draft-preview endpoint is not reachable from this page at all - which is the property
 * exit criterion 4 checks from the browser.
 */
export default async function FormVersionPage({
  params,
}: {
  readonly params: Promise<{ formId: string; version: string }>;
}) {
  const session = await requireAdminSession();
  const { formId, version } = await params;
  const requested = Number(version);
  if (!Number.isInteger(requested) || requested < 1) notFound();

  const [detail, snapshot] = await Promise.all([
    getForm(session, formId),
    getFormVersion(session, formId, requested),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  if (!snapshot.ok) {
    if (snapshot.code === "VERSION_NOT_FOUND") notFound();
    return (
      <Alert variant="error">{t("forms.history.failed", { message: snapshot.message })}</Alert>
    );
  }

  const form = detail.data;
  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        slug={form.slug}
        section="versions"
        status={form.status}
      />
      <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(form.formId)}/versions`}>
        {t("forms.history.backToHistory")}
      </Link>
      <VersionView snapshot={snapshot.data} defaultTheme={previewPortalTheme()} />
    </div>
  );
}
