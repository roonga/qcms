import { cookies } from "next/headers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { FormProductionReview } from "@/components/forms/form-production-review";
import { FormActions } from "@/components/forms/form-actions";
import { CONCURRENT_NOTICE_COOKIE, isConcurrentNoticeDismissed } from "@/lib/builder-notice";
import { shownEnvironment } from "@/lib/environment";
import { FormBuilder } from "@/components/forms/form-builder";
import type { FormDetail } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { resolvedEnvironment } from "@/lib/server/environments";
import { getForm, loadPinnableQuestions } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { saveDraftAction, updateSettingsAction, validateDraftAction } from "../actions";

/* Bind formId from the route, not the payload. A library failure leaves the successfully loaded draft
   editable. */

/* The create endpoint accepts identity only; seed the title through the URL without overwriting a stored
   title. */
function seedTitle(detail: FormDetail, title: string): FormDetail {
  if (title === "" || detail.draft === null) return detail;
  if (Object.values(detail.draft.title).some((text) => text !== "")) return detail;
  return {
    ...detail,
    draft: { ...detail.draft, title: { [detail.defaultLocale]: title } },
  };
}

function firstValue(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? "";
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("builder", formId));
}

export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const query = await searchParams;

  const [detail, library, resolved] = await Promise.all([
    getForm(session, formId),
    loadPinnableQuestions(session),
    resolvedEnvironment(session),
  ]);
  const shown = shownEnvironment(resolved);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }

  const form = seedTitle(detail.data, firstValue(query["title"]).trim());
  if (form.workflow?.enabled && !form.workflow.canEdit) {
    return (
      <FormProductionReview
        form={form}
        environments={resolved.status === "known" ? resolved.environments : []}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!library.ok && (
        <Alert variant="warning">
          {t("forms.error.libraryFailed", { message: library.message })}
        </Alert>
      )}

      {/* Pass FormActions as a node so its bound server action stays outside the client builder. */}
      <FormBuilder
        detail={form}
        library={readState(library)}
        concurrentNoticeRead={isConcurrentNoticeDismissed(
          (await cookies()).get(CONCURRENT_NOTICE_COOKIE)?.value,
        )}
        formMeta={
          <p className="text-sm text-(--color-text-muted)">
            {form.formId} · {form.defaultLocale} · {t(`forms.status.${form.status}`)} ·{" "}
            {t(`forms.builder.draftSource.${form.draftSource}`)}
          </p>
        }
        formActions={
          <FormActions
            workflow={form.workflow}
            formId={form.formId}
            environment={shown ?? t("environment.unknown")}
          />
        }
        saveDraft={saveDraftAction.bind(null, form.formId)}
        validateDraft={validateDraftAction.bind(null, form.formId)}
        updateSettings={updateSettingsAction.bind(null, form.formId)}
        {...(agentAuthoringEnabled()
          ? {
              assist: {
                endpoint: `/forms/${encodeURIComponent(form.formId)}/assist`,
                canPropose: form.canWriteDraft,
              },
            }
          : {})}
      />
    </div>
  );
}
