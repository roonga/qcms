"use client";

import { useSyncExternalStore } from "react";

import { useAppLocale } from "@/components/locale-context";
import { formatDateTime, isInstant } from "@/lib/i18n/format";

const noSubscription = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverZone = () => "UTC";

export function useRespondentZone(): string {
  return useSyncExternalStore(noSubscription, browserZone, serverZone);
}

export function LocalDateTime({
  iso,
  fallback = "",
}: {
  readonly iso: string | null | undefined;
  readonly fallback?: string;
}) {
  const locale = useAppLocale();
  const timeZone = useRespondentZone();
  const text = formatDateTime(iso, { locale, timeZone }, fallback);
  if (!isInstant(iso)) return <>{text}</>;
  return <time dateTime={iso}>{text}</time>;
}
