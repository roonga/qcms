import { describe, expect, it } from "vitest";

import { t, tPlural } from "./en.ts";
import { ADMIN_LOCALE, formatDateTime, formatDay } from "./format.ts";

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
