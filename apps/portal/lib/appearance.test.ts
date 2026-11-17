import { describe, expect, it } from "vitest";

import {
  APPEARANCE_MAX_AGE_SECONDS,
  APPEARANCE_MODES,
  DEFAULT_DENSITY,
  DENSITY_LEVELS,
  TEXT_BASE_MAX,
  TEXT_BASE_MIN,
  TEXT_SCALE_CLASSES,
  TEXT_SCALES,
  TEXT_SIZE_CAP_PX,
  appearanceCookie,
  appearanceCookiesFor,
  densityClass,
  parseMode,
  parseTextScale,
  textSizePx,
} from "./appearance.js";

describe("mode and density vocabularies", () => {
  it("the selectable modes are the three root classes, and never include `auto`", () => {
    expect([...APPEARANCE_MODES]).toEqual(["light", "dark", "hc"]);
    expect(APPEARANCE_MODES).not.toContain("auto");
  });

  it("the levels run tightest to loosest, with Comfortable as the default", () => {
    expect([...DENSITY_LEVELS]).toEqual(["compact", "comfortable", "spacious"]);
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });

  it("Comfortable is an absence of class; the other two are classes", () => {
    expect(densityClass("comfortable")).toBe("");
    expect(densityClass("compact")).toBe("density-compact");
    expect(densityClass("spacious")).toBe("density-spacious");
  });
});

describe("text size (Q9)", () => {
  const bases = Array.from(
    { length: TEXT_BASE_MAX - TEXT_BASE_MIN + 1 },
    (_, index) => TEXT_BASE_MIN + index,
  );

  it("offers the four respondent scales, each with its own root class", () => {
    expect([...TEXT_SCALES]).toEqual(["100", "125", "150", "200"]);
    expect([...TEXT_SCALE_CLASSES]).toEqual([
      "text-scale-100",
      "text-scale-125",
      "text-scale-150",
      "text-scale-200",
    ]);
  });

  it.each(bases)("multiplies a %ipx base by every scale and caps the product at 32px", (base) => {
    for (const scale of TEXT_SCALES) {
      const product = (base * Number(scale)) / 100;
      const rendered = textSizePx(base, scale);
      expect(rendered, `${String(base)}px x ${scale}%`).toBe(Math.min(product, TEXT_SIZE_CAP_PX));
      expect(rendered).toBeLessThanOrEqual(32);
      expect(rendered).toBeGreaterThanOrEqual(base);
    }
  });

  it("reaches the cap exactly at the default base and the largest scale", () => {
    expect(textSizePx(16, "200")).toBe(32);
    expect(textSizePx(24, "125")).toBe(30);
    expect(textSizePx(24, "150")).toBe(32);
  });
});

describe("parsers distinguish `no choice` from `a choice`", () => {
  it("returns the value for a real choice", () => {
    for (const mode of APPEARANCE_MODES) expect(parseMode(mode)).toBe(mode);
    for (const scale of TEXT_SCALES) expect(parseTextScale(scale)).toBe(scale);
  });

  it("returns undefined for absent, empty and nonsense values", () => {
    for (const raw of [undefined, "", "auto", "sepia", "Light", " dark"]) {
      expect(parseMode(raw), `mode ${String(raw)}`).toBeUndefined();
    }
    for (const raw of [undefined, "", "175", "24", "100%"]) {
      expect(parseTextScale(raw), `text scale ${String(raw)}`).toBeUndefined();
    }
  });
});

describe("the appearance cookie", () => {
  it("is a year-long, path-wide, SameSite=Lax preference", () => {
    expect(appearanceCookie("qcms-text-size", "150", false)).toBe(
      `qcms-text-size=150; Path=/; Max-Age=${APPEARANCE_MAX_AGE_SECONDS}; SameSite=Lax`,
    );
    expect(APPEARANCE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365);
  });

  it("adds Secure in production and omits it over plain http", () => {
    expect(appearanceCookie("qcms-theme", "hc", true)).toMatch(/; Secure$/u);
    expect(appearanceCookie("qcms-theme", "hc", false)).not.toContain("Secure");
  });

  it("is not httpOnly, because the browser is the writer", () => {
    expect(appearanceCookie("qcms-font", "atkinson", true)).not.toContain("HttpOnly");
  });

  it("refuses anything that could smuggle an attribute into the cookie", () => {
    for (const value of ["hc; Domain=evil.test", "a\nSet-Cookie: x=y", "Compact", ""]) {
      expect(() => appearanceCookie("qcms-theme", value, false), value).toThrow();
    }
  });
});

describe("the cookies one submission writes", () => {
  it("writes exactly the axes that were chosen, in axis order", () => {
    expect(appearanceCookiesFor({ mode: "hc", font: "atkinson", textSize: "200" }, false)).toEqual([
      appearanceCookie("qcms-theme", "hc", false),
      appearanceCookie("qcms-font", "atkinson", false),
      appearanceCookie("qcms-text-size", "200", false),
    ]);
  });

  it("writes nothing for an axis that was not chosen", () => {
    expect(appearanceCookiesFor({ font: "lexend" }, false)).toEqual([
      appearanceCookie("qcms-font", "lexend", false),
    ]);
    expect(appearanceCookiesFor({}, false)).toEqual([]);
  });

  it("carries Secure through to every cookie it writes", () => {
    const written = appearanceCookiesFor({ mode: "dark", font: "system", textSize: "125" }, true);
    expect(written).toHaveLength(3);
    for (const cookie of written) expect(cookie).toMatch(/; Secure$/u);
  });

  it("refuses a value that could smuggle an attribute, at the axis it was passed on", () => {
    expect(() => appearanceCookiesFor({ font: "atkinson; Domain=evil.test" }, false)).toThrow();
  });
});
