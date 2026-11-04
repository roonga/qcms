import { t } from "@/lib/i18n/en";
import { sectionHeadingId } from "@/lib/page-headings";
import type { FormSection } from "@/lib/page-title";

export function FormPageHeader({
  formId,
  section,
  status,
  heading,
}: {
  readonly formId: string;
  readonly section: FormSection;
  readonly status?: "open" | "closed";
  readonly heading?: { readonly id: string; readonly text: string };
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1
        id={heading?.id ?? sectionHeadingId(section)}
        tabIndex={heading === undefined ? undefined : -1}
        className="qcms-ops-title text-xl font-semibold text-(--color-text)"
      >
        {heading?.text ?? t(`forms.tab.${section}`)}
      </h1>
      {status !== undefined && (
        <p className="text-sm text-(--color-text-muted)">
          {t("forms.builder.formId")}: {formId} · {t("forms.builder.status")}:{" "}
          {t(`forms.status.${status}`)}
        </p>
      )}
    </div>
  );
}
