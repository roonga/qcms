"use client";

import { useSyncExternalStore } from "react";

import { useAppLocale } from "@/components/locale-context";
import { formatDateTime, isInstant } from "@/lib/i18n/format";

/**
 * A timestamp on the respondent's own clock, zone named (Code Owner ruling 2026-10-19).
 *
 * ## Why UTC first, and why that is still honest
 *
 * The server cannot know the respondent's zone, and the portal must work without
 * scripting, so the server render (and the page a no-JS respondent keeps) shows the
 * instant in UTC with "UTC" in the text: a true statement about a named clock. Once the
 * page hydrates, the browser's zone is known and the text moves to it, still naming the
 * zone ("BST", "GMT+10"), so the respondent never has to guess which clock a time is on.
 *
 * ## Why there is no hydration mismatch
 *
 * `useSyncExternalStore` returns its SERVER snapshot (`UTC`) both during the server render
 * and during hydration's first pass, so the HTML React compares against is the same
 * string on both sides; the browser snapshot (the runtime's zone) is only read on the
 * render after. The locale is the deployment's (`useAppLocale`), never the browser's, so
 * the formatting convention does not move at the swap, only the clock.
 *
 * `<time dateTime>` keeps the machine-readable instant in the DOM whatever the text says.
 */
const noSubscription = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverZone = () => "UTC";

/** The zone to render in: UTC on the server and through hydration, the browser's after. */
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
