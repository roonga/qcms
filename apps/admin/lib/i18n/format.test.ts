import { describe, expect, it } from "vitest";

import { t, tPlural } from "./en.ts";
import { DEFAULT_LOCALE, formatDateTime, formatDay, formatList, isInstant } from "./format.ts";

/**
 * The locale-aware formatters and the plural helper (ADR-27; operator locale and zones by
 * the Code Owner ruling of 2026-10-19).
 *
 * Every formatter takes the locale and the zone as arguments, so the properties asserted
 * are: the default is en-GB, a configured locale changes the convention, the zone decides
 * the day and is named in a time, the output is not the wire representation, and nothing
 * depends on the runtime the code happens to execute in.
 */

const UTC_DEFAULT = { locale: DEFAULT_LOCALE, timeZone: "UTC" } as const;

/** ICU spaces some separators with U+202F; normalise so literals read naturally. */
const plain = (value: string) => value.replace(/[\u202f\u00a0]/gu, " ");

describe("the default locale (QCMS_LOCALE unset)", () => {
  it("is en-GB rather than the bare `en` Intl reads as US conventions", () => {
    expect(DEFAULT_LOCALE).toBe("en-GB");
  });

  it("writes a day day-first, and a time on a 24-hour clock with the zone named", () => {
    expect(formatDay("2026-07-20T00:00:00.000Z", UTC_DEFAULT)).toBe("20 Jul 2026");
    expect(plain(formatDateTime("2030-12-31T23:45:59.999Z", UTC_DEFAULT))).toBe(
      "31 Dec 2030, 23:45 UTC",
    );
  });
});

describe("a configured locale (QCMS_LOCALE set)", () => {
  const iso = "2030-12-31T23:45:59.999Z";

  it("follows en-US: month-first on a 12-hour clock", () => {
    expect(formatDay(iso, { locale: "en-US", timeZone: "UTC" })).toBe("Dec 31, 2030");
    expect(plain(formatDateTime(iso, { locale: "en-US", timeZone: "UTC" }))).toBe(
      "Dec 31, 2030, 11:45 PM UTC",
    );
  });

  it("follows de-DE: day-first with German month abbreviations", () => {
    expect(formatDay(iso, { locale: "de-DE", timeZone: "UTC" })).toBe("31. Dez. 2030");
    expect(plain(formatDateTime(iso, { locale: "de-DE", timeZone: "UTC" }))).toBe(
      "31. Dez. 2030, 23:45 UTC",
    );
  });
});

describe("the zone", () => {
  /**
   * 23:30 UTC on 2 August: already the 3rd in Sydney (UTC+10/+11) and still the 2nd in
   * Los Angeles (UTC-7/-8) in either half of the year, so the day assertions bite.
   */
  const NEAR_MIDNIGHT_UTC = "2026-08-02T23:30:00.000Z";

  it("decides which calendar day is named, east and west of UTC", () => {
    expect(
      formatDay(NEAR_MIDNIGHT_UTC, { locale: DEFAULT_LOCALE, timeZone: "Australia/Sydney" }),
    ).toBe("3 Aug 2026");
    expect(
      formatDay(NEAR_MIDNIGHT_UTC, { locale: DEFAULT_LOCALE, timeZone: "America/Los_Angeles" }),
    ).toBe("2 Aug 2026");
  });

  it("is named in a time, whichever zone it is", () => {
    const local = plain(
      formatDateTime(NEAR_MIDNIGHT_UTC, { locale: DEFAULT_LOCALE, timeZone: "Asia/Kolkata" }),
    );
    expect(local).toMatch(/^3 Aug 2026, 05:00 (GMT\+5:30|IST)$/u);
  });

  it("does not depend on the machine's own zone (no hydration mismatch)", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      const east = formatDateTime("2026-08-02T04:36:17.098Z", UTC_DEFAULT);
      process.env.TZ = "Pacific/Midway";
      const west = formatDateTime("2026-08-02T04:36:17.098Z", UTC_DEFAULT);
      expect(east).toBe(west);
    } finally {
      // Deleted rather than assigned back as the string "undefined" (issue #903).
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("shape and fallbacks", () => {
  it("renders no seconds and no milliseconds (the precision clause, contracts section 2)", () => {
    const formatted = formatDateTime("2030-12-31T23:45:59.999Z", UTC_DEFAULT);
    expect(formatted).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(formatted).not.toContain("999");
  });

  it("is never the wire representation, whole or sliced", () => {
    expect(formatDay("2026-07-20T00:00:00.000Z", UTC_DEFAULT)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("renders nothing readable as the caller's fallback rather than as Invalid Date", () => {
    expect(formatDay("", UTC_DEFAULT)).toBe("");
    expect(formatDay(null, UTC_DEFAULT, "-")).toBe("-");
    expect(formatDateTime(undefined, UTC_DEFAULT, "-")).toBe("-");
    expect(formatDateTime("not a timestamp", UTC_DEFAULT, "-")).toBe("-");
    expect(isInstant("not a timestamp")).toBe(false);
    expect(isInstant("2026-07-20T00:00:00.000Z")).toBe(true);
  });
});

describe("grammatical number", () => {
  it("picks the singular for exactly one", () => {
    expect(tPlural("forms.publish.freezes.steps.one", "forms.publish.freezes.steps.other", 1)).toBe(
      "1 step",
    );
    expect(tPlural("forms.links.mintedTitle.one", "forms.links.mintedTitle.other", 1)).toBe(
      "1 link minted",
    );
  });

  it("picks the plural for none and for many", () => {
    expect(tPlural("forms.publish.freezes.steps.one", "forms.publish.freezes.steps.other", 0)).toBe(
      "0 steps",
    );
    expect(tPlural("forms.publish.freezes.rules.one", "forms.publish.freezes.rules.other", 4)).toBe(
      "4 rules",
    );
  });

  it("composes the freeze summary without a mismatched noun anywhere in it", () => {
    // The regression this pins: the summary used to be one sentence with three numbers
    // substituted into fixed plural nouns, so a one-step form read "Freezes 1 steps, 1
    // pinned questions, 1 rules." - on the first form an author ever publishes.
    const summary = t("forms.publish.freezes", {
      steps: tPlural("forms.publish.freezes.steps.one", "forms.publish.freezes.steps.other", 1),
      pins: tPlural("forms.publish.freezes.pins.one", "forms.publish.freezes.pins.other", 1),
      rules: tPlural("forms.publish.freezes.rules.one", "forms.publish.freezes.rules.other", 1),
    });
    expect(summary).toBe("Freezes 1 step, 1 pinned question, 1 rule.");
  });
});

describe("list formatting", () => {
  it("joins names the way the configured locale does, including the last conjunction", () => {
    expect(formatList(["Version"], DEFAULT_LOCALE)).toBe("Version");
    expect(formatList(["Version", "Flagged"], DEFAULT_LOCALE)).toBe("Version and Flagged");
    // en-GB writes no serial comma; en-US does.
    expect(formatList(["Version", "Submitted from", "Flagged"], DEFAULT_LOCALE)).toBe(
      "Version, Submitted from and Flagged",
    );
    expect(formatList(["Version", "Submitted from", "Flagged"], "en-US")).toBe(
      "Version, Submitted from, and Flagged",
    );
  });

  it("renders nothing for nothing rather than a stray separator", () => {
    expect(formatList([], DEFAULT_LOCALE)).toBe("");
  });
});

describe("the calendar and digits (explicit Gregorian policy)", () => {
  it("writes an ISO instant as its Gregorian date in Latin digits whatever the tag's default", () => {
    const iso = "1990-05-17T12:00:00.000Z";
    for (const locale of ["th-TH", "fa-IR", "zh-CN-u-ca-chinese", "en-US-u-ca-buddhist"]) {
      const text = formatDay(iso, { locale, timeZone: "UTC" });
      expect(text, locale).toContain("1990");
      expect(text, locale).toContain("17");
      expect(text, locale).not.toMatch(/2533|1369|[\u06F0-\u06F9\u0660-\u0669]/u);
    }
  });
});
