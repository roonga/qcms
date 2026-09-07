import { describe, expect, it } from "vitest";

import { APPEARANCE_ROUTE } from "../appearance.js";
import { DEFAULT_RETURN, parseAppearanceChoice, safeReturnPath } from "./appearance-form.js";

/**
 * The two respondent-supplied strings the no-JS appearance route trusts nothing about
 * (issue #195): the posted values, and the page to redirect back to.
 *
 * `e2e/no-js-appearance.pw.ts` proves the feature works in a browser with scripting
 * off. It cannot prove these, because the shapes that matter here are the ones no
 * browser sends from the portal's own markup: a hand-built POST naming a font the
 * deployment curated away, and a return target pointing at another origin. A redirect
 * is the one response where reflecting input verbatim is a real vulnerability rather
 * than a cosmetic one, so the interesting cases are all hostile and all written here.
 *
 * `PORTAL_BASE` is only ever the base the `Referer` leg is compared against. The
 * `returnTo` leg deliberately never sees it: `safeReturnPath` resolves a candidate
 * against a synthetic origin, so its answers do not depend on configuration at all,
 * and that property is asserted below rather than assumed.
 */

const PORTAL_BASE = "https://forms.qcms.test";

/** The fonts a deployment offers. Narrower than the registry, which is the point. */
const OFFERED = ["system", "atkinson", "lexend"];

/** A form the portal's own markup would produce. */
function submission(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

describe("the posted values are the enumerated ones or nothing", () => {
  it("accepts one submission of the three axes the form carries", () => {
    expect(
      parseAppearanceChoice(
        submission({ mode: "hc", font: "atkinson", density: "compact" }),
        OFFERED,
      ),
    ).toEqual({ mode: "hc", font: "atkinson", density: "compact" });
  });

  it.each(["light", "dark", "hc"])("accepts the mode keyword %s", (mode) => {
    expect(parseAppearanceChoice(submission({ mode }), OFFERED).mode).toBe(mode);
  });

  it.each(["compact", "comfortable", "spacious"])("accepts the density level %s", (density) => {
    expect(parseAppearanceChoice(submission({ density }), OFFERED).density).toBe(density);
  });

  // The whole submission is refused rather than the offending axis, because the only
  // thing that produces this form is the portal's own markup and it always posts all
  // three: anything else was hand-built, and honouring the half of it that happened to
  // parse would be applying a request nobody made.
  it.each([
    ["a mode that is not a keyword", { mode: "neon", font: "atkinson", density: "compact" }],
    ["`auto`, which is config and never a rendered mode", { mode: "auto" }],
    ["a density that is not a level", { density: "cosy" }],
    ["a capitalised keyword", { mode: "HC" }],
    ["an empty value", { mode: "" }],
    ["a value carrying a cookie attribute", { mode: "hc; Domain=evil.test" }],
    ["a value carrying a header break", { font: "atkinson\nSet-Cookie: x=y" }],
  ])("writes nothing for %s", (_name, fields) => {
    expect(parseAppearanceChoice(submission(fields), OFFERED)).toEqual({});
  });

  // Which faces EXIST is the `@roonga/qcms-ui` registry; which of them a deployment
  // offers is `QCMS_PORTAL_FONTS`. Validating against the registry would let a
  // respondent pin a face their deployment curated away, and the control could not
  // switch back from it - the same reasoning `resolveAppearance` applies on the way in.
  it("refuses a real registry key the deployment does not offer", () => {
    expect(parseAppearanceChoice(submission({ font: "opendyslexic" }), OFFERED)).toEqual({});
    expect(parseAppearanceChoice(submission({ font: "opendyslexic" }), OFFERED).font).toBeUndefined();
  });

  it("refuses every font when the deployment offers none, rather than accepting any", () => {
    // Unreachable in the app (System is always offered), so the assertion is that the
    // empty case fails closed rather than degenerating into a pass-through.
    expect(parseAppearanceChoice(submission({ font: "system" }), [])).toEqual({});
  });

  it("ignores an absent axis rather than substituting a default", () => {
    // An absent axis means "not chosen in this submission". Substituting a default
    // here would let a submission silently reset an axis the respondent did not touch.
    expect(parseAppearanceChoice(submission({ mode: "dark" }), OFFERED)).toEqual({ mode: "dark" });
  });

  it("treats an uploaded file as an absent field", () => {
    const form = new FormData();
    form.set("mode", new File(["dark"], "mode.txt"));
    expect(parseAppearanceChoice(form, OFFERED)).toEqual({});
  });

  it("takes no value from anywhere but the three named fields", () => {
    const parsed = parseAppearanceChoice(
      submission({ mode: "dark", theme: "plum", "qcms-theme": "hc", returnTo: "/s/ses_1" }),
      OFFERED,
    );
    expect(parsed).toEqual({ mode: "dark" });
  });
});

describe("the redirect goes back to this portal or to the root, never elsewhere", () => {
  it("returns the page the form was submitted from", () => {
    expect(safeReturnPath("/s/ses_1", undefined, PORTAL_BASE)).toBe("/s/ses_1");
    expect(safeReturnPath("/f/road-cover", undefined, PORTAL_BASE)).toBe("/f/road-cover");
  });

  it("keeps a query string, which is part of the page a respondent was on", () => {
    expect(safeReturnPath("/f/road-cover?state=error", undefined, PORTAL_BASE)).toBe(
      "/f/road-cover?state=error",
    );
  });

  // Every rejection lands on the same answer, so probing this teaches an attacker
  // nothing about which rule refused them.
  it.each([
    ["an absolute URL on another origin", "https://evil.example/x"],
    ["an absolute URL on our own origin, which is still not a relative reference", `${PORTAL_BASE}/s/ses_1`],
    ["a protocol-relative reference", "//evil.example/x"],
    // The URL parser treats a backslash as a slash for special schemes, so this is the
    // line above wearing a disguise. It is the case a `startsWith("//")` check misses.
    ["the backslash spelling of a protocol-relative reference", "/\\evil.example/x"],
    ["a scheme-relative reference with a userinfo trick", "//forms.qcms.test@evil.example/x"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a bare path with no leading slash", "s/ses_1"],
    ["a fragment", "#appearance"],
    ["an empty string", ""],
    ["an absent field", undefined],
  ])("falls back to the root for %s", (_name, candidate) => {
    expect(safeReturnPath(candidate, undefined, PORTAL_BASE)).toBe(DEFAULT_RETURN);
  });

  // A redirect to a POST-only route is a 405, so a respondent who submitted the form
  // would lose the page instead of getting it back with their choice applied.
  it("refuses the appearance route itself as a target", () => {
    expect(safeReturnPath(APPEARANCE_ROUTE, undefined, PORTAL_BASE)).toBe(DEFAULT_RETURN);
    expect(safeReturnPath(`${APPEARANCE_ROUTE}?x=1`, undefined, PORTAL_BASE)).toBe(DEFAULT_RETURN);
  });

  it("does not depend on the configured base URL to refuse a foreign target", () => {
    // The candidate leg resolves against a synthetic origin on purpose: an unset or
    // mis-set `QCMS_PORTAL_BASE_URL` must not be able to turn this check off.
    for (const base of [undefined, "", "not a url", "https://other.example"]) {
      expect(safeReturnPath("//evil.example/x", undefined, base), String(base)).toBe(DEFAULT_RETURN);
      expect(safeReturnPath("/s/ses_1", undefined, base), String(base)).toBe("/s/ses_1");
    }
  });
});

describe("the Referer leg, which this deployment's own responses never produce", () => {
  // `proxy.ts` sets `Referrer-Policy: no-referrer` on every portal response, so a form
  // navigation here carries no `Referer` at all - the hidden field is what does the
  // work. This leg exists for a deployment that relaxes that policy at its ingress,
  // and it is held to exactly the same rule.
  it("accepts a Referer naming this portal's own origin", () => {
    expect(safeReturnPath(undefined, `${PORTAL_BASE}/s/ses_1`, PORTAL_BASE)).toBe("/s/ses_1");
    expect(safeReturnPath(undefined, `${PORTAL_BASE}/f/road-cover?state=error`, PORTAL_BASE)).toBe(
      "/f/road-cover?state=error",
    );
  });

  it.each([
    ["a foreign origin", "https://evil.example/s/ses_1"],
    ["a sibling subdomain, which is a different origin", "https://other.qcms.test/s/ses_1"],
    ["the same host on another scheme", "http://forms.qcms.test/s/ses_1"],
    ["a relative Referer, which is not a thing a browser sends", "/s/ses_1"],
    ["a Referer at the appearance route", `${PORTAL_BASE}${APPEARANCE_ROUTE}`],
  ])("falls back to the root for %s", (_name, referer) => {
    expect(safeReturnPath(undefined, referer, PORTAL_BASE)).toBe(DEFAULT_RETURN);
  });

  it("cannot be used when the base URL is unreadable, rather than being trusted", () => {
    for (const base of [undefined, "", "not a url"]) {
      expect(safeReturnPath(undefined, `${PORTAL_BASE}/s/ses_1`, base), String(base)).toBe(
        DEFAULT_RETURN,
      );
    }
  });

  it("is only a fallback: a usable field wins over a usable header", () => {
    expect(safeReturnPath("/s/ses_1", `${PORTAL_BASE}/f/road-cover`, PORTAL_BASE)).toBe("/s/ses_1");
  });

  it("is consulted when the field is unusable, so a refusal is not a dead end", () => {
    expect(safeReturnPath("//evil.example/x", `${PORTAL_BASE}/s/ses_1`, PORTAL_BASE)).toBe(
      "/s/ses_1",
    );
  });
});
