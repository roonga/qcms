import type { ReactNode } from "react";

import { HelpTip } from "@/components/help-tip";
import type { FormAvailability } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { sectionHeadingId } from "@/lib/page-headings";
import type { FormSection } from "@/lib/page-title";

export function FormPageHeader({
  formId,
  section,
  status,
  heading,
  help,
}: {
  readonly formId: string;
  readonly section: FormSection;
  readonly status?: FormAvailability;
  readonly heading?: { readonly id: string; readonly text: string };
  readonly help?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1
          id={heading?.id ?? sectionHeadingId(section)}
          tabIndex={heading === undefined ? undefined : -1}
          className="qcms-ops-title text-xl font-semibold text-(--color-text)"
        >
          {heading?.text ?? t(`forms.tab.${section}`)}
        </h1>
        {help === undefined ? null : <HelpTip>{help}</HelpTip>}
      </div>
      {status !== undefined && (
        <p className="text-sm text-(--color-text-muted)">
          {t("forms.builder.formId")}: {formId} · {t("forms.builder.status")}:{" "}
          {t(`forms.status.${status}`)}
        </p>
      )}
    </div>
  );
}
