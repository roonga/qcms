import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { PublishWizard } from "@/components/forms/publish-wizard";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
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
 * Publish: the one entry that creates a version or releases one (issue #1197).
 *
 * ## Why this is a screen and not a dialog
 *
 * One confirmation can name several destinations, and each needs its own transition, intake
 * state, eligibility evidence and second-approver reading in front of the operator before
 * they press anything. That does not fit a dialog, and it should not: the act is
 * all-or-nothing across every destination, so the review of all of them is the thing being
 * confirmed.
 *
 * ## No environment is bound here, deliberately
 *
 * Every other act on a form carries the environment its screen showed, confirmed against
 * the switcher (A1), because the screen's own banner is the promise being kept. This screen
 * has no such promise to keep: the destinations are chosen in its own body, the review
 * reports exactly the ones this caller may release into, and the API authorises each one
 * again at commit. The Operations selector controls operational data, not where a draft is
 * released (the plan's "Versions and publishing flow").
 *
 * ## What is read here and what is not
 *
 * The form, for its published versions and whether a draft exists to publish. The review
 * itself is **not** read here: it is read by the wizard when a source is chosen, because a
 * review read on page load would be stale by the time a source was picked and would be a
 * review of a source nobody had chosen yet.
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
        review={reviewReleaseAction.bind(null, form.formId)}
        confirm={confirmPublishAction.bind(null, form.formId)}
        lookup={lookupPublishResultAction.bind(null, form.formId)}
      />
    </div>
  );
}
