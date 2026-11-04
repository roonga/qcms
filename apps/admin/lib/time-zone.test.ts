import { describe, expect, it } from "vitest";

import { endOfDayIn, isTimeZone, startOfDayIn } from "./time-zone.ts";

function wall(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(iso));
}

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

  it("reads the day on the named clock, east and west of UTC, at both extremes", () => {
    expect(startOfDayIn("2026-07-01", "Australia/Sydney")).toBe("2026-06-30T14:00:00.000Z");
    expect(endOfDayIn("2026-07-01", "Australia/Sydney")).toBe("2026-07-01T13:59:59.999Z");
    expect(startOfDayIn("2026-07-01", "America/Los_Angeles")).toBe("2026-07-01T07:00:00.000Z");
    expect(endOfDayIn("2026-07-01", "America/Los_Angeles")).toBe("2026-07-02T06:59:59.999Z");

    expect(startOfDayIn("2026-07-01", "Pacific/Kiritimati")).toBe("2026-06-30T10:00:00.000Z");
    expect(startOfDayIn("2026-07-01", "Pacific/Pago_Pago")).toBe("2026-07-01T11:00:00.000Z");
  });

  it("starts a day whose midnight is skipped at the first instant that day exists", () => {
    const start = startOfDayIn("2026-09-06", "America/Santiago");
    expect(start).toBe("2026-09-06T04:00:00.000Z");
    expect(wall(start, "America/Santiago")).toBe("06/09/2026, 01:00:00");

    const end = endOfDayIn("2026-09-05", "America/Santiago");
    expect(end).toBe("2026-09-06T03:59:59.999Z");
    expect(wall(end, "America/Santiago")).toBe("05/09/2026, 23:59:59");
  });

  it("keeps a repeated midnight in the day it first reads as", () => {
    expect(startOfDayIn("2026-11-01", "America/Havana")).toBe("2026-11-01T04:00:00.000Z");
    expect(endOfDayIn("2026-10-31", "America/Havana")).toBe("2026-11-01T03:59:59.999Z");

    expect(endOfDayIn("2026-11-01", "America/Havana")).toBe("2026-11-02T04:59:59.999Z");
  });

  it("gives a 25-hour day when the clock falls back at midnight", () => {
    expect(startOfDayIn("2026-04-04", "America/Santiago")).toBe("2026-04-04T03:00:00.000Z");
    expect(endOfDayIn("2026-04-04", "America/Santiago")).toBe("2026-04-05T03:59:59.999Z");
    expect(startOfDayIn("2026-04-05", "America/Santiago")).toBe("2026-04-05T04:00:00.000Z");
  });

  it("handles the days daylight saving makes 23 and 25 hours long in Europe", () => {
    expect(startOfDayIn("2026-03-29", "Europe/London")).toBe("2026-03-29T00:00:00.000Z");
    expect(endOfDayIn("2026-03-29", "Europe/London")).toBe("2026-03-29T22:59:59.999Z");
    expect(startOfDayIn("2026-10-25", "Europe/London")).toBe("2026-10-24T23:00:00.000Z");
    expect(endOfDayIn("2026-10-25", "Europe/London")).toBe("2026-10-25T23:59:59.999Z");
  });

  it("treats a date the zone skipped entirely as an empty day, without looping", () => {
    expect(startOfDayIn("2011-12-30", "Pacific/Apia")).toBe("2011-12-30T10:00:00.000Z");
    expect(startOfDayIn("2011-12-31", "Pacific/Apia")).toBe("2011-12-30T10:00:00.000Z");
    expect(endOfDayIn("2011-12-29", "Pacific/Apia")).toBe("2011-12-30T09:59:59.999Z");
  });

  it("keeps a year below 100 as that year rather than 19xx", () => {
    expect(startOfDayIn("0099-07-01", "UTC")).toBe("0099-07-01T00:00:00.000Z");
    expect(endOfDayIn("0099-07-01", "UTC")).toBe("0099-07-01T23:59:59.999Z");
    expect(startOfDayIn("0001-01-01", "UTC")).toBe("0001-01-01T00:00:00.000Z");
    expect(endOfDayIn("9999-12-31", "UTC")).toBe("9999-12-31T23:59:59.999Z");

    expect(startOfDayIn("0000-01-01", "UTC")).toBe("0000-01-01");
  });

  it("is exact in a zone whose historical offset is further east than +15", () => {
    const juneau = startOfDayIn("1860-01-01", "America/Juneau");
    expect(wall(juneau, "America/Juneau")).toBe("01/01/1860, 00:00:00");
    expect(endOfDayIn("1860-01-01", "America/Juneau")).toBe(
      new Date(Date.parse(startOfDayIn("1860-01-02", "America/Juneau")) - 1).toISOString(),
    );
    const metlakatla = startOfDayIn("1866-06-15", "America/Metlakatla");
    expect(wall(metlakatla, "America/Metlakatla")).toBe("15/06/1866, 00:00:00");

    expect(wall(startOfDayIn("1868-01-01", "America/Juneau"), "America/Juneau")).toBe(
      "01/01/1868, 00:00:00",
    );
  });

  it("passes a value that is not day-shaped through untouched", () => {
    expect(startOfDayIn("2026-07-01T12:00:00.000Z", "UTC")).toBe("2026-07-01T12:00:00.000Z");
    expect(endOfDayIn("nonsense", "Australia/Sydney")).toBe("nonsense");
  });
});
