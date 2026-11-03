import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { DraftPreview } from "@/components/forms/draft-preview";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { previewPortalTheme } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { previewDraftAction } from "../../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("preview", formId));
}

/* Preview the stored draft: it is the same definition publishing would freeze. */
export default async function FormPreviewPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const detail = await getForm(session, formId);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;
  if (form.workflow?.enabled && !form.workflow.canEdit)
    redirect(`/forms/${encodeURIComponent(formId)}`);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} section="preview" status={form.status} />
      {form.draft === null ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.preview.noSteps")}</p>
      ) : (
        <DraftPreview
          draft={form.draft}
          preview={previewDraftAction.bind(null, form.formId)}
          defaultTheme={previewPortalTheme()}
        />
      )}
    </div>
  );
}
