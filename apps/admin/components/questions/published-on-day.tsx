"use client";

import { useOperatorDayFormat } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";

/**
 * "Published {date}" for a question version row, with the day on the operator's own clock
 * (Code Owner, 2026-10-19).
 *
 * A client island inside the server-rendered rail, for the reason `forms/published-cell.tsx`
 * gives: the day sits inside a catalog sentence, so it needs the hook rather than the
 * `<OperatorDay>` element, and the hook needs the browser.
 */
export function PublishedOnDay({ iso }: { readonly iso: string }) {
  const formatDay = useOperatorDayFormat();
  return <>{t("questions.detail.publishedAt", { date: formatDay(iso) })}</>;
}
