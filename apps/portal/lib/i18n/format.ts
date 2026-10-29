import { isoDateLocale } from "@roonga/qcms-ui/native-submit";

export const DEFAULT_LOCALE = "en-GB";

/** Where and how to format: the deployment's locale and the zone to read a time in. */
export interface FormatContext {
  readonly locale: string;
  readonly timeZone: string;
}

const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * A day and a time, with the zone named. No seconds: the receipt answers "when did this
 * go in", not "in which second", and the value a respondent quotes back is the content
 * hash beside it.
 */
function dayAndTime({ locale, timeZone }: FormatContext): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}`;
  let format = cache.get(key);
  if (format === undefined) {
    // Gregorian calendar and Latin digits, as the date field draws (`isoDateLocale`).
    format = new Intl.DateTimeFormat(isoDateLocale(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });
    cache.set(key, format);
  }
  return format;
}

function instant(iso: string | null | undefined): Date | undefined {
  if (iso === null || iso === undefined || iso.trim() === "") return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Whether a value is an instant this module can render, for a `<time dateTime>`. */
export function isInstant(iso: string | null | undefined): iso is string {
  return instant(iso) !== undefined;
}

/**
 * An instant as a respondent reads it: a date, a time, and the clock it is on.
 *
 * Anything unreadable renders as `fallback` rather than as `Invalid Date`. The default is
 * the empty string, so a definition list shows an empty value instead of an alarming one
 * on a page whose whole job is to say the submission worked.
 */
export function formatDateTime(
  iso: string | null | undefined,
  context: FormatContext,
  fallback = "",
): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : dayAndTime(context).format(parsed);
}
