"use client";

import { useOperatorDayFormat } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";

export function PublishedOnDay({ iso }: { readonly iso: string }) {
  const formatDay = useOperatorDayFormat();
  return <>{t("questions.detail.publishedAt", { date: formatDay(iso) })}</>;
}
