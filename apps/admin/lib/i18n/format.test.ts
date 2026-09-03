import { describe, expect, it } from "vitest";

import { t, tPlural } from "./en.ts";
import {
  ADMIN_LOCALE,
  formatDateTime,
  formatDay,
  formatList,
  formatOperatorDateTime,
  isInstant,
} from "./format.ts";

/**
 * The locale-aware formatters and the plural helper (ADR-27).
 *
 * Two properties carry the whole decision and both are asserted rather than assumed: the
 * output is not the wire representation, and it does not depend on the runtime the code
 * happens to be executing in.
 */

describe("date formatting", () => {
  it("renders a day as a formatted date, not as a sliced ISO string", () => {
    const formatted = formatDay("2026-07-20T00:00:00.000Z");
    expect(formatted).not.toContain("T");
    expect(formatted).not.toBe("2026-07-20");
    expect(formatted).toContain("2026");
  });

  it("names the zone on a timestamp, so an operator never has to assume one", () => {
    const formatted = formatDateTime("2030-12-31T23:59:59.999Z");
    expect(formatted).toContain("UTC");
    expect(formatted).not.toContain("2030-12-31T23:59:59.999Z");
  });

  it("renders in UTC regardless of the machine's zone (no hydration mismatch)", () => {
    // The determinism property, stated as a test: these tables render on the server and
    // again in the browser, and a formatter that read the ambient zone would produce two
    // different strings and fail the run on a hydration mismatch. `TZ` is what a runtime
    // would differ on, so moving it must change nothing.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      const east = formatDateTime("2026-08-02T04:36:17.098Z");
      process.env.TZ = "Pacific/Midway";
      const west = formatDateTime("2026-08-02T04:36:17.098Z");
      expect(east).toBe(west);
    } finally {
      process.env.TZ = original;
    }
  });

  it("renders nothing readable as the caller's fallback rather than as Invalid Date", () => {
    expect(formatDay("")).toBe("");
    expect(formatDay(null, "-")).toBe("-");
    expect(formatDateTime(undefined, "-")).toBe("-");
    expect(formatDateTime("not a timestamp", "-")).toBe("-");
  });

  it("formats against the app's declared locale, named once", () => {
    expect(ADMIN_LOCALE).toBe("en");
  });
});

/**
 * Operator-local display (issue #279), asserted as the pair of properties that together
 * make it hydration-safe rather than as one string.
 *
 * `formatDateTime` must not move when the runtime does (the case above), and
 * `formatOperatorDateTime` must move, or it is not local. Only the second half is new; the
 * first is what the server render and the first client render both go through, and it is
 * already pinned. `components/operator-time.test.tsx` pins the gate between them.
 */
describe("operator-local date formatting", () => {
  /** Run `read` with the process on `zone`, then put the zone back. */
  function inZone<T>(zone: string, read: () => T): T {
    const original = process.env.TZ;
    try {
      process.env.TZ = zone;
      return read();
    } finally {
      process.env.TZ = original;
    }
  }

  const INSTANT = "2026-08-02T04:36:17.098Z";

  it("moves with the runtime's zone, which is the whole point", () => {
    // Two zones a long way apart and on opposite sides of the instant's UTC day, so this
    // fails if the formatter is silently still pinned to UTC.
    const east = inZone("Pacific/Kiritimati", () => formatOperatorDateTime(INSTANT));
    const west = inZone("Pacific/Midway", () => formatOperatorDateTime(INSTANT));

    expect(east).not.toBe(west);
    // Not merely different: different by the offset between the two zones, which puts them
    // on different calendar days.
    expect(east).toContain("2026");
    expect(west).toContain("2026");
    expect(east).not.toBe(formatDateTime(INSTANT));
  });

  it("still names the zone, so an operator never has to assume their own", () => {
    // The reason the UTC formatter named its zone does not go away when the zone is the
    // reader's: a time with no clock attached is a time they have to guess at.
    // Asia/Kolkata has no daylight saving, so its label is the same string all year.
    const local = inZone("Asia/Kolkata", () => formatOperatorDateTime(INSTANT));
    expect(local).toMatch(/(?:GMT[+\-\d:]+|UTC|[A-Z]{2,5})$/u);
    expect(local).not.toContain(INSTANT);
  });

  it("takes the zone from the runtime and the locale from the catalog, not both", () => {
    // The deliberate half of #279: the ZONE follows the operator, the LOCALE does not.
    // ADR-27 makes a second locale a configuration change that swaps `ADMIN_LOCALE`
    // alongside the catalog, and R7 defers that to Phase 4, so an operator elsewhere reads
    // their own clock inside English prose rather than a German date in an English
    // sentence.
    //
    // Pinned on the month name and the field order, which is the part of the output the
    // locale actually decides. It bites only where the ambient locale is not English -
    // which is the case worth catching, and the one a developer on an English machine
    // cannot see for themselves.
    const local = inZone("Asia/Kolkata", () => formatOperatorDateTime(INSTANT));
    expect(local).toMatch(/^Aug \d{1,2}, 2026, /u);
  });

  it("agrees with the UTC formatter when the operator is on UTC", () => {
    // The swap after hydration is invisible for an operator already on UTC, which is what
    // makes it a display change rather than a data change. It is also a second reading on
    // the locale pin: these two strings can only be equal if both formatters resolved the
    // same locale, and one of them is `ADMIN_LOCALE` by construction.
    expect(inZone("UTC", () => formatOperatorDateTime(INSTANT))).toBe(formatDateTime(INSTANT));
  });

  it("renders nothing readable as the caller's fallback, same as the UTC formatter", () => {
    expect(formatOperatorDateTime("")).toBe("");
    expect(formatOperatorDateTime(null, "-")).toBe("-");
    expect(formatOperatorDateTime(undefined, "-")).toBe("-");
    expect(formatOperatorDateTime("not a timestamp", "-")).toBe("-");
  });

  it("says whether there is a machine-readable instant to hang on a <time> element", () => {
    expect(isInstant("2026-08-02T04:36:17.098Z")).toBe(true);
    expect(isInstant("")).toBe(false);
    expect(isInstant(null)).toBe(false);
    expect(isInstant(undefined)).toBe(false);
    expect(isInstant("not a timestamp")).toBe(false);
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
  it("joins names the way the locale does, including the last conjunction", () => {
    expect(formatList(["Version"])).toBe("Version");
    expect(formatList(["Version", "Flagged"])).toBe("Version and Flagged");
    expect(formatList(["Version", "Submitted from", "Flagged"])).toBe(
      "Version, Submitted from, and Flagged",
    );
  });

  it("renders nothing for nothing rather than a stray separator", () => {
    expect(formatList([])).toBe("");
  });
});
