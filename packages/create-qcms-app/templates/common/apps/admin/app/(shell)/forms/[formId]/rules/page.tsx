import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormPageHeader } from "@/components/forms/form-page-header";
import { FormProductionReview } from "@/components/forms/form-production-review";
import { readOnlyNotice } from "@/lib/forms/role-states";
import { resolvedEnvironment } from "@/lib/server/environments";
import { readMyAccess } from "@/lib/server/membership";
import { RulesScreen } from "@/components/forms/rules-screen";
import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { formVerdict } from "@/lib/server/form-verdict";
import { getForm, loadPinnableQuestions } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

import { previewConditionAction, saveDraftAction, validateDraftAction } from "../../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("rules", formId));
}

/* Rule issue links need the rules route and fragment; a builder-only fragment cannot focus an unmounted
   rule. */
export default async function FormRulesPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [detail, library] = await Promise.all([
    getForm(session, formId),
    loadPinnableQuestions(session, await currentWorkspaceId(session)),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;
  if (!form.canWriteDraft) {
    const [access, resolved] = await Promise.all([
      readMyAccess(session),
      resolvedEnvironment(session),
    ]);
    return (
      <FormProductionReview
        form={form}
        section="rules"
        environments={resolved.status === "known" ? resolved.environments : []}
        notice={readOnlyNotice(access.ok ? access.data : undefined, form.workspaceId)}
      />
    );
  }
  const verdict =
    form.draft === null ? undefined : await formVerdict(session, form.formId, form.draft);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} section="rules" form={form} />

      {!library.ok && (
        <Alert variant="warning">
          {t("forms.error.libraryFailed", { message: library.message })}
        </Alert>
      )}

      <RulesScreen
        detail={form}
        library={readState(library)}
        {...(verdict === undefined ? {} : { verdict })}
        saveDraft={saveDraftAction.bind(null, form.formId)}
        validateDraft={validateDraftAction.bind(null, form.formId)}
        previewCondition={previewConditionAction.bind(null, form.formId)}
      />
    </div>
  );
}
