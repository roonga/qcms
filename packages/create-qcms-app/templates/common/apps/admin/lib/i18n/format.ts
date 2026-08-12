/**
 * Locale-aware value formatting for the admin (ADR-27).
 *
 * ADR-27 puts dates, numbers and currency through the platform `Intl` APIs rather than
 * through hand-cut strings, for the same reason it puts prose through a catalog: a second
 * locale must be a configuration change, not a rewrite. Three screens had been slicing an
 * ISO timestamp to its first ten characters instead, which is not a date format at all -
 * it is the wire representation with its tail cut off, and it reads as one.
 *
 * ## Two constraints pull in opposite directions, and both are satisfied here
 *
 * **Determinism.** These tables render inside client components, which Next also renders on
 * the server, so a formatter that resolved its locale or its time zone from the ambient
 * runtime would produce one string in Node and another in the browser: a hydration mismatch,
 * which the suite's shared console gate fails a run on. That is exactly what the `.slice(0,
 * 10)` in `forms/page.tsx` was avoiding, and its comment says so. So both inputs are
 * explicit: the app's locale, and UTC.
 *
 * **Truthfulness.** UTC is not a compromise here, it is the right answer for this app. The
 * API stores instants, a secure link's expiry is a promise made to a respondent who may be
 * anywhere, and an operator reading a link's lifetime needs one clock rather than their own.
 * So the zone is rendered alongside every time (`timeZoneName: "short"`) rather than left
 * for the reader to assume, and `endOfDay` in the forms actions widens a chosen day to the
 * end of that same UTC day, so what the mint dialog promises and what the table later shows
 * are the same instant.
 *
 * A second locale swaps `ADMIN_LOCALE` alongside the catalog module and every date follows;
 * nothing here needs to change.
 */

/**
 * The locale every formatter resolves against.
 *
 * One locale at launch (R7), named once. It is deliberately not read from the request or
 * from the browser: see the determinism argument above.
 */
export const ADMIN_LOCALE = "en";

/** The zone every timestamp is rendered in, named in the output so it is never assumed. */
const DISPLAY_TIME_ZONE = "UTC";

const DAY = new Intl.DateTimeFormat(ADMIN_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

const DAY_AND_TIME = new Intl.DateTimeFormat(ADMIN_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
  timeZoneName: "short",
});

/**
 * Read an API timestamp, or `undefined` when there is nothing to read.
 *
 * The proxies default a missing timestamp to `""` rather than dropping the row, so an
 * unreadable value has to survive as far as here and then render as nothing rather than as
 * `Invalid Date`.
 */
function instant(iso: string | null | undefined): Date | undefined {
  if (iso === null || iso === undefined || iso.trim() === "") return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** A calendar day, for a column where the time of day carries no meaning. */
export function formatDay(iso: string | null | undefined, fallback = ""): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : DAY.format(parsed);
}

/** A day and a time, with the zone named. For anything an operator has to act on. */
export function formatDateTime(iso: string | null | undefined, fallback = ""): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : DAY_AND_TIME.format(parsed);
}
