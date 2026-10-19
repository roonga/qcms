/**
 * Calendar days in a named IANA time zone (Code Owner ruling 2026-10-19).
 *
 * The admin shows every instant on the operator's own clock, so a control that asks for a
 * DAY (the response filters, the export range, a secure link's expiry) has to read that
 * day on the same clock, or the filter and the rows it filters describe different days.
 * The zone is always passed in by name and never read from the runtime, so the instant a
 * day widens to depends on the request rather than on the machine serving it: the server
 * and a shared URL give the same answer.
 *
 * Pure `Intl` arithmetic, no dependency: the offset of a zone at an instant is read back
 * from `formatToParts`, which handles daylight saving and historical rules from the
 * runtime's own tz database.
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

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

/** How far `timeZone`'s wall clock is ahead of UTC at `instantMs`, in milliseconds. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  let format = offsetFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormats.set(timeZone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    parts["year"] ?? 1970,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    parts["hour"] ?? 0,
    parts["minute"] ?? 0,
    parts["second"] ?? 0,
  );
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant a wall-clock midnight falls on in `timeZone`. Two passes, because the
 * offset at the first guess can differ from the offset at the answer across a
 * daylight-saving change.
 */
function midnightIn(year: number, monthIndex: number, day: number, timeZone: string): number {
  const wall = Date.UTC(year, monthIndex, day);
  let guess = wall - zoneOffsetMs(wall, timeZone);
  guess = wall - zoneOffsetMs(guess, timeZone);
  return guess;
}

/**
 * The first instant of a `YYYY-MM-DD` day in `timeZone`, as an ISO string. A value that is
 * not day-shaped passes through untouched, so a caller can hand a raw parameter straight in.
 */
export function startOfDayIn(value: string, timeZone: string): string {
  const match = DAY_ONLY.exec(value);
  if (match === null) return value;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  return new Date(midnightIn(year, month, day, timeZone)).toISOString();
}

/** The last millisecond of a `YYYY-MM-DD` day in `timeZone`, as an ISO string. */
export function endOfDayIn(value: string, timeZone: string): string {
  const match = DAY_ONLY.exec(value);
  if (match === null) return value;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  return new Date(midnightIn(year, month, day + 1, timeZone) - 1).toISOString();
}
