"use client";

import { useSyncExternalStore } from "react";

import { useAppLocale } from "@/components/locale-context";
import { formatDateTime, isInstant } from "@/lib/i18n/format";

/**
 * A timestamp on the respondent's own clock, with the zone named.
 *
 * UTC first, because the server cannot know the respondent's zone and the portal must
 * work without scripting; the text names whichever zone it is showing, so the respondent
 * never has to guess which clock a time is on.
 *
 * `useSyncExternalStore` returns its server snapshot both during the server render and
 * during hydration's first pass, so no hydration mismatch is possible: the browser's zone
 * is read only on the render after. The locale stays the deployment's, so the formatting
 * convention does not move at the swap, only the clock.
 */
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
