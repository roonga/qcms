/**
 * Locale-aware value formatting for the admin (ADR-27; operator locale and zones by the
 * Code Owner ruling of 2026-10-19).
 *
 * ADR-27 puts dates, numbers and currency through the platform `Intl` APIs rather than
 * through hand-cut strings, for the same reason it puts prose through a catalog: a
 * different convention must be a configuration change, not a rewrite.
 *
 * ## Both inputs are ARGUMENTS, and nothing here reads the runtime
 *
 * **The locale is the operator's (`QCMS_LOCALE`).** This app used to format against the
 * bare tag `en`, which `Intl` reads as United States conventions (`Oct 17, 2026`, a
 * 12-hour clock, month-first date fields). The ruling gives the operator one setting,
 * default {@link DEFAULT_LOCALE}, read on the server by `lib/server/config.ts` and handed
 * to client components by `components/locale-context.tsx`. It is formatting, not
 * translation: the catalog stays English (R7).
 *
 * **The zone is the reader's, named in every time.** The ruling's other half: an admin
 * time is shown on the operator's own clock everywhere, list and detail alike, with the
 * zone in the output. The browser is the only party that knows that clock, so
 * `components/operator-time.tsx` resolves it there and passes it in; the server never
 * formats an instant at all (see that module for why, and for how hydration stays
 * clean). Before the ruling the server render used pinned UTC and the browser swapped
 * to the local zone after hydration, so one screen could show a submission on Oct 17
 * and the next on Oct 18; a UTC string is now never painted for an admin time.
 *
 * Because every formatter takes both inputs explicitly, the output depends on nothing
 * but its arguments: not on the host's locale or zone, and not on which side of
 * hydration it runs. The formatter caches are keyed on the pair for the same reason.
 *
 * What did not change: storage and the values on the wire are UTC instants.
 */

import { isoDateLocale } from "@roonga/qcms-ui/native-submit";

/** The locale used when `QCMS_LOCALE` is unset (Code Owner ruling 2026-10-19). */
export const DEFAULT_LOCALE = "en-GB";

/** Where and how to format: the deployment's locale and the zone to read an instant in. */
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
    // Gregorian calendar and Latin digits, whatever the tag's default: every instant is an
    // ISO value, and the date pickers draw the same way (`isoDateLocale`). The order, month
    // names, separators and hour cycle stay the operator's.
    format = new Intl.DateTimeFormat(isoDateLocale(locale), {
      ...(kind === "day" ? DAY_OPTIONS : DAY_AND_TIME_OPTIONS),
      timeZone,
    });
    dateFormats.set(key, format);
  }
  return format;
}

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

/**
 * Whether a value is an instant this module can render at all.
 *
 * Exported so a caller can decide whether it has something machine-readable to put in a
 * `<time dateTime>` attribute, which is a different question from what the text says.
 */
export function isInstant(iso: string | null | undefined): iso is string {
  return instant(iso) !== undefined;
}

/**
 * A calendar day, for a column where the time of day carries no meaning.
 *
 * The day is the one the instant falls on IN `context.timeZone`: 23:30 UTC is already
 * tomorrow in Sydney, so the zone decides which day is named even though no clock is
 * printed (Code Owner, 2026-09-11, issue #582).
 */
export function formatDay(
  iso: string | null | undefined,
  context: FormatContext,
  fallback = "",
): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : dateFormat("day", context).format(parsed);
}

/**
 * A day and a time, with the zone named (`timeZoneName: "short"`), for anything an
 * operator has to act on. No seconds: a table answers "when", and the detail route
 * answers "in which second" where that matters (`plan/admin-design-contracts.md` §2).
 */
export function formatDateTime(
  iso: string | null | undefined,
  context: FormatContext,
  fallback = "",
): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : dateFormat("dayAndTime", context).format(parsed);
}

/**
 * {@link formatDateTime} fixed to the default locale and UTC, as a value rather than a call.
 *
 * For unit callers only: two helpers take the operator's formatter as a parameter (the
 * hook lives in the component that calls them) and default to this so a test can call
 * them with a row alone. No screen renders through it.
 */
export function formatUtcDateTimeForTests(iso: string | null | undefined, fallback = ""): string {
  return formatDateTime(iso, { locale: DEFAULT_LOCALE, timeZone: "UTC" }, fallback);
}

const listFormats = new Map<string, Intl.ListFormat>();

/**
 * Join names into a sentence's list ("a", "a and b", "a, b and c").
 *
 * A list separator and the word before the last item are locale shape, not punctuation,
 * and hand-joining with `", "` bakes one convention into a template. `Intl` knows the
 * rule, and the locale is its one input, so the output is deterministic.
 */
export function formatList(items: readonly string[], locale: string): string {
  let format = listFormats.get(locale);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    listFormats.set(locale, format);
  }
  return format.format(items);
}
