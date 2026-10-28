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
  // eslint-disable-next-line sonarjs/code-eval -- the executed source is this repo's own generated script, run against stub globals in an isolated vm context; executing it is the assertion
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
    const stampedHc = modeBootstrapScript("auto", "hc");
    expect(resolved(stampedHc, { search: "?mode=potato", stamped: "hc" })).toBe("hc");
  });

  it("rejects a parameter that is empty, mis-cased or absent", () => {
    for (const search of ["", "?mode=", "?mode=HC", "?mode=%20hc", "?theme=dark"]) {
      expect(resolved(autoNoCookie, { search, cookie: `${MODE_COOKIE}=hc` }), search).toBe("hc");
    }
  });

  it("reads only the first of a repeated ?mode=", () => {
    expect(
      resolved(autoNoCookie, { search: "?mode=potato&mode=hc", cookie: `${MODE_COOKIE}=dark` }),
    ).toBe("dark");
    expect(
      resolved(autoNoCookie, { search: "?mode=hc&mode=dark", cookie: `${MODE_COOKIE}=light` }),
    ).toBe("hc");
  });

  it("keeps falling past an invalid parameter to the OS signals, then to config", () => {
    expect(resolved(autoNoCookie, { search: "?mode=potato", prefersDark: true })).toBe("dark");
    expect(resolved(autoNoCookie, { search: "?mode=potato", prefersContrast: true })).toBe("hc");
    expect(
      resolved(autoNoCookie, { search: "?mode=potato", prefersDark: true, prefersContrast: true }),
    ).toBe("hc");
    expect(resolved(autoNoCookie, { search: "?mode=potato" })).toBe("light");
    const pinned = modeBootstrapScript("dark", null);
    expect(resolved(pinned, { search: "?mode=potato", prefersContrast: true })).toBe("dark");
  });

  it("falls through a cookie holding something that is not a mode", () => {
    expect(resolved(autoNoCookie, { cookie: `${MODE_COOKIE}=potato`, prefersContrast: true })).toBe(
      "hc",
    );
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
    expect(runBootstrap(autoNoCookie, { search: "?mode=dark", stamped: "light" })).toEqual([
      "dark",
    ]);
  });

  it("survives a browser with no matchMedia and never throws", () => {
    expect(resolved(autoNoCookie, { matchMedia: false })).toBe("light");
    expect(resolved(autoNoCookie, { matchMedia: false, cookie: `${MODE_COOKIE}=hc` })).toBe("hc");
  });

  it("carries no accepted-values list of its own", () => {
    const script = modeBootstrapScript("auto", null);
    for (const mode of APPEARANCE_MODES) expect(script).toContain(`'${mode}'`);
    expect(script).toContain(`${MODE_COOKIE}=([^;]*)`);
    expect(script).not.toMatch(/dark\|light\|hc/u);
  });

  it("emits only known keywords into the script source", () => {
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
