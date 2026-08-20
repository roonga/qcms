import { describe, expect, it } from "vitest";

import { parseResponseQuery } from "./response-filters.ts";

/**
 * The response browser's filter parsing (issue 521).
 *
 * Two promises are pinned here, and they are the same promise seen from two sides:
 *
 *  - **What is sent.** A value that does not parse never reaches the API. The old page
 *    concatenated `from` into an ISO instant without looking at it, so `?from=xyz`
 *    travelled as `xyzT00:00:00.000Z` and cost the operator the whole list behind a
 *    400. There is no browser assertion that can see the request string, so it is
 *    asserted here.
 *  - **What is claimed.** `hasFilters` decides between "nothing has been submitted" and
 *    "no response matches these filters", and it now reads off the same parse the
 *    request does. The browser suite asserts the sentences; this asserts the rule they
 *    are rendered from.
 *
 * The third case in each direction is the control: a VALID filter must still be a
 * filter. A fix that made `hasFilters` always false would satisfy the first two and
 * destroy the distinction the issue is about.
 */

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
    // The defect in issue 521: dropped from the request, kept in `hasFilters`, so the
    // page announced a filtered empty result for a filter it never applied.
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
    // Empty is absent, which is not a mistake to report; the rest are.
    expect(parseResponseQuery({ from: "xyz" }).ignored).toEqual(["from"]);
    expect(parseResponseQuery({ from: "" }).ignored).toEqual([]);
  });

  it("refuses a day that does not exist rather than rolling it forward", () => {
    // `new Date("2026-02-31T00:00:00.000Z")` is March 3rd, so a pattern check alone
    // would silently filter on a different day than the address named.
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

  it("keeps a version that exists nowhere: matching nothing is a real answer", () => {
    // The filtered empty state is TRUE for `?version=9999` on a form with one version.
    // Only a value that is not a version number at all is dropped.
    expect(parseResponseQuery({ version: "9999" }).hasFilters).toBe(true);
    expect(parseResponseQuery({ version: "9999" }).ignored).toEqual([]);
  });

  it("drops what the API would only reject", () => {
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
    // A page link carries what was applied, so a rejected value must not ride along.
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
    // An unreadable page is the first page, and it is not a filter, so it neither
    // changes the empty message nor gets reported as a dropped filter.
    const parsed = parseResponseQuery({ page: "nonsense" });
    expect(parsed.page).toBe(1);
    expect(parsed.hasFilters).toBe(false);
    expect(parsed.ignored).toEqual([]);
    expect(parseResponseQuery({ page: "0" }).page).toBe(1);
    expect(parseResponseQuery({ page: "-3" }).page).toBe(1);
  });
});
