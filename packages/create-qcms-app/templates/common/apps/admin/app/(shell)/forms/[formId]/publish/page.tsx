import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { publishChangesFor } from "@/components/forms/publish-changes";
import { HeldPublishPanel } from "@/components/forms/held-publish-panel";
import { PublishWizard } from "@/components/forms/publish-wizard";
import { builderFormName } from "@/lib/forms/build-access";
import { publishReturnHref } from "@/lib/forms/build-return";
import { heldPublishViews } from "@/lib/forms/held-publish";
import { canFreezeDraft, freezeSummary } from "@/lib/forms/publish";
import { changesSincePublish } from "@/lib/forms/assist-diff";
import type { DraftForm, FormDetail } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { secureCookies } from "@/lib/server/config";
import { getAgentChanges, getForm } from "@/lib/server/forms";
import { listHeldPublishes } from "@/lib/server/releases";
import { requireAdminSession } from "@/lib/server/session";
import { builderPath } from "@/lib/shell/modes";

import {
  confirmPublishAction,
  decideHeldPublishAction,
  lookupPublishResultAction,
  reviewReleaseAction,
} from "../../actions";

const PROD = "prod";

/* The stored draft is the one a request still bound to it would publish. */
function draftSubject(form: FormDetail, base: DraftForm | null | undefined): string {
  const questions = tPlural(
    "forms.publish.requests.questions.one",
    "forms.publish.requests.questions.other",
    freezeSummary(form.draft).pins,
  );
  const latest = Math.max(0, ...form.versions.map((version) => version.version));
  // A failed read of the last publish names no count rather than a wrong one.
  if (latest === 0 || base === undefined || form.draft === null) {
    return t("forms.publish.requests.subjectFirst", { form: builderFormName(form), questions });
  }
  return t("forms.publish.requests.subject", {
    form: builderFormName(form),
    questions,
    changes: tPlural(
      "forms.publish.requests.changes.one",
      "forms.publish.requests.changes.other",
      changesSincePublish(base, form.draft).length,
      { version: latest },
    ),
  });
}

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
  const [read, held] = await Promise.all([
    getAgentChanges(session, form.formId),
    listHeldPublishes(session, form.formId),
  ]);
  const changes = publishChangesFor(read, toBuilder);
  const views = held.ok
    ? heldPublishViews(held.data, {
        viewerId: session.userId,
        // Publish forms in the environment the request is decided in, which this read names.
        canApprove: form.workflow?.environment === PROD && form.workflow.canRelease,
        now: Date.now(),
      })
    : [];
  const subject = draftSubject(form, read.ok ? read.data.base : undefined);
  const summaries = Object.fromEntries(
    views.map((view) => [view.requestId, view.block === "changed" ? "" : subject]),
  );

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        section="publish"
        form={form}
        help={t("forms.publish.intro")}
      />
      <HeldPublishPanel
        views={views}
        summaries={summaries}
        environment={PROD}
        decide={decideHeldPublishAction.bind(null, form.formId)}
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
        {...(changes === undefined ? {} : { changes })}
      />
    </div>
  );
}
