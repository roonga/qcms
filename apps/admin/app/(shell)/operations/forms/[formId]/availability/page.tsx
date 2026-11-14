import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { FormAvailability } from "@/components/ops/form-availability";
import { shownEnvironment } from "@/lib/environment";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { resolvedEnvironment } from "@/lib/server/environments";
import { getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { setFormStatusAction } from "../../../../forms/actions";

/** The section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("availability", formId));
}

/**
 * One form's availability in the selected environment: what is serving there, whether it is
 * taking responses, and the two acts that change that. The three readings are the
 * Operations table's own, so a reader arriving from a row meets no second vocabulary.
 */
export default async function FormAvailabilityPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [detail, resolved] = await Promise.all([
    getForm(session, formId),
    // The request's one resolution (A12): the reading below and the act beside it name the
    // same environment the shell's switcher had selected.
    resolvedEnvironment(session),
  ]);
  const shown = shownEnvironment(resolved);
  const environment = shown ?? t("environment.unknown");

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;
  const released = form.workflow?.currentVersion ?? null;

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} section="availability" form={form} />
      <p className="text-sm text-(--color-text-muted)">
        {t("environment.inThis", { environment })}
      </p>
      <dl className="flex flex-col gap-2 text-sm" data-testid="qcms-form-availability-state">
        <div className="flex gap-2">
          <dt className="text-(--color-text-muted)">{t("operations.column.released")}</dt>
          <dd>{released === null ? t("operations.release.none") : released}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-(--color-text-muted)">{t("operations.column.intake")}</dt>
          <dd data-testid="qcms-form-availability-reading">
            {t(`operations.intake.${form.status}`)}
          </dd>
        </div>
      </dl>
      <FormAvailability
        slug={form.slug}
        status={form.status}
        environment={environment}
        // The environment this render showed travels with the act, so a tab another tab has
        // since switched is refused rather than obeyed (A1).
        setStatus={setFormStatusAction.bind(null, form.formId, shown)}
      />
    </div>
  );
}
