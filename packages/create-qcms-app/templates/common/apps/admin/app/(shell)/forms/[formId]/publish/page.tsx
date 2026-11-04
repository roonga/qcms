import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { PublishWizard } from "@/components/forms/publish-wizard";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { secureCookies } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import {
  confirmPublishAction,
  lookupPublishResultAction,
  reviewReleaseAction,
} from "../../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("publish", formId));
}

/* Release destinations come from the wizard's review, independently of the environment switcher; the API
   authorizes each at commit. */
export default async function FormPublishPage({
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
      <FormPageHeader formId={form.formId} section="publish" status={form.status} />
      <p className="text-sm text-(--color-text-muted)">{t("forms.publish.intro")}</p>
      <PublishWizard
        formId={form.formId}
        versions={form.versions.map((version) => version.version)}
        // A seeded draft is only an unstored starting point; only an open draft can be frozen.
        hasDraft={form.draftSource === "open"}
        canPublishDraft={form.workflow?.canPublish !== false}
        draft={form.draft}
        agentAssisted={form.draftAgentAssisted}
        review={reviewReleaseAction.bind(null, form.formId)}
        confirm={confirmPublishAction.bind(null, form.formId)}
        lookup={lookupPublishResultAction.bind(null, form.formId)}
        secureCookies={secureCookies()}
      />
    </div>
  );
}
