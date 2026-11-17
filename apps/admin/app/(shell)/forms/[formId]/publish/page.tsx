import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import type { PublishChangesRead } from "@/components/forms/publish-changes";
import { PublishWizard } from "@/components/forms/publish-wizard";
import { publishReturnHref } from "@/lib/forms/build-return";
import { canFreezeDraft } from "@/lib/forms/publish";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { secureCookies } from "@/lib/server/config";
import { getAgentChanges, getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";
import { builderPath } from "@/lib/shell/modes";

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
  searchParams,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const query = (await searchParams) ?? {};
  const detail = await getForm(session, formId);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;
  const back = agentAuthoringEnabled()
    ? publishReturnHref(form.formId, query["returnTo"])
    : undefined;
  const toBuilder = back !== undefined && back === builderPath(form.formId);
  // The audit rows, never the draft's own mark, say whether the assistant changed it.
  const read = await getAgentChanges(session, form.formId);
  const changes: PublishChangesRead = read.ok
    ? {
        status: "read",
        base: read.data.base,
        draft: read.data.draft,
        steps: read.data.changes,
      }
    : { status: "unread" };
  const showChanges = toBuilder || (read.ok && read.data.agentAssisted);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        section="publish"
        form={form}
        help={t("forms.publish.intro")}
      />
      <PublishWizard
        formId={form.formId}
        versions={form.versions.map((version) => version.version)}
        // A seeded draft is only an unstored starting point; only an open draft can be frozen.
        hasDraft={form.draftSource === "open"}
        canPublishDraft={canFreezeDraft(form.workflow)}
        draft={form.draft}
        agentAssisted={read.ok && read.data.agentAssisted}
        review={reviewReleaseAction.bind(null, form.formId)}
        confirm={confirmPublishAction.bind(null, form.formId)}
        lookup={lookupPublishResultAction.bind(null, form.formId)}
        secureCookies={secureCookies()}
        {...(back === undefined ? {} : { returnTo: { href: back, toBuilder } })}
        {...(showChanges ? { changes } : {})}
      />
    </div>
  );
}
