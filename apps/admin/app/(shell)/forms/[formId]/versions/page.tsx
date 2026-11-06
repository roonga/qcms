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

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("versions", formId));
}

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

  const [history, resolved, snapshots] = await Promise.all([
    listReleases(session, form.formId),
    resolvedEnvironment(session),
    Promise.all(
      form.versions.map(async (version) => getFormVersion(session, form.formId, version.version)),
    ),
  ]);
  // An unread environment set cannot justify a fabricated production-only summary.
  const environments = resolved.status === "known" ? resolved.environments : [];
  const releases = history.ok ? history.data : [];

  const definitionsByVersion: Record<string, unknown> = {};
  for (const snapshot of snapshots) {
    if (snapshot.ok) definitionsByVersion[String(snapshot.data.version)] = snapshot.data.definition;
  }

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        section="versions"
        status={form.status}
        help={t("forms.history.intro")}
      />
      {!history.ok && <Alert variant="error">{history.message}</Alert>}

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("forms.versions.summaryHeading")}</h2>
        <EnvironmentSummary releases={releases} environments={environments} />
        <div className="flex flex-wrap gap-2">
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
