import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { DraftPreview } from "@/components/forms/draft-preview";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { t } from "@/lib/i18n/en";
import { previewPortalTheme } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { previewDraftAction } from "../../actions";

/**
 * The live preview of a form's draft (task 034; screen contract "preview").
 *
 * A server component that loads the form and hands the draft to the pane. The action is
 * bound to **this route's** form id, exactly as the builder binds its four: the id comes
 * from the URL, so a client cannot aim a preview at another form whatever it puts in the
 * payload.
 *
 * The draft previewed is the stored one, which is also the one publish would freeze. The
 * builder autosaves, so walking from the builder to here shows the work that was just
 * done.
 */
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

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        slug={form.slug}
        section="preview"
        status={form.status}
      />
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
