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

/** The browser-tab title for this route (issue #536): the section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("publish", formId));
}

/**
 * Publish: the one entry that creates a version or releases one.
 *
 * A screen rather than a dialog because one confirmation can name several destinations, and
 * each needs its own transition, intake state, eligibility evidence and second-approver
 * reading in front of the operator before they press anything.
 *
 * No environment is bound here, unlike every other act on a form, which carries the one its
 * screen showed and confirms it against the switcher (A1). This screen has no such promise
 * to keep: the destinations are chosen in its own body, the review reports exactly the ones
 * this caller may release into, and the API authorises each one again at commit.
 *
 * The review is deliberately not read here. The wizard reads it when a source is chosen,
 * because one read on page load would be a review of a source nobody had picked yet.
 */
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
        // A seeded draft is the newest published definition handed back as a starting
        // point and is not stored, so there is nothing to freeze: only `"open"` is a draft
        // this screen can publish.
        hasDraft={form.draftSource === "open"}
        canPublishDraft={form.workflow?.canPublish !== false}
        draft={form.draft}
        // Server-sourced, from the same `draftAgentAssisted` the builder reads: this is the
        // human's last look before freezing, so it says what the draft carries now.
        agentAssisted={form.draftAgentAssisted}
        review={reviewReleaseAction.bind(null, form.formId)}
        confirm={confirmPublishAction.bind(null, form.formId)}
        lookup={lookupPublishResultAction.bind(null, form.formId)}
        secureCookies={secureCookies()}
      />
    </div>
  );
}
