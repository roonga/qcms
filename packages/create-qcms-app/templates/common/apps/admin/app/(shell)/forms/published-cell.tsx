"use client";

import { useOperatorDayFormat } from "@/components/operator-time";
import type { FormListItem } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

export function PublishedCell({ form }: { readonly form: FormListItem }) {
  // Use UTC for server and first client render to avoid a hydration mismatch; use the operator's zone
  // afterwards.
  const formatDay = useOperatorDayFormat();
  if (form.latestVersion === null) return <>{t("forms.version.none")}</>;
  if (form.publishedAt === null) {
    return <>{t("forms.version.value", { version: form.latestVersion })}</>;
  }
  return (
    <>
      {t("forms.version.valueAt", {
        version: form.latestVersion,
        date: formatDay(form.publishedAt),
      })}
    </>
  );
}
