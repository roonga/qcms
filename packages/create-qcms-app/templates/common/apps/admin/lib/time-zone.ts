/** Resolve day boundaries in the explicit IANA zone, never the server clock. Use first local-date instants and next-day minus one millisecond to handle skipped or repeated midnights and short or long days. */

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  /** BC dates must sort before AD year one even though supported inputs start at year one. */
  const signedYear = parts["era"] === "BC" || parts["era"] === "B" ? 1 - year : year;
  return signedYear * 10_000 + Number(parts["month"]) * 100 + Number(parts["day"]);
}

function utcMidnight(year: number, monthIndex: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

const HOUR = 3_600_000;
const STEP = 15 * 60_000;

/** A skipped calendar day is empty and starts where the next date starts; the search must accept the target date or later. */
function firstInstantOf(year: number, monthIndex: number, day: number, timeZone: string): number {
  const midnight = utcMidnight(year, monthIndex, day);
  const target = year * 10_000 + (monthIndex + 1) * 100 + day;
  /** Walk back until the local date precedes the target: historical offsets can exceed the initial 15-hour window, so a fixed bound cannot establish the search precondition. */
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

export function startOfDayIn(value: string, timeZone: string): string {
  const day = parseDay(value);
  if (day === undefined) return value;
  return new Date(firstInstantOf(day[0], day[1], day[2], timeZone)).toISOString();
}

export function endOfDayIn(value: string, timeZone: string): string {
  const day = parseDay(value);
  if (day === undefined) return value;

  const next = new Date(utcMidnight(day[0], day[1], day[2] + 1));
  const start = firstInstantOf(
    next.getUTCFullYear(),
    next.getUTCMonth(),
    next.getUTCDate(),
    timeZone,
  );
  return new Date(start - 1).toISOString();
}
