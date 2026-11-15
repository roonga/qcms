import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { VersionView } from "@/components/forms/version-view";
import { t } from "@/lib/i18n/en";
import { VERSION_HEADING_ID } from "@/lib/page-headings";
import { pageMetadata } from "@/lib/page-title";
import { previewPortalTheme } from "@/lib/server/config";
import { getForm, getFormVersion } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string; version: string }>;
}): Promise<Metadata> {
  const { formId, version } = await params;
  return pageMetadata(
    t("title.formSection", { section: t("forms.history.versionHeading", { version }), formId }),
  );
}

/* Render the immutable stored compiled documents; recompiling or using draft preview would change
   historical evidence. */
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

  const form = detail.data;
  // The version heading uses route params so it remains knowable when the snapshot read fails.
  const chrome = (
    <>
      <FormPageHeader
        formId={form.formId}
        section="versions"
        form={form}
        heading={{
          id: VERSION_HEADING_ID,
          text: t("forms.history.versionHeading", { version: requested }),
        }}
      />
      <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(form.formId)}/versions`}>
        {t("forms.history.backToHistory")}
      </Link>
    </>
  );

  if (!snapshot.ok) {
    if (snapshot.code === "VERSION_NOT_FOUND") notFound();
    return (
      <div className="flex flex-col gap-6">
        {chrome}
        <Alert variant="error">{t("forms.history.failed", { message: snapshot.message })}</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {chrome}
      <VersionView snapshot={snapshot.data} defaultTheme={previewPortalTheme()} />
    </div>
  );
}
