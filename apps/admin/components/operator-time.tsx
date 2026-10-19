"use client";

import { useSyncExternalStore } from "react";

import { useAppLocale } from "@/components/locale-context";
import { formatDateTime, formatDay, isInstant } from "@/lib/i18n/format";

/**
 * Operator-local times, the only way an admin screen shows an instant (issue #279;
 * rebuilt by the Code Owner ruling of 2026-10-19, local UX list A9).
 *
 * ## What the ruling asked for
 *
 * Admin times on the operator's own clock **everywhere, list and detail alike**, with
 * the zone always named, formatted in the deployment's `QCMS_LOCALE`. What prompted it:
 * one submission read as Oct 17 on the responses list and Oct 18 on its detail page.
 *
 * ## The choice: the zone is resolved in the browser, and the server paints no time
 *
 * The server cannot know the operator's zone. The old design rendered pinned UTC on the
 * server and through hydration, then swapped to the browser's zone in an effect, so
 * every time on every screen was briefly (or, wherever the swap had not happened yet,
 * persistently) a UTC time - which is exactly how two screens could name two days for
 * one instant. Two alternatives were weighed:
 *
 * - **Pass the zone explicitly from the server**, from a cookie the browser writes. The
 *   first visit would still have no cookie and paint UTC, a new cookie needs a place in
 *   the cookie inventory, and the value would be a browser-supplied string the server
 *   renders. More moving parts for the same answer.
 * - **Render times client-side** (this). The admin has no no-JS requirement (Code Owner,
 *   2026-08-22 and 2026-09-27), so a time that only exists once scripting runs costs
 *   nothing a supported operator can see except a blank for the length of hydration.
 *
 * So there is one zone in this app, the browser's, and a time is either that or not yet
 * drawn. A UTC string is never painted, and no two screens can disagree.
 *
 * ## Why there is no hydration mismatch, stated exactly
 *
 * `useSyncExternalStore` returns its SERVER snapshot (`null`: "zone unknown") during the
 * server render and during hydration's first pass, so the HTML React compares is the
 * same placeholder on both sides; the browser snapshot (the resolved zone) is read on
 * the render after. A component mounted later by client navigation reads the browser
 * snapshot immediately and never shows the placeholder. The zone and the locale are then
 * passed to formatters that read nothing from the runtime, so the output depends only on
 * those two named inputs (`lib/i18n/format.ts`).
 *
 * ## What the markup carries
 *
 * `<time dateTime={iso}>` keeps the machine-readable UTC instant in the DOM whatever the
 * text says. An unreadable value renders the caller's fallback with no `<time>` around
 * it, on both sides of hydration, because "there is no such instant" does not depend on
 * the zone.
 */

const noSubscription = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const unknownZone = () => null;

/**
 * The operator's zone, or `null` during the server render and hydration's first pass.
 *
 * Exported for the few places that NAME the zone rather than format with it: the day
 * filters' hint and the link-expiry hint, which say which clock a chosen day is read on.
 */
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

/**
 * The date-time formatter for this render: the operator's zone, named, in the deployment
 * locale; an empty string for a readable instant until the zone is known.
 *
 * A hook rather than only a component, because some callers put the result inside a
 * catalog sentence (`t("...", { time })`) and there is no element to hang a component on.
 */
export function useOperatorDateTimeFormat(): InstantFormatter {
  return useOperatorFormatter(formatDateTime);
}

/** The calendar-day twin: the day the instant falls on in the operator's zone. */
export function useOperatorDayFormat(): InstantFormatter {
  return useOperatorFormatter(formatDay);
}

/**
 * One operator-facing timestamp. The fallback is the caller's, because "there is no such
 * instant" reads differently per screen ("None", "-", a blank cell) and that is copy.
 */
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

/**
 * One operator-facing calendar day. No clock and no zone name in the text, but the day
 * itself is the operator's (Code Owner, 2026-09-11, issue #582).
 */
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
