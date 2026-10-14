import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { ReleasePanel } from "@/components/forms/release-panel";
import { PROD_ENVIRONMENT } from "@/lib/environment";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { listEnvironments, selectedEnvironment } from "@/lib/server/environments";
import { getForm } from "@/lib/server/forms";
import { listReleases } from "@/lib/server/releases";
import { requireAdminSession } from "@/lib/server/session";

import { releaseVersionAction } from "../../actions";

/** The browser-tab title for this route (issue #536): the section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("releases", formId));
}

/**
 * The release screen (ADR-40, task 065): what is released where, and the act that changes
 * it.
 *
 * ## Why this is a screen of its own
 *
 * Publishing and releasing are two acts. A version is published once, into `control`, and
 * is shared by every environment (ADR-18); what varies per environment is which version is
 * **released** there. The version history answers "what exists"; this screen answers "what
 * is serving, where, and who put it there" - which is the question an incident review asks
 * and the one `form_versions.published_at` cannot answer now that the two acts are
 * separate.
 *
 * ## Three reads, and why not fewer
 *
 * The form (for its identity line and its published versions), the release history, and the
 * live environment set. The history is the model: "released now" is derived from it rather
 * than read separately, because the newest row for a (form, environment) pair **is** what
 * is released there, and a second read would be a second answer that could disagree with
 * the table beside it.
 *
 * The environment set is the API's, read through the shell's own door, because the set is a
 * table and an operator may have created a third environment (ADR-40). A failed read leaves
 * `prod`, which every deployment has.
 *
 * ## What this screen does not do
 *
 * It does not copy anything, it does not revert anything, and it has no rollback action:
 * rolling back is releasing an earlier version, and that is the one release action here
 * (ADR-40). It also does not gate itself on a membership role, because the role and its
 * environment scope arrive with tasks 068 and 069; a check before they exist would be
 * inventing one.
 */
export default async function FormReleasesPage({
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

  const [history, set] = await Promise.all([
    listReleases(session, form.formId),
    listEnvironments(session),
  ]);
  const environments =
    set.ok && set.data.length > 0 ? set.data.map((option) => option.name) : [PROD_ENVIRONMENT];
  const environment = await selectedEnvironment(environments);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        slug={form.slug}
        section="releases"
        status={form.status}
      />
      <p className="text-sm text-(--color-text-muted)">{t("forms.releases.intro")}</p>
      {!history.ok && <Alert variant="error">{history.message}</Alert>}
      <ReleasePanel
        releases={history.ok ? history.data : []}
        versions={form.versions.map((version) => version.version)}
        environments={environments}
        selectedEnvironment={environment}
        release={releaseVersionAction.bind(null, form.formId)}
      />
    </div>
  );
}
