import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { EnvironmentSummary, ReleaseHistory } from "@/components/forms/release-tables";
import { VersionHistory } from "@/components/forms/version-history";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { currentEnvironmentsByVersion, environmentsByVersion } from "@/lib/forms/releases";
import { resolvedEnvironment } from "@/lib/server/environments";
import { getForm, getFormVersion } from "@/lib/server/forms";
import { listReleases } from "@/lib/server/releases";
import { requireAdminSession } from "@/lib/server/session";

/** The browser-tab title for this route (issue #536): the section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("versions", formId));
}

/**
 * Versions: what exists, who published it, where it is serving, and how it got there
 * (task 034, ADR-18; includes task 065's release history).
 *
 * ## Why the two screens became one
 *
 * They answered adjacent halves of one question and neither was usable alone. "What
 * versions exist" without "which of them is serving" tells an author nothing about what a
 * respondent sees; "what is serving where" without the version identities makes them leave
 * the screen to find out what they are about to release. An operator deciding what to
 * publish read both, in sequence, every time.
 *
 * Three readings sit here, in the order the decision is made: what each environment is
 * serving now, the immutable versions with their publisher and **Available in**, and the
 * append-only release history. The act that changes any of them is the publish wizard's,
 * which is one entry rather than a dialog on this screen - releasing into several
 * destinations is one transaction and a screen-local dialog could not express it.
 *
 * ## Available in is current releases, not every destination reached
 *
 * Derived from the release history by `currentEnvironmentsByVersion`, so a version replaced
 * or rolled away from is available nowhere. The filter above the table still reads "has
 * reached", because hiding a version an environment once served would be a worse answer
 * than the unfiltered list.
 *
 * ## Why the definitions are loaded here
 *
 * The diff compares two **frozen definitions**, and the detail read carries only version
 * summaries. So each version's snapshot is read once, here, in parallel, and the
 * definitions are handed down for a purely client-side comparison. A version whose read
 * fails is simply absent from the diff's data rather than failing the screen: the table,
 * which is the audit record, is what this page is for.
 *
 * It never calls `POST /admin/forms/{id}/draft/preview`. History renders what was stored at
 * publish time, and a recompilation would be a different document than the one respondents
 * were served (ADR-18).
 */
export default async function FormVersionsPage({
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

  // Where each version has reached and what each environment is serving (ADR-40, task 065).
  // Read here rather than derived from the version rows, because a version row says when it
  // was frozen and nothing about whether a respondent ever saw it.
  const [history, resolved, snapshots] = await Promise.all([
    listReleases(session, form.formId),
    resolvedEnvironment(session),
    Promise.all(
      form.versions.map(async (version) => getFormVersion(session, form.formId, version.version)),
    ),
  ]);
  // An unknown environment set draws no summary rows rather than `prod` alone (A12): a
  // table built from a list nobody read would claim an installation shape.
  const environments = resolved.status === "known" ? resolved.environments : [];
  const releases = history.ok ? history.data : [];

  const definitionsByVersion: Record<string, unknown> = {};
  for (const snapshot of snapshots) {
    if (snapshot.ok) definitionsByVersion[String(snapshot.data.version)] = snapshot.data.definition;
  }

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} section="versions" status={form.status} />
      <p className="text-sm text-(--color-text-muted)">{t("forms.history.intro")}</p>
      {!history.ok && <Alert variant="error">{history.message}</Alert>}

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("forms.versions.summaryHeading")}</h2>
        <EnvironmentSummary releases={releases} environments={environments} />
        <div className="flex flex-wrap gap-2">
          {/* The one publish entry. A link rather than a dialog, because the
              wizard is three steps over an intent that must survive a reload and write
              nothing until its last press. */}
          <Link
            className="qcms-button-link"
            data-testid="qcms-publish-entry"
            href={`/forms/${encodeURIComponent(form.formId)}/publish`}
          >
            {t("forms.versions.publishEntry")}
          </Link>
        </div>
      </div>

      <VersionHistory
        formId={form.formId}
        versions={form.versions}
        definitionsByVersion={definitionsByVersion}
        releasedBy={environmentsByVersion(releases)}
        availableIn={currentEnvironmentsByVersion(releases)}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("forms.releases.historyHeading")}</h2>
        <ReleaseHistory releases={releases} />
      </div>
    </div>
  );
}
