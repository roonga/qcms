"use client";

import { useSyncExternalStore } from "react";

import { useAppLocale } from "@/components/locale-context";
import { formatDateTime, formatDay, isInstant } from "@/lib/i18n/format";

/* The server and first hydration pass share a zone-unknown placeholder; read the operator's zone only
   afterwards to avoid mismatch. */

const noSubscription = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const unknownZone = () => null;

export function useOperatorZone(): string | null {
  return useSyncExternalStore(noSubscription, browserZone, unknownZone);
}

type InstantFormatter = (iso: string | null | undefined, fallback?: string) => string;

function useOperatorFormatter(format: typeof formatDateTime | typeof formatDay): InstantFormatter {
  const locale = useAppLocale();
  const timeZone = useOperatorZone();
  return (iso, fallback = "") => {
    if (!isInstant(iso)) return fallback;
    return timeZone === null ? "" : format(iso, { locale, timeZone }, fallback);
  };
}

export function useOperatorDateTimeFormat(): InstantFormatter {
  return useOperatorFormatter(formatDateTime);
}

export function useOperatorDayFormat(): InstantFormatter {
  return useOperatorFormatter(formatDay);
}

export function OperatorDateTime({
  iso,
  fallback = "",
}: {
  readonly iso: string | null | undefined;
  readonly fallback?: string;
}) {
  const format = useOperatorDateTimeFormat();
  const text = format(iso, fallback);
  if (!isInstant(iso)) return <>{text}</>;
  return <time dateTime={iso}>{text}</time>;
}

export function OperatorDay({
  iso,
  fallback = "",
}: {
  readonly iso: string | null | undefined;
  readonly fallback?: string;
}) {
  const format = useOperatorDayFormat();
  const text = format(iso, fallback);
  if (!isInstant(iso)) return <>{text}</>;
  return <time dateTime={iso}>{text}</time>;
}
