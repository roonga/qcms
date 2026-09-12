import { describe, expect, it } from "vitest";

import { PORTAL_LOCALE, formatDateTime } from "./format";

/**
 * The portal's locale constant and its one formatter (ADR-27, issue #729).
 *
 * Three properties carry the whole change and each is asserted rather than assumed: the
 * output does not depend on the runtime the code happens to execute in, it is not the wire
 * representation, and it is byte-for-byte what a respondent already read before the
 * formatting moved out of `components/completion-view.tsx`.
 */

/**
 * The call this module replaced, kept executable.
 *
 * `completion-view.tsx` used to build the receipt line as
 * `new Date(submittedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle:
 * "short", timeZone: "UTC" })` with a literal ` UTC` appended in JSX beside it. Issue #729
 * moves where that lives; it is not licence to change what a respondent reads. Comparing
 * against the old expression rather than only against hand-written literals is what makes
 * "byte-identical" a claim the suite can fail on.
 */
function retiredRendering(iso: string): string {
  const formatted = new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return `${formatted} UTC`;
}

/**
 * Instants chosen to exercise the parts of the output that can move: a single-digit hour
 * and day, both noons and both midnights (where a 12-hour clock is least forgiving), a
 * two-digit everything, and a value carrying seconds and milliseconds the receipt must not
 * leak.
 */
const INSTANTS = [
  "2026-08-02T04:36:17.098Z",
  "2026-01-05T09:05:00.000Z",
  "2026-11-09T00:00:00.000Z",
  "2026-06-15T12:00:00.000Z",
  "2026-12-31T23:45:59.999Z",
  "2026-03-01T13:07:00.000Z",
] as const;

describe("receipt timestamp formatting", () => {
  it("renders exactly what the respondent read before the call site moved", () => {
    for (const iso of INSTANTS) {
      expect(formatDateTime(iso)).toBe(retiredRendering(iso));
    }
  });

  it("renders the pinned string for a pinned instant", () => {
    // The literal, so a reviewer can see the receipt without running anything, and so a
    // change of shape fails here even if someone changes `retiredRendering` to match.
    expect(formatDateTime("2026-08-02T04:36:17.098Z")).toBe("Aug 2, 2026, 4:36 AM UTC");
    expect(formatDateTime("2026-12-31T23:45:59.999Z")).toBe("Dec 31, 2026, 11:45 PM UTC");
  });

  it("names the zone itself rather than leaving it to a literal in the markup", () => {
    // The ` UTC` suffix used to be JSX beside the formatted value. It is inside the
    // formatter now, which is what lets a second locale place it: `Intl` knows where a
    // zone abbreviation goes in a sentence and a template literal does not.
    expect(formatDateTime("2026-08-02T04:36:17.098Z")).toContain("UTC");
    expect(formatDateTime("2026-08-02T04:36:17.098Z")).not.toContain("2026-08-02T04:36:17.098Z");
    // Not the wire representation, whole or sliced: no `YYYY-MM-DD` anywhere in it.
    expect(formatDateTime("2026-08-02T04:36:17.098Z")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("renders no seconds and no milliseconds", () => {
    // The receipt answers when the submission went in, not in which second; the value a
    // respondent quotes back is the content hash beside it. The instant below carries 59
    // seconds and 999 milliseconds, so a formatter that leaked either would say so.
    const formatted = formatDateTime("2026-12-31T23:45:59.999Z");
    expect(formatted).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(formatted).not.toContain("999");
  });

  it("renders in UTC regardless of the machine's zone (no hydration mismatch)", () => {
    // The determinism property, stated as a test: this screen is rendered on the server and
    // again in the browser, and a formatter that read the ambient zone would produce two
    // different strings and fail the run on a hydration mismatch. `TZ` is what two runtimes
    // differ on, so moving it must change nothing.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      const east = formatDateTime("2026-08-02T04:36:17.098Z");
      process.env.TZ = "Pacific/Midway";
      const west = formatDateTime("2026-08-02T04:36:17.098Z");
      expect(east).toBe(west);
      expect(east).toBe("Aug 2, 2026, 4:36 AM UTC");
    } finally {
      // Deleted rather than assigned: an unset `TZ` read back as `undefined` and written
      // back becomes the string "undefined", which ICU does not recognize, leaving the
      // process on a zone no machine is in (issue #903).
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("renders nothing readable as the caller's fallback rather than as Invalid Date", () => {
    // `lib/server/route-helpers.ts` validates the receipt cookie with `z.iso.datetime()`
    // so this cannot be reached from `/done` today. It is asserted anyway: the guarantee
    // belongs to the formatter, not to the one caller that happens to be guarded upstream.
    expect(formatDateTime("")).toBe("");
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined, "-")).toBe("-");
    expect(formatDateTime("not a timestamp", "-")).toBe("-");
    expect(formatDateTime("not a timestamp")).not.toContain("Invalid");
  });
});

describe("the portal's locale", () => {
  it("is the tag the catalog and the admin already use", () => {
    // `lib/i18n/en.ts` is the catalog, `apps/admin/lib/i18n/format.ts` exports `en` as
    // `ADMIN_LOCALE`, and the receipt used to say `en-US`. One tag across the product.
    expect(PORTAL_LOCALE).toBe("en");
  });

  it("resolves the same CLDR data the retired en-US tag did, for what the portal renders", () => {
    // `PORTAL_LOCALE` is now also what `components/step-flow.tsx` and
    // `components/native-step.tsx` hand `A2UIStepRenderer`, whose `locale` prop feeds
    // react-aria's `I18nProvider`. Those call sites used to pass nothing and inherit the
    // package's own `en-US` default, so dropping the region subtag has to be shown to be
    // output-neutral for the respondent-facing controls rather than merely tidier.
    //
    // The segment order is the one that matters most: `e2e/support/kitchen-sink.ts` types
    // a date into a segmented DateField key by key on the assumption that it is MM/DD/YYYY.
    const parts = (locale: string) =>
      new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" })
        .formatToParts(new Date("2026-05-17T00:00:00.000Z"))
        .map((part) => part.type)
        .join("/");
    expect(parts(PORTAL_LOCALE)).toBe(parts("en-US"));

    // The 12-hour clock the receipt renders on, and the grouping and decimal separators
    // react-aria uses for a number field.
    const hourCycle = (locale: string) =>
      new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    expect(hourCycle(PORTAL_LOCALE)).toBe(hourCycle("en-US"));
    expect((1234.5).toLocaleString(PORTAL_LOCALE)).toBe((1234.5).toLocaleString("en-US"));
  });
});
