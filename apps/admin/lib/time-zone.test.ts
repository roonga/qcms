import { describe, expect, it } from "vitest";

import { endOfDayIn, isTimeZone, startOfDayIn } from "./time-zone.ts";

/**
 * Whole days in a named zone (Code Owner ruling 2026-10-19): the arithmetic the response
 * filters, the export range and a link's expiry share, so a chosen day is read on the
 * same clock the rows are shown on.
 */
describe("isTimeZone", () => {
  it("knows real IANA zones and refuses anything else", () => {
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Australia/Sydney")).toBe(true);
    expect(isTimeZone("Not/AZone")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(undefined)).toBe(false);
  });
});

describe("startOfDayIn / endOfDayIn", () => {
  it("is the plain UTC widening in UTC", () => {
    expect(startOfDayIn("2026-07-01", "UTC")).toBe("2026-07-01T00:00:00.000Z");
    expect(endOfDayIn("2026-07-31", "UTC")).toBe("2026-07-31T23:59:59.999Z");
  });

  it("reads the day on the named clock, east and west of UTC", () => {
    // Sydney is UTC+10 in July: its 1 July starts at 14:00 UTC on 30 June.
    expect(startOfDayIn("2026-07-01", "Australia/Sydney")).toBe("2026-06-30T14:00:00.000Z");
    expect(endOfDayIn("2026-07-01", "Australia/Sydney")).toBe("2026-07-01T13:59:59.999Z");
    // Los Angeles is UTC-7 in July.
    expect(startOfDayIn("2026-07-01", "America/Los_Angeles")).toBe("2026-07-01T07:00:00.000Z");
    expect(endOfDayIn("2026-07-01", "America/Los_Angeles")).toBe("2026-07-02T06:59:59.999Z");
  });

  it("handles a day that daylight saving makes 23 or 25 hours long", () => {
    // London springs forward on 29 March 2026 and falls back on 25 October 2026.
    expect(startOfDayIn("2026-03-29", "Europe/London")).toBe("2026-03-29T00:00:00.000Z");
    expect(endOfDayIn("2026-03-29", "Europe/London")).toBe("2026-03-29T22:59:59.999Z");
    expect(startOfDayIn("2026-10-25", "Europe/London")).toBe("2026-10-24T23:00:00.000Z");
    expect(endOfDayIn("2026-10-25", "Europe/London")).toBe("2026-10-25T23:59:59.999Z");
  });

  it("passes a value that is not day-shaped through untouched", () => {
    expect(startOfDayIn("2026-07-01T12:00:00.000Z", "UTC")).toBe("2026-07-01T12:00:00.000Z");
    expect(endOfDayIn("nonsense", "Australia/Sydney")).toBe("nonsense");
  });
});
