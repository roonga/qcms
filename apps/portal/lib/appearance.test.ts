/**
 * The shared appearance vocabulary (task 053): the class names, the cookie
 * attributes and the parsers that the SSR path and the browser controls both use.
 *
 * These are small functions, and the reason they are worth pinning is that they are
 * the SEAM: `lib/server/theme.ts` reads them during SSR to build the root class, and
 * `components/appearance-controls.tsx` reads the same ones in the browser to swap it.
 * A divergence between the two shows up as a flash or a stuck control, in a browser,
 * at a point where nothing says which side was wrong.
 */

import { describe, expect, it } from "vitest";

import {
  APPEARANCE_MAX_AGE_SECONDS,
  APPEARANCE_MODES,
  DEFAULT_DENSITY,
  DENSITY_CLASSES,
  DENSITY_LEVELS,
  appearanceCookie,
  densityClass,
  parseDensity,
  parseMode,
} from "./appearance.js";

describe("mode and density vocabularies", () => {
  // `auto` is a config keyword, not a rendered mode. A control offering it would be
  // offering a state the page can never be in, and the class would match nothing.
  it("the selectable modes are the three root classes, and never include `auto`", () => {
    expect([...APPEARANCE_MODES]).toEqual(["light", "dark", "hc"]);
    expect(APPEARANCE_MODES).not.toContain("auto");
  });

  it("the levels run tightest to loosest, with Comfortable as the default", () => {
    expect([...DENSITY_LEVELS]).toEqual(["compact", "comfortable", "spacious"]);
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });

  // Comfortable IS the base `:root` spacing block, so a `.density-comfortable` class
  // would be a second place to edit the same five values.
  it("Comfortable is an absence of class; the other two are classes", () => {
    expect(densityClass("comfortable")).toBe("");
    expect(densityClass("compact")).toBe("density-compact");
    expect(densityClass("spacious")).toBe("density-spacious");
    expect([...DENSITY_CLASSES]).toEqual(["density-compact", "density-spacious"]);
  });
});

describe("parsers distinguish `no choice` from `a choice`", () => {
  it("returns the value for a real choice", () => {
    for (const mode of APPEARANCE_MODES) expect(parseMode(mode)).toBe(mode);
    for (const level of DENSITY_LEVELS) expect(parseDensity(level)).toBe(level);
  });

  // The whole point of `undefined`: a missing or hand-edited cookie has to fall
  // through to the deployment default and then to the OS signals. A parser that
  // substituted a default here would silently pin every visitor to Light.
  it("returns undefined for absent, empty and nonsense values", () => {
    for (const raw of [undefined, "", "auto", "sepia", "Light", " dark"]) {
      expect(parseMode(raw), `mode ${String(raw)}`).toBeUndefined();
    }
    for (const raw of [undefined, "", "cosy", "Compact"]) {
      expect(parseDensity(raw), `density ${String(raw)}`).toBeUndefined();
    }
  });
});

describe("the appearance cookie", () => {
  it("is a year-long, path-wide, SameSite=Lax preference", () => {
    expect(appearanceCookie("qcms-density", "compact", false)).toBe(
      `qcms-density=compact; Path=/; Max-Age=${APPEARANCE_MAX_AGE_SECONDS}; SameSite=Lax`,
    );
    expect(APPEARANCE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365);
  });

  it("adds Secure in production and omits it over plain http", () => {
    expect(appearanceCookie("qcms-theme", "hc", true)).toMatch(/; Secure$/u);
    expect(appearanceCookie("qcms-theme", "hc", false)).not.toContain("Secure");
  });

  // These cookies are presentation chrome, so no `httpOnly` (the browser writes
  // them) - and that is only safe because nothing about a session, an identity or an
  // answer is inferable from a mode keyword.
  it("is not httpOnly, because the browser is the writer", () => {
    expect(appearanceCookie("qcms-font", "atkinson", true)).not.toContain("HttpOnly");
  });

  // Cannot fire on any legitimate value (every one is a keyword or a registry key),
  // so it is a tripwire for a future call site rather than a runtime code path.
  it("refuses anything that could smuggle an attribute into the cookie", () => {
    for (const value of ["hc; Domain=evil.test", "a\nSet-Cookie: x=y", "Compact", ""]) {
      expect(() => appearanceCookie("qcms-theme", value, false), value).toThrow();
    }
  });
});
