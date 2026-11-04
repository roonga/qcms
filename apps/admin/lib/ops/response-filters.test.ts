import { describe, expect, it } from "vitest";

import { parseResponseQuery } from "./response-filters.ts";

describe("response filter parsing: flagged", () => {
  it("takes the API's two values", () => {
    for (const value of ["true", "false"] as const) {
      const parsed = parseResponseQuery({ flagged: value });
      expect(parsed.request.flagged).toBe(value);
      expect(parsed.applied.flagged).toBe(value);
      expect(parsed.hasFilters).toBe(true);
      expect(parsed.ignored).toEqual([]);
    }
  });

  it("does not count a value it refused to send as an applied filter", () => {
    const parsed = parseResponseQuery({ flagged: "maybe" });
    expect(parsed.request.flagged).toBeUndefined();
    expect(parsed.applied.flagged).toBe("");
    expect(parsed.hasFilters).toBe(false);
    expect(parsed.ignored).toEqual(["flagged"]);
  });

  it("refuses the near misses too", () => {
    for (const value of ["TRUE", "1", "yes", " true"]) {
      expect(parseResponseQuery({ flagged: value }).hasFilters).toBe(false);
    }
  });
});

describe("response filter parsing: dates", () => {
  it("widens a valid day to the whole UTC day", () => {
    const parsed = parseResponseQuery({ from: "2026-01-01", to: "2026-01-31" });
    expect(parsed.request.from).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.request.to).toBe("2026-01-31T23:59:59.999Z");
    expect(parsed.hasFilters).toBe(true);
    expect(parsed.ignored).toEqual([]);
  });

  it("never builds an instant out of a value that is not a day", () => {
    for (const value of ["xyz", "01/03/2026", "2026-1-1", "2026-13-01", ""]) {
      const parsed = parseResponseQuery({ from: value });
      expect(parsed.request.from, `from=${value}`).toBeUndefined();
      expect(parsed.applied.from).toBe("");
      expect(parsed.hasFilters).toBe(false);
    }

    expect(parseResponseQuery({ from: "xyz" }).ignored).toEqual(["from"]);
    expect(parseResponseQuery({ from: "" }).ignored).toEqual([]);
  });

  it("refuses a day that does not exist rather than rolling it forward", () => {
    const parsed = parseResponseQuery({ to: "2026-02-31" });
    expect(parsed.request.to).toBeUndefined();
    expect(parsed.ignored).toEqual(["to"]);
  });
});

describe("response filter parsing: version", () => {
  it("takes a positive integer and keeps its string form", () => {
    const parsed = parseResponseQuery({ version: "2" });
    expect(parsed.request.version).toBe("2");
    expect(parsed.hasFilters).toBe(true);
  });

  it("normalizes to the decimal form the toolbar and the page links use", () => {
    for (const value of ["0001", "01", "000000001"]) {
      const parsed = parseResponseQuery({ version: value });
      expect(parsed.request.version, `version=${value}`).toBe("1");
      expect(parsed.applied.version).toBe("1");
      expect(parsed.hasFilters).toBe(true);
      expect(parsed.ignored).toEqual([]);
    }
  });

  it("keeps a version that exists nowhere: matching nothing is a real answer", () => {
    expect(parseResponseQuery({ version: "9999" }).hasFilters).toBe(true);
    expect(parseResponseQuery({ version: "9999" }).ignored).toEqual([]);
  });

  it("drops what is not a version number in the form this app writes", () => {
    for (const value of ["abc", "0", "-1", "1.5", "2e3"]) {
      const parsed = parseResponseQuery({ version: value });
      expect(parsed.request.version, `version=${value}`).toBeUndefined();
      expect(parsed.hasFilters).toBe(false);
      expect(parsed.ignored).toEqual(["version"]);
    }
  });
});

describe("response filter parsing: the whole querystring", () => {
  it("keeps the valid half of a mixed set and reports only the rest", () => {
    const parsed = parseResponseQuery({ version: "3", from: "nope", flagged: "maybe" });
    expect(parsed.request).toEqual({ version: "3" });

    expect(parsed.applied).toEqual({ version: "3", from: "", to: "", flagged: "" });
    expect(parsed.hasFilters).toBe(true);
    expect(parsed.ignored).toEqual(["from", "flagged"]);
  });

  it("reports nothing and filters nothing for a bare URL", () => {
    const parsed = parseResponseQuery({});
    expect(parsed.request).toEqual({});
    expect(parsed.hasFilters).toBe(false);
    expect(parsed.ignored).toEqual([]);
    expect(parsed.page).toBe(1);
  });

  it("reads the first of a repeated parameter rather than joining them", () => {
    expect(parseResponseQuery({ version: ["1", "2"] }).request.version).toBe("1");
  });

  it("treats the page as a position, not a filter", () => {
    expect(parseResponseQuery({ page: "4" }).page).toBe(4);

    const parsed = parseResponseQuery({ page: "nonsense" });
    expect(parsed.page).toBe(1);
    expect(parsed.hasFilters).toBe(false);
    expect(parsed.ignored).toEqual([]);
    expect(parseResponseQuery({ page: "0" }).page).toBe(1);
    expect(parseResponseQuery({ page: "-3" }).page).toBe(1);
  });
});

describe("response filter parsing: the day's zone", () => {
  it("widens the days in the named zone", () => {
    const parsed = parseResponseQuery({
      from: "2026-07-01",
      to: "2026-07-01",
      tz: "Australia/Sydney",
    });
    expect(parsed.request.from).toBe("2026-06-30T14:00:00.000Z");
    expect(parsed.request.to).toBe("2026-07-01T13:59:59.999Z");
    expect(parsed.applied.tz).toBe("Australia/Sydney");
    expect(parsed.ignored).toEqual([]);
  });

  it("reads an absent or unknown zone as UTC, which is what older links meant", () => {
    for (const tz of [undefined, "", "Not/AZone"]) {
      const parsed = parseResponseQuery({
        from: "2026-07-01",
        ...(tz === undefined ? {} : { tz }),
      });
      expect(parsed.request.from).toBe("2026-07-01T00:00:00.000Z");
      expect(parsed.applied.tz).toBeUndefined();
    }
  });

  it("is not itself a filter: a zone alone filters nothing and is never reported", () => {
    const parsed = parseResponseQuery({ tz: "Australia/Sydney" });
    expect(parsed.hasFilters).toBe(false);
    expect(parsed.ignored).toEqual([]);
    expect(parseResponseQuery({ tz: "Not/AZone" }).ignored).toEqual([]);
  });
});

describe("response filter parsing: boundaries", () => {
  it("starts a day whose midnight daylight saving skips at the first instant it exists", () => {
    const parsed = parseResponseQuery({
      from: "2026-09-06",
      to: "2026-09-05",
      tz: "America/Santiago",
    });
    expect(parsed.request.from).toBe("2026-09-06T04:00:00.000Z");
    expect(parsed.request.to).toBe("2026-09-06T03:59:59.999Z");
  });

  it("keeps a year below 100 as that year, and refuses year 0", () => {
    expect(parseResponseQuery({ from: "0099-07-01" }).request.from).toBe(
      "0099-07-01T00:00:00.000Z",
    );
    const zero = parseResponseQuery({ from: "0000-01-01" });
    expect(zero.request.from).toBeUndefined();
    expect(zero.ignored).toEqual(["from"]);
  });
});
