/** Take locale and zone explicitly so formatting never depends on the host or hydration side. The browser resolves the operator zone before formatting instants. */

import { isoDateLocale } from "@roonga/qcms-ui/native-submit";

export const DEFAULT_LOCALE = "en-GB";

export interface FormatContext {
  readonly locale: string;
  readonly timeZone: string;
}

const DAY_OPTIONS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

const DAY_AND_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DAY_OPTIONS,
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
};

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(
  kind: "day" | "dayAndTime",
  { locale, timeZone }: FormatContext,
): Intl.DateTimeFormat {
  const key = `${kind}|${locale}|${timeZone}`;
  let format = dateFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(isoDateLocale(locale), {
      ...(kind === "day" ? DAY_OPTIONS : DAY_AND_TIME_OPTIONS),
      timeZone,
    });
    dateFormats.set(key, format);
  }
  return format;
}

function instant(iso: string | null | undefined): Date | undefined {
  if (iso === null || iso === undefined || iso.trim() === "") return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function isInstant(iso: string | null | undefined): iso is string {
  return instant(iso) !== undefined;
}

export function formatDay(
  iso: string | null | undefined,
  context: FormatContext,
  fallback = "",
): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : dateFormat("day", context).format(parsed);
}

export function formatDateTime(
  iso: string | null | undefined,
  context: FormatContext,
  fallback = "",
): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : dateFormat("dayAndTime", context).format(parsed);
}

export function formatUtcDateTimeForTests(iso: string | null | undefined, fallback = ""): string {
  return formatDateTime(iso, { locale: DEFAULT_LOCALE, timeZone: "UTC" }, fallback);
}

const listFormats = new Map<string, Intl.ListFormat>();

export function formatList(items: readonly string[], locale: string): string {
  let format = listFormats.get(locale);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    listFormats.set(locale, format);
  }
  return format.format(items);
}
