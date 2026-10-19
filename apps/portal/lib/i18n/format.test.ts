import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, formatDateTime, isInstant } from "./format";

/**
 * The portal's formatter (ADR-27, issue #729; operator locale and respondent zone by the
 * Code Owner ruling of 2026-10-19).
 *
 * The properties asserted: the output depends only on the locale and zone it is handed
 * (never on the runtime it executes in), the default locale is en-GB, a configured locale
 * changes the convention, the zone is named, and nothing unreadable reaches a respondent.
 */

const UTC_DEFAULT = { locale: DEFAULT_LOCALE, timeZone: "UTC" } as const;

/**
 * Normalise the narrow no-break space ICU puts before AM/PM and a few other separators,
 * so a literal in a test reads the way a person writes it.
 */
const plain = (value: string) => value.replace(/[\u202f\u00a0]/gu, " ");

describe("the default locale (QCMS_LOCALE unset)", () => {
  it("is en-GB, not the bare `en` that Intl reads as United States conventions", () => {
    expect(DEFAULT_LOCALE).toBe("en-GB");
  });

  it("writes the receipt day-first on a 24-hour clock, zone named", () => {
    expect(plain(formatDateTime("2026-08-02T04:36:17.098Z", UTC_DEFAULT))).toBe(
      "2 Aug 2026, 04:36 UTC",
    );
    expect(plain(formatDateTime("2026-12-31T23:45:59.999Z", UTC_DEFAULT))).toBe(
      "31 Dec 2026, 23:45 UTC",
    );
  });
});

describe("a configured locale (QCMS_LOCALE set)", () => {
  it("follows the tag: en-US month-first, de-DE day-first with a 24-hour clock", () => {
    const iso = "2026-08-02T16:36:17.098Z";
    expect(plain(formatDateTime(iso, { locale: "en-US", timeZone: "UTC" }))).toBe(
      "Aug 2, 2026, 4:36 PM UTC",
    );
    expect(plain(formatDateTime(iso, { locale: "de-DE", timeZone: "UTC" }))).toBe(
      "2. Aug. 2026, 16:36 UTC",
    );
  });
});

describe("the respondent's zone", () => {
  it("reads the instant on the zone it is handed and names that zone", () => {
    const iso = "2026-08-02T23:30:00.000Z";
    const sydney = plain(
      formatDateTime(iso, { locale: DEFAULT_LOCALE, timeZone: "Australia/Sydney" }),
    );
    // 23:30 UTC on the 2nd is 09:30 on the 3rd in Sydney (AEST, UTC+10, in August).
    expect(sydney).toMatch(/^3 Aug 2026, 09:30 (AEST|GMT\+10)$/u);
    expect(sydney).not.toContain("UTC");
  });

  it("does not depend on the machine's own zone (no hydration mismatch)", () => {
    // The determinism property: the server and the browser hand the same arguments, so
    // moving the runtime's TZ must change nothing.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      const east = formatDateTime("2026-08-02T04:36:17.098Z", UTC_DEFAULT);
      process.env.TZ = "Pacific/Midway";
      const west = formatDateTime("2026-08-02T04:36:17.098Z", UTC_DEFAULT);
      expect(east).toBe(west);
    } finally {
      // Deleted rather than assigned: writing back `undefined` sets the string
      // "undefined", which ICU does not recognise (issue #903).
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("shape and fallbacks", () => {
  it("renders no seconds, no milliseconds and not the wire representation", () => {
    const formatted = formatDateTime("2026-12-31T23:45:59.999Z", UTC_DEFAULT);
    expect(formatted).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(formatted).not.toContain("999");
    expect(formatted).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("renders nothing readable as the caller's fallback rather than as Invalid Date", () => {
    expect(formatDateTime("", UTC_DEFAULT)).toBe("");
    expect(formatDateTime(null, UTC_DEFAULT)).toBe("");
    expect(formatDateTime(undefined, UTC_DEFAULT, "-")).toBe("-");
    expect(formatDateTime("not a timestamp", UTC_DEFAULT, "-")).toBe("-");
    expect(formatDateTime("not a timestamp", UTC_DEFAULT)).not.toContain("Invalid");
    expect(isInstant("not a timestamp")).toBe(false);
    expect(isInstant("2026-08-02T04:36:17.098Z")).toBe(true);
  });
});
