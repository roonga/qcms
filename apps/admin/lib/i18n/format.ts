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
 *
 * ## Operator-local display (issue #279)
 *
 * The Code Owner accepted UTC deliberately on 2026-08-02 and queued the local-display
 * follow-up, which is what {@link formatOperatorDateTime} is. It resolves both inputs from
 * the runtime, which is precisely what the determinism argument above forbids doing during
 * a server render - so it is **never called during one**. `components/operator-time.tsx`
 * owns that rule: the server render and the first client render both go through
 * {@link formatDateTime}, and the swap to this formatter happens in an effect afterwards.
 * Calling it anywhere else reintroduces the mismatch this module exists to avoid.
 *
 * What did *not* change: storage, the values on the wire, `endOfDay`'s UTC widening, and
 * the mint dialog's expiry promise (`forms.links.expiresAtHint`), which is a statement made
 * to a respondent in some other zone rather than a convenience for the operator reading it.
 *
 * {@link formatDay} also stays UTC. It renders a calendar day for a column where the time
 * of day carries no meaning, and moving a bare day across a zone boundary changes which day
 * is named without giving the reader anything to check it against - there is no clock in
 * the output to name the zone on. Issue #279 asks for the timestamps.
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
 * The same day and time as {@link formatDateTime}, in the **operator's** locale and zone.
 *
 * The zone is still named (`timeZoneName: "short"`), for the reason it always was: a time
 * without a clock attached is a time the reader has to guess at, and that stays true when
 * the clock is their own. An operator in Sydney now reads a link's expiry as the local
 * instant it actually dies at, rather than as a UTC time roughly ten hours behind the day
 * they picked.
 *
 * **This must not run during a server render.** See the module note above and
 * `components/operator-time.tsx`, which is the only thing that should call it.
 *
 * Both inputs are re-resolved on every call rather than captured once at module load. The
 * cache below keys on what the runtime resolved, so a changed ambient zone produces a new
 * formatter instead of a stale one - which is what makes the behaviour testable without a
 * browser, and costs one `resolvedOptions()` call per timestamp.
 */
export function formatOperatorDateTime(iso: string | null | undefined, fallback = ""): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : operatorDayAndTime().format(parsed);
}

let cachedOperatorFormat: Intl.DateTimeFormat | undefined;
let cachedOperatorKey: string | undefined;

function operatorDayAndTime(): Intl.DateTimeFormat {
  // No locale argument: the runtime resolves the operator's own, and `ADMIN_LOCALE` is
  // the fallback a runtime that resolves nothing usable lands on.
  const resolved = new Intl.DateTimeFormat(undefined, { timeZone: undefined }).resolvedOptions();
  const key = `${resolved.locale}|${resolved.timeZone}`;
  if (cachedOperatorKey !== key || cachedOperatorFormat === undefined) {
    cachedOperatorKey = key;
    cachedOperatorFormat = new Intl.DateTimeFormat([resolved.locale, ADMIN_LOCALE], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: resolved.timeZone,
      timeZoneName: "short",
    });
  }
  return cachedOperatorFormat;
}

/**
 * Join names into a sentence's list ("a", "a and b", "a, b and c").
 *
 * Same argument as the date formatters above, for the same reason: a list separator and
 * the word before the last item are locale shape, not punctuation, and hand-joining with
 * `", "` bakes English into a template a second locale would have to unpick. `Intl` knows
 * the rule, and `ADMIN_LOCALE` is the one input it gets, so the output is deterministic
 * between the server render and the browser.
 */
const LIST = new Intl.ListFormat(ADMIN_LOCALE, { style: "long", type: "conjunction" });

export function formatList(items: readonly string[]): string {
  return LIST.format(items);
}
