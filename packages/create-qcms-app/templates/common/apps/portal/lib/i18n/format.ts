/**
 * Locale-aware value formatting for the portal (ADR-27, issue #729; operator locale by
 * the Code Owner ruling of 2026-10-19).
 *
 * ADR-27 puts dates, numbers and currency through the platform `Intl` APIs for the same
 * reason it puts prose through a catalog: a different convention must be a configuration
 * change, not a rewrite. This module is the portal's swap point. It is deliberately
 * small: it carries the cases the portal actually renders and nothing else.
 *
 * ## Whose locale: the operator's (`QCMS_LOCALE`), never the host's or the browser's
 *
 * The portal used to format against the bare tag `en`, which `Intl` and react-aria
 * both read as United States conventions. That was visible: the respondent's date field
 * drew day/month/year in the server render (a native input, in the browser's locale)
 * and month/day/year after hydration (react-aria on `en`). The 2026-10-19 ruling gives
 * the operator one setting, `QCMS_LOCALE` (default {@link DEFAULT_LOCALE}), read on the
 * server by `lib/server/config.ts` and handed to the client by `LocaleProvider`, so
 * every formatter here takes the locale as an ARGUMENT. Nothing here reads the runtime's
 * locale, which is what keeps the server render and the hydrated render byte-identical.
 *
 * It is formatting, not translation: the catalog (`en.ts`) stays English whatever the
 * tag says, because R7 defers a second catalog.
 *
 * ## Whose zone: the respondent's, named, and only once the browser can say
 *
 * The receipt's "Submitted" time is shown on the respondent's own clock, with the zone
 * named in the output (the ruling's other half). The server cannot know that clock, so
 * `components/local-time.tsx` renders UTC (named) on the server and for a respondent
 * without scripting, and swaps to the browser's zone after hydration. The zone is also
 * an argument here rather than something this module resolves, for the same
 * determinism reason as the locale.
 */

import { isoDateLocale } from "@roonga/qcms-ui/native-submit";

/** The locale used when `QCMS_LOCALE` is unset (Code Owner ruling 2026-10-19). */
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

/**
 * Read an API timestamp, or `undefined` when there is nothing readable to render.
 *
 * `lib/server/route-helpers.ts` already validates the receipt cookie's `submittedAt` with
 * `z.iso.datetime()`, so a hand-set cookie cannot put `Invalid Date` in front of a
 * respondent. This is the second half of the same defence.
 */
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
