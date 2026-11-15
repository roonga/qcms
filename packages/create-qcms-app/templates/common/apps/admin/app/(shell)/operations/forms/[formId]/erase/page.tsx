import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { KnownTargetErasure } from "@/components/ops/known-target-erasure";
import { shownEnvironment } from "@/lib/environment";
import { t } from "@/lib/i18n/en";
import { mayEraseResponses } from "@/lib/ops/erasure";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { secureCookies } from "@/lib/server/config";
import { resolvedEnvironment } from "@/lib/server/environments";
import { getForm } from "@/lib/server/forms";
import { formCellsHeld } from "@/lib/server/operations";
import { requireAdminSession } from "@/lib/server/session";

import { erasureLookupAction, eraseSessionAction } from "../../../../responses/actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("erase", formId));
}

/**
 * The known-target erasure of one form's sessions in the selected environment, for a
 * holder of that form's erase cell. The cell decides only what is drawn; the API refuses
 * the lookup and the act to anyone else.
 */
export default async function FormErasePage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [form, resolved] = await Promise.all([
    getForm(session, formId),
    resolvedEnvironment(session),
  ]);
  // An eraser holds no `form: read`, so only a form that does not exist ends the screen.
  if (!form.ok && (form.code === "FORM_NOT_FOUND" || form.code === "INVALID_FORM_ID")) notFound();
  const shown = shownEnvironment(resolved);
  const environment = shown ?? t("environment.unknown");
  const erasable =
    shown !== undefined && mayEraseResponses(await formCellsHeld(session, formId, shown));
  const header = { formId, section: "erase" } as const;

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader {...(form.ok ? { ...header, form: form.data } : header)} />
      {erasable ? (
        <>
          <p className="text-sm text-(--color-text-muted)">
            {t("ops.erase.known.intro", { environment })}
          </p>
          <KnownTargetErasure
            key={shown}
            environment={environment}
            lookup={erasureLookupAction.bind(null, formId, shown)}
            erase={eraseSessionAction.bind(null, formId, shown)}
            secureCookies={secureCookies()}
          />
        </>
      ) : (
        <Alert variant="info">{t("ops.erase.known.denied", { environment })}</Alert>
      )}
    </div>
  );
}
