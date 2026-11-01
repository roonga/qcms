import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { FormIntake } from "@/components/ops/form-intake";
import { shownEnvironment } from "@/lib/environment";
import { t, type MessageKey } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { resolvedEnvironment } from "@/lib/server/environments";
import { getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { setFormStatusAction } from "../../../../forms/actions";

/** The browser-tab title for this route (issue #536): the section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("intake", formId));
}

/**
 * One form's intake in the selected environment: what is serving there, whether it is
 * taking responses, and the two acts that change that (Code Owner, 2026-11-02).
 *
 * THE SCREEN EXISTS BECAUSE THE ACTS HAD NOWHERE ELSE TO GO. Close and reopen were the
 * builder's, next to the way into the publish wizard, and the ruling that moved every
 * per-form operational screen under Operations takes them with it: the closed state is per
 * (form, environment), and the editor's draft belongs to no environment. The rail beside
 * this screen calls it Intake rather than Overview, which is what it reports on.
 *
 * It states the reading and nothing more. What is released here, and whether intake is
 * open, closed or not yet released, are the same three readings the Operations table's own
 * columns give, so a reader arriving from that row finds the row's words again rather than
 * a second vocabulary.
 */
export default async function FormIntakePage({
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
      <FormPageHeader formId={form.formId} section="intake" status={form.status} />
      <p className="text-sm text-(--color-text-muted)">
        {t("environment.inThis", { environment })}
      </p>
      <dl className="flex flex-col gap-2 text-sm" data-testid="qcms-form-intake-state">
        <div className="flex gap-2">
          <dt className="text-(--color-text-muted)">{t("operations.column.released")}</dt>
          <dd>{released === null ? t("operations.release.none") : released}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-(--color-text-muted)">{t("operations.column.intake")}</dt>
          <dd data-testid="qcms-form-intake-reading">
            {t(intakeReading(form.status, released))}
          </dd>
        </div>
      </dl>
      <FormIntake
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

/** The table's three readings, so this screen and that row say the same word. */
function intakeReading(status: "open" | "closed", released: number | null): MessageKey {
  if (released === null) return "operations.intake.unreleased";
  return status === "closed" ? "operations.intake.closed" : "operations.intake.open";
}
