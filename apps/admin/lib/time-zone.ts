/**
 * Calendar days in a named IANA time zone (Code Owner ruling 2026-10-19).
 *
 * The admin shows every instant on the operator's own clock, so a control that asks for a
 * DAY (the response filters and the export range) has to read that day on the same clock,
 * or the filter and the rows it filters describe different days. The zone is always passed
 * in by name and never read from the runtime, so the instant a day widens to depends on
 * the request rather than on the machine serving it.
 *
 * ## What "the start of a day" means when the clock jumps
 *
 * A day starts at the **first instant whose local date is that day**, and ends one
 * millisecond before the next day starts. That definition is the whole of the
 * disambiguation, and it covers the awkward cases without special-casing them:
 *
 * - **Midnight skipped** (a spring-forward AT midnight, such as America/Santiago on
 *   2026-09-06, where 00:00 becomes 01:00): the day starts at 01:00 local. Computing
 *   "local midnight minus the offset" instead lands an hour early, on 23:00 of the day
 *   before, which is the defect this module was rewritten for.
 * - **Midnight repeated** (a fall-back across midnight): the day starts at the first
 *   00:00, so the repeated hour belongs to the day it reads as the first time round.
 * - **23- and 25-hour days** fall out of "the next day's start, minus one millisecond".
 *
 * The first instant is found by a forward scan over the window the instant must lie in
 * (any zone's midnight is within 15 hours of UTC midnight) and then a binary search to the
 * millisecond, reading each candidate's local date through `Intl`. That is a few hundred
 * `formatToParts` calls at most, for a value computed once per request.
 *
 * ## Years
 *
 * A day is `YYYY-MM-DD` with a four-digit year, 0001 to 9999, which is what the response
 * filters' `dayFilter` accepts and what the API's `new Date(...)` parses back. Two-digit
 * years are not rewritten as 19xx: the arithmetic below never goes through `Date.UTC`'s
 * legacy two-digit-year rule, and {@link startOfDayIn} refuses a year outside the range
 * by returning the value untouched, which the callers' validation then reports.
 */

/** The shape a day picker emits. */
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` names a time zone this runtime knows. The empty string does not. */
export function isTimeZone(value: string | undefined): value is string {
  if (value === undefined || value.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** The local calendar date of `instantMs` in `timeZone`, as a sortable `YYYYMMDD` number. */
function localDateKey(instantMs: number, timeZone: string): number {
  let format = dateFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormats.set(timeZone, format);
  }
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(instantMs))) parts[part.type] = part.value;
  const year = Number(parts["year"]);
  // Before year 1 the proleptic Gregorian era is BC; nothing here is ever there, but it
  // must still sort before AD 1 rather than after it.
  const signedYear = parts["era"] === "BC" || parts["era"] === "B" ? 1 - year : year;
  return signedYear * 10_000 + Number(parts["month"]) * 100 + Number(parts["day"]);
}

/** UTC midnight of a calendar date, without `Date.UTC`'s two-digit-year rule. */
function utcMidnight(year: number, monthIndex: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

const HOUR = 3_600_000;
const STEP = 15 * 60_000;

/**
 * The first instant whose local date in `timeZone` is the given day or later. "Or later"
 * is what makes a date a zone skipped outright (Pacific/Apia's 2011-12-30) an empty day
 * that starts where the next one does, rather than a search that never ends.
 */
function firstInstantOf(year: number, monthIndex: number, day: number, timeZone: string): number {
  const midnight = utcMidnight(year, monthIndex, day);
  const target = year * 10_000 + (monthIndex + 1) * 100 + day;
  // The scan has to START on the previous day, so that the boundary it then searches for
  // is in front of it. Fifteen hours before UTC midnight is early enough for every offset
  // in use (-12 to +14), but a fixed window is not a property of the zone database: two
  // zones' pre-1867 local mean time was further east than that (America/Metlakatla at
  // +15:13:42, America/Juneau at +15:02:19), and there the scan used to begin already
  // inside the target day, so the search below settled on its own starting point rather
  // than on midnight - silently, and about two minutes out. Walking back until the local
  // date really is earlier establishes the precondition instead of asserting it, and costs
  // one extra formatter call on every zone and date where fifteen hours was already enough.
  let before = midnight - 15 * HOUR;
  while (localDateKey(before, timeZone) >= target) before -= HOUR;
  let after = before + STEP;
  while (localDateKey(after, timeZone) < target) {
    before = after;
    after += STEP;
  }
  while (after - before > 1) {
    const mid = before + Math.floor((after - before) / 2);
    if (localDateKey(mid, timeZone) < target) before = mid;
    else after = mid;
  }
  return after;
}

function parseDay(value: string): readonly [number, number, number] | undefined {
  const match = DAY_ONLY.exec(value);
  if (match === null) return undefined;
  const year = Number(match[1]);
  if (year < 1) return undefined;
  return [year, Number(match[2]) - 1, Number(match[3])];
}

/**
 * The first instant of a `YYYY-MM-DD` day in `timeZone`, as an ISO string. A value that is
 * not a day in range passes through untouched, so a caller can hand a raw parameter in.
 */
export function startOfDayIn(value: string, timeZone: string): string {
  const day = parseDay(value);
  if (day === undefined) return value;
  return new Date(firstInstantOf(day[0], day[1], day[2], timeZone)).toISOString();
}

/** The last millisecond of a `YYYY-MM-DD` day in `timeZone`: the next day's start, less one. */
export function endOfDayIn(value: string, timeZone: string): string {
  const day = parseDay(value);
  if (day === undefined) return value;
  // `setUTCFullYear` rolls day + 1 into the next month or year, so the 31st is handled.
  const next = new Date(utcMidnight(day[0], day[1], day[2] + 1));
  const start = firstInstantOf(
    next.getUTCFullYear(),
    next.getUTCMonth(),
    next.getUTCDate(),
    timeZone,
  );
  return new Date(start - 1).toISOString();
}
