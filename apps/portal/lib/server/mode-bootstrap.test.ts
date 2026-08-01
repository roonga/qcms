/**
 * The pre-paint colour-mode precedence chain, proven by RUNNING the emitted
 * bootstrap source (issue #197).
 *
 * `theme.test.ts` covers the server half of the same chain (config, then the
 * cookie the request carried) and `e2e/appearance.pw.ts` covers the browser half
 * with the first-frame no-flash measurement. Neither can see the thing #197 was:
 * the script let a `?mode=` value win BEFORE checking it was a mode at all, so
 * `?mode=potato` resolved to Light and threw away a respondent's stored
 * High-contrast choice. The behaviour lives in generated source, so the honest
 * test is to execute that source rather than to read it.
 *
 * The script is run in a `node:vm` context with stub globals rather than in jsdom:
 * the whole surface it touches is four objects (`location.search`,
 * `document.cookie`, `document.documentElement.classList`, `window.matchMedia`),
 * a full DOM would add a dependency for no extra signal, and the stubs make the
 * absence of `matchMedia` testable, which is the branch a script running in an old
 * or embedded browser takes.
 */

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { APPEARANCE_MODES, MODE_COOKIE, type AppearanceMode } from "../appearance.js";
import { modeBootstrapScript } from "./mode-bootstrap.js";
import { PORTAL_MODES } from "./theme.js";

interface Browser {
  /** The query string, including the leading `?`, exactly as `location.search`. */
  readonly search?: string;
  /** The whole `document.cookie` string, as the browser would serialise it. */
  readonly cookie?: string;
  /** The mode class the SERVER stamped on `<html>`, which the script may swap. */
  readonly stamped?: string;
  readonly prefersDark?: boolean;
  readonly prefersContrast?: boolean;
  /** `false` models a browser with no `matchMedia` at all. */
  readonly matchMedia?: boolean;
}

/**
 * Execute the bootstrap the way `<head>` does and return the mode classes left on
 * the root element. A set, so a script that added a second mode class (or failed
 * to remove the stamped one) fails loudly instead of passing on a `contains`.
 */
function runBootstrap(script: string, browser: Browser = {}): readonly string[] {
  const classes = new Set<string>(browser.stamped === undefined ? [] : [browser.stamped]);
  const matchMedia = (query: string): { matches: boolean } => ({
    matches: query.includes("prefers-contrast")
      ? (browser.prefersContrast ?? false)
      : (browser.prefersDark ?? false),
  });
  // eslint-disable-next-line sonarjs/code-eval -- the executed source is this repo's own generated script, run in a test against stub globals in an isolated vm context; executing it IS the assertion
  runInNewContext(script, {
    URLSearchParams,
    location: { search: browser.search ?? "" },
    document: {
      cookie: browser.cookie ?? "",
      documentElement: {
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
        },
      },
    },
    window: { matchMedia: browser.matchMedia === false ? undefined : matchMedia },
  });
  return [...classes];
}

/** The mode the script resolved to. Exactly one class, always. */
function resolved(script: string, browser: Browser = {}): string {
  const classes = runBootstrap(script, browser);
  expect(classes, "the bootstrap should leave exactly one mode class").toHaveLength(1);
  return classes[0] ?? "";
}

/** The common deployment: `QCMS_PORTAL_MODE=auto`, no cookie seen by the server. */
const autoNoCookie = modeBootstrapScript("auto", null);

describe("the pre-paint mode bootstrap", () => {
  it("takes a valid ?mode= over everything below it", () => {
    for (const mode of APPEARANCE_MODES) {
      expect(
        resolved(autoNoCookie, {
          search: `?mode=${mode}`,
          cookie: `${MODE_COOKIE}=light`,
          prefersDark: true,
          stamped: "light",
        }),
      ).toBe(mode);
    }
  });

  // The issue #197 boundary, in the exact shape it was reported: a respondent who
  // chose High contrast follows a link carrying a malformed parameter. Before the
  // fix this rendered `light`, because the parameter won before it was checked.
  it("falls through an invalid ?mode= to the cookie (issue #197)", () => {
    expect(
      resolved(autoNoCookie, {
        search: "?mode=potato",
        cookie: `${MODE_COOKIE}=hc`,
        stamped: "light",
      }),
    ).toBe("hc");
  });

  it("falls through the same way for the server-read cookie the render stamped", () => {
    // The `cookieMode` argument is the same choice seen a request earlier: the
    // server resolved it and stamped `hc`, and a malformed parameter must not
    // undo that either.
    const stampedHc = modeBootstrapScript("auto", "hc");
    expect(resolved(stampedHc, { search: "?mode=potato", stamped: "hc" })).toBe("hc");
  });

  it("rejects a parameter that is empty, mis-cased or absent", () => {
    for (const search of ["", "?mode=", "?mode=HC", "?mode=%20hc", "?theme=dark"]) {
      expect(resolved(autoNoCookie, { search, cookie: `${MODE_COOKIE}=hc` }), search).toBe("hc");
    }
  });

  // A link can pick up a second `?mode=` from any number of accidents (a template
  // that appends one, a redirect that re-adds it). The guarantee is that this is
  // never ambiguous: the leftmost occurrence is the only one that speaks, so a
  // trailing duplicate can neither rescue an invalid value nor override a valid
  // one. Both cases below are discriminating - reading the LAST value would give a
  // different answer than the one asserted.
  it("reads only the first of a repeated ?mode=", () => {
    expect(
      resolved(autoNoCookie, { search: "?mode=potato&mode=hc", cookie: `${MODE_COOKIE}=dark` }),
    ).toBe("dark");
    expect(
      resolved(autoNoCookie, { search: "?mode=hc&mode=dark", cookie: `${MODE_COOKIE}=light` }),
    ).toBe("hc");
  });

  it("keeps falling past an invalid parameter to the OS signals, then to config", () => {
    // No cookie at all: the chain continues into the OS signals, which is the only
    // place the respondent's intent can still be read.
    expect(resolved(autoNoCookie, { search: "?mode=potato", prefersDark: true })).toBe("dark");
    expect(resolved(autoNoCookie, { search: "?mode=potato", prefersContrast: true })).toBe("hc");
    // A contrast preference outranks a colour one: the accessibility need wins.
    expect(
      resolved(autoNoCookie, { search: "?mode=potato", prefersDark: true, prefersContrast: true }),
    ).toBe("hc");
    // Nothing to go on anywhere: the configured `auto` deployment lands on Light.
    expect(resolved(autoNoCookie, { search: "?mode=potato" })).toBe("light");
    // A deployment that PINS a mode is not second-guessed by the OS, and an invalid
    // parameter does not knock it off its own default either.
    const pinned = modeBootstrapScript("dark", null);
    expect(resolved(pinned, { search: "?mode=potato", prefersContrast: true })).toBe("dark");
  });

  it("falls through a cookie holding something that is not a mode", () => {
    expect(resolved(autoNoCookie, { cookie: `${MODE_COOKIE}=potato`, prefersContrast: true })).toBe(
      "hc",
    );
    // ... and still finds a valid cookie that is not the first one in the header.
    expect(resolved(autoNoCookie, { cookie: `qcms-font=system; ${MODE_COOKIE}=dark` })).toBe(
      "dark",
    );
  });

  it("resolves every configured default when nothing else is present", () => {
    for (const mode of PORTAL_MODES) {
      const expected = mode === "auto" ? "light" : mode;
      expect(resolved(modeBootstrapScript(mode, null)), mode).toBe(expected);
    }
  });

  it("replaces the stamped class instead of adding to it", () => {
    // A wrongly-stamped root is the flash case: the script must remove what SSR put
    // there, not leave two mode classes fighting over the token blocks.
    expect(runBootstrap(autoNoCookie, { search: "?mode=dark", stamped: "light" })).toEqual([
      "dark",
    ]);
  });

  it("survives a browser with no matchMedia and never throws", () => {
    expect(resolved(autoNoCookie, { matchMedia: false })).toBe("light");
    expect(resolved(autoNoCookie, { matchMedia: false, cookie: `${MODE_COOKIE}=hc` })).toBe("hc");
  });

  it("carries no accepted-values list of its own", () => {
    // The regression guard for the shape of the bug rather than its symptom: both
    // the mode keywords and the cookie name come from `lib/appearance.ts`, so a
    // fourth mode cannot be added to the app and forgotten here.
    const script = modeBootstrapScript("auto", null);
    for (const mode of APPEARANCE_MODES) expect(script).toContain(`'${mode}'`);
    expect(script).toContain(`${MODE_COOKIE}=([^;]*)`);
    // No hand-written alternation of mode keywords anywhere in the source.
    expect(script).not.toMatch(/dark\|light\|hc/u);
  });

  it("emits only known keywords into the script source", () => {
    // Nothing respondent-supplied reaches the generated source: the only quoted
    // literals in it are mode keywords and the two media queries, so there is no
    // injection surface behind the `dangerouslySetInnerHTML` in `app/layout.tsx`.
    const allowed = [
      ...APPEARANCE_MODES.map((mode) => `'${mode}'`),
      "'(prefers-color-scheme: dark)'",
      "'(prefers-contrast: more)'",
      "'mode'",
    ];
    const cookieModes: readonly (AppearanceMode | null)[] = [null, ...APPEARANCE_MODES];
    for (const configured of PORTAL_MODES) {
      for (const cookie of cookieModes) {
        const script = modeBootstrapScript(configured, cookie);
        expect(script).not.toContain("</script");
        const literals = script.match(/'[^']*'/gu) ?? [];
        expect(literals.filter((literal) => !allowed.includes(literal))).toEqual([]);
      }
    }
  });
});
