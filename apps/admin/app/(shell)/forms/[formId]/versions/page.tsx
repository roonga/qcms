import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { VersionHistory } from "@/components/forms/version-history";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { getForm, getFormVersion } from "@/lib/server/forms";
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
 * The version history (task 034; screen contract "version history", ADR-18).
 *
 * ## Why the definitions are loaded here
 *
 * The diff compares two **frozen definitions**, and the detail read carries only version
 * summaries. So each version's snapshot is read once, here, in parallel, and the
 * definitions are handed down for a purely client-side comparison. A version whose read
 * fails is simply absent from the diff's data rather than failing the screen: the table,
 * which is the audit record, is what this page is for.
 *
 * ## What this page deliberately does not do
 *
 * It never calls `POST /admin/forms/{id}/draft/preview`. History renders what was stored at
 * publish time, and a recompilation would be a different document than the one respondents
 * were served (ADR-18). Exit criterion 4 asserts exactly that, at the network level.
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

  const snapshots = await Promise.all(
    form.versions.map(async (version) => getFormVersion(session, form.formId, version.version)),
  );
  const definitionsByVersion: Record<string, unknown> = {};
  for (const snapshot of snapshots) {
    if (snapshot.ok) definitionsByVersion[String(snapshot.data.version)] = snapshot.data.definition;
  }

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        slug={form.slug}
        section="versions"
        status={form.status}
      />
      <p className="text-sm text-(--color-text-muted)">{t("forms.history.intro")}</p>
      <VersionHistory
        formId={form.formId}
        versions={form.versions}
        definitionsByVersion={definitionsByVersion}
      />
    </div>
  );
}
