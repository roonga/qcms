/**
 * Per-deployment theme, font, density and brand config resolves from the
 * environment, and the respondent's own choices resolve over it (task 051 exit
 * criterion 2; task 052's curation config; task 053's density, brand mark and
 * cookie precedence). Every accepted value, the defaults, and the typo path are
 * covered here; the browser end of the same wire (config -> `<html>` -> computed
 * style -> a same-origin font request, and the controls writing the cookies back)
 * is asserted in `e2e/theming.pw.ts`, `e2e/fonts.pw.ts` and `e2e/appearance.pw.ts`.
 */

import { FONT_REGISTRY, SYSTEM_FONT_KEY } from "@qcms/ui/fonts";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_DENSITY, DENSITY_LEVELS } from "../appearance.js";
import { messages } from "../i18n/en.js";
import {
  DEFAULT_CORNERS,
  DEFAULT_FONT,
  DEFAULT_MODE,
  DEFAULT_THEME,
  PORTAL_CORNERS,
  PORTAL_MODES,
  PORTAL_THEMES,
  cornersClass,
  modeClass,
  portalBrand,
  portalCorners,
  portalDensity,
  portalFont,
  portalFontChoices,
  portalMode,
  portalTheme,
  resolveAppearance,
  rootClassName,
} from "./theme.js";

const KEYS = [
  "QCMS_PORTAL_THEME",
  "QCMS_PORTAL_CORNERS",
  "QCMS_PORTAL_MODE",
  "QCMS_PORTAL_DENSITY",
  "QCMS_PORTAL_FONT",
  "QCMS_PORTAL_FONTS",
  "QCMS_PORTAL_BRAND_NAME",
  "QCMS_PORTAL_BRAND_LOGO",
] as const;

/** No cookies at all: the shape `resolveAppearance` sees for a first-time visitor. */
const NO_COOKIES = { mode: undefined, font: undefined, density: undefined } as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("theme selection", () => {
  it("defaults to the shipped brand-neutral theme when unset", () => {
    expect(portalTheme()).toBe(DEFAULT_THEME);
    expect(DEFAULT_THEME).toBe("slate");
  });

  it("accepts every predefined theme", () => {
    for (const theme of PORTAL_THEMES) {
      process.env.QCMS_PORTAL_THEME = theme;
      expect(portalTheme()).toBe(theme);
    }
  });

  it("falls back to the default for an unrecognized or empty value", () => {
    process.env.QCMS_PORTAL_THEME = "chartreuse";
    expect(portalTheme()).toBe(DEFAULT_THEME);
    process.env.QCMS_PORTAL_THEME = "";
    expect(portalTheme()).toBe(DEFAULT_THEME);
  });
});

describe("corner preset selection", () => {
  it("defaults to Subtle, the base of the radius group", () => {
    expect(portalCorners()).toBe(DEFAULT_CORNERS);
    expect(cornersClass(DEFAULT_CORNERS)).toBe("");
  });

  it("accepts every preset and maps the non-default ones to a root class", () => {
    for (const corners of PORTAL_CORNERS) {
      process.env.QCMS_PORTAL_CORNERS = corners;
      expect(portalCorners()).toBe(corners);
    }
    expect(cornersClass("sharp")).toBe("radius-sharp");
    expect(cornersClass("rounded")).toBe("radius-rounded");
    expect(cornersClass("pill")).toBe("radius-pill");
  });

  it("falls back to Subtle for an unrecognized value", () => {
    process.env.QCMS_PORTAL_CORNERS = "wobbly";
    expect(portalCorners()).toBe(DEFAULT_CORNERS);
  });
});

describe("default colour mode selection", () => {
  it("defaults to auto (the OS signal decides)", () => {
    expect(portalMode()).toBe(DEFAULT_MODE);
    expect(modeClass("auto")).toBe("light");
  });

  it("accepts every mode, including High-contrast as a deployment default", () => {
    for (const mode of PORTAL_MODES) {
      process.env.QCMS_PORTAL_MODE = mode;
      expect(portalMode()).toBe(mode);
    }
    expect(modeClass("hc")).toBe("hc");
    expect(modeClass("dark")).toBe("dark");
  });

  it("falls back to auto for an unrecognized value", () => {
    process.env.QCMS_PORTAL_MODE = "sepia";
    expect(portalMode()).toBe(DEFAULT_MODE);
  });
});

describe("default font selection", () => {
  it("defaults to System, the one entry that downloads nothing", () => {
    expect(portalFont()).toBe(DEFAULT_FONT);
    expect(DEFAULT_FONT).toBe(SYSTEM_FONT_KEY);
  });

  it("accepts every key in the shipped registry", () => {
    for (const entry of FONT_REGISTRY) {
      process.env.QCMS_PORTAL_FONT = entry.key;
      expect(portalFont(), entry.key).toBe(entry.key);
    }
  });

  it("falls back to System for an unrecognized or empty value", () => {
    process.env.QCMS_PORTAL_FONT = "papyrus";
    expect(portalFont()).toBe(SYSTEM_FONT_KEY);
    process.env.QCMS_PORTAL_FONT = "";
    expect(portalFont()).toBe(SYSTEM_FONT_KEY);
  });

  // The one effect the curation list has BEFORE task 053 renders a control from
  // it: a default the deployment does not offer is not a legal default, because a
  // respondent who switched away could never switch back to it.
  it("falls back to System for a real key the deployment has curated away", () => {
    process.env.QCMS_PORTAL_FONTS = "inter, merriweather";
    process.env.QCMS_PORTAL_FONT = "lexend";
    expect(portalFont()).toBe(SYSTEM_FONT_KEY);
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(portalFont()).toBe("inter");
  });
});

describe("font curation config", () => {
  it("offers the whole registry when unset or empty", () => {
    expect(portalFontChoices()).toEqual(FONT_REGISTRY);
    process.env.QCMS_PORTAL_FONTS = "   ";
    expect(portalFontChoices()).toEqual(FONT_REGISTRY);
  });

  it("accepts commas, spaces, or both as separators", () => {
    for (const raw of ["inter,merriweather", "inter merriweather", "inter,  merriweather"]) {
      process.env.QCMS_PORTAL_FONTS = raw;
      expect(
        portalFontChoices().map((entry) => entry.key),
        raw,
      ).toEqual([SYSTEM_FONT_KEY, "inter", "merriweather"]);
    }
  });

  it("keeps System even when the operator does not list it, and cannot be emptied", () => {
    process.env.QCMS_PORTAL_FONTS = "inter";
    expect(portalFontChoices().map((entry) => entry.key)).toEqual([SYSTEM_FONT_KEY, "inter"]);
    process.env.QCMS_PORTAL_FONTS = "papyrus, wingdings";
    expect(portalFontChoices()).toEqual(FONT_REGISTRY);
  });

  it("drops an unknown key rather than failing the deployment", () => {
    process.env.QCMS_PORTAL_FONTS = "inter, papyrus";
    expect(portalFontChoices().map((entry) => entry.key)).toEqual([SYSTEM_FONT_KEY, "inter"]);
  });

  it("returns entries in registry order, not the order the operator typed", () => {
    process.env.QCMS_PORTAL_FONTS = "jetbrainsmono, atkinson, inter";
    expect(portalFontChoices().map((entry) => entry.key)).toEqual([
      SYSTEM_FONT_KEY,
      "atkinson",
      "inter",
      "jetbrainsmono",
    ]);
  });
});

describe("density config (task 053)", () => {
  it("defaults to Comfortable, the base spacing block", () => {
    expect(portalDensity()).toBe(DEFAULT_DENSITY);
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });

  it("accepts every level", () => {
    for (const level of DENSITY_LEVELS) {
      process.env.QCMS_PORTAL_DENSITY = level;
      expect(portalDensity()).toBe(level);
    }
  });

  it("falls back rather than failing the deployment on a typo", () => {
    process.env.QCMS_PORTAL_DENSITY = "cosy";
    expect(portalDensity()).toBe(DEFAULT_DENSITY);
  });
});

describe("brand mark config (task 053, issue #25)", () => {
  it("falls back to the catalog's generic name, never the engine's", () => {
    expect(portalBrand()).toEqual({ name: messages["brand.defaultName"], logoSrc: undefined });
    expect(messages["brand.defaultName"]).not.toContain("QCMS");
  });

  it("takes the configured name, and treats blank or whitespace as unset", () => {
    process.env.QCMS_PORTAL_BRAND_NAME = "  Northwind Rowing Club  ";
    expect(portalBrand().name).toBe("Northwind Rowing Club");
    process.env.QCMS_PORTAL_BRAND_NAME = "   ";
    expect(portalBrand().name).toBe(messages["brand.defaultName"]);
  });

  // The validator matches what `csp.ts` already permits (`img-src 'self' data:`),
  // so a value it accepts is a value the browser will actually load.
  it("accepts a same-origin path and an inline data image", () => {
    for (const logo of [
      "/brand/logo.svg",
      "/logo.png?v=2",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    ]) {
      process.env.QCMS_PORTAL_BRAND_LOGO = logo;
      expect(portalBrand().logoSrc, logo).toBe(logo);
    }
  });

  it("drops a logo the CSP could not load, or one that could break the attribute", () => {
    for (const logo of [
      "https://cdn.example.com/logo.png", // off-origin: img-src 'self' refuses it
      "//cdn.example.com/logo.png", // protocol-relative: starts with / but is off-origin
      "javascript:alert(1)", // not an image scheme at all
      "data:text/html,<script>x</script>", // data:, but not an image
      '/logo.png" onerror="x', // attribute-breaking characters
      "/logo one.png", // whitespace
    ]) {
      process.env.QCMS_PORTAL_BRAND_LOGO = logo;
      expect(portalBrand().logoSrc, logo).toBeUndefined();
    }
  });
});

describe("respondent choices resolve over config (task 053)", () => {
  it("uses config when there is no cookie at all", () => {
    process.env.QCMS_PORTAL_MODE = "dark";
    process.env.QCMS_PORTAL_DENSITY = "spacious";
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(resolveAppearance(NO_COOKIES)).toEqual({
      mode: "dark",
      modeChosen: false,
      font: "inter",
      density: "spacious",
    });
  });

  it("an explicit cookie beats config on every axis", () => {
    process.env.QCMS_PORTAL_MODE = "light";
    process.env.QCMS_PORTAL_DENSITY = "comfortable";
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(resolveAppearance({ mode: "hc", font: "atkinson", density: "compact" })).toEqual({
      mode: "hc",
      modeChosen: true,
      font: "atkinson",
      density: "compact",
    });
  });

  // `auto` survives resolution deliberately: it is not a rendered mode, it is the
  // signal to `app/layout.tsx`'s pre-paint script that the OS gets to decide.
  it("leaves a configured `auto` as `auto`, and reports no explicit choice", () => {
    const resolved = resolveAppearance(NO_COOKIES);
    expect(resolved.mode).toBe("auto");
    expect(resolved.modeChosen).toBe(false);
    expect(modeClass(resolved.mode)).toBe("light");
  });

  it("treats a nonsense cookie as no choice, not as a value to render", () => {
    process.env.QCMS_PORTAL_MODE = "dark";
    const resolved = resolveAppearance({ mode: "sepia", font: "papyrus", density: "cosy" });
    expect(resolved.mode).toBe("dark");
    expect(resolved.modeChosen).toBe(false);
    expect(resolved.font).toBe(DEFAULT_FONT);
    expect(resolved.density).toBe(DEFAULT_DENSITY);
  });

  // The curation rule with teeth: a face the deployment has stopped OFFERING must
  // stop being served, because the font control could no longer switch back to it.
  it("ignores a font cookie naming a face this deployment no longer offers", () => {
    process.env.QCMS_PORTAL_FONTS = "inter";
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(resolveAppearance({ ...NO_COOKIES, font: "lexend" }).font).toBe("inter");
    expect(resolveAppearance({ ...NO_COOKIES, font: SYSTEM_FONT_KEY }).font).toBe(SYSTEM_FONT_KEY);
  });
});

describe("root class name", () => {
  // The cast takes plain strings where the signature wants the literal unions, so a
  // case can pass a value the resolver is supposed to reject (that is what several of
  // these tests assert). Shaping only: the object's keys and their runtime types are
  // exactly what `rootClassName` reads.
  const at = (mode: string, font: string, density: string) =>
    ({ mode, modeChosen: false, font, density }) as Parameters<typeof rootClassName>[0];

  it("carries the mode and the font, omitting the class for the two base presets", () => {
    expect(rootClassName(at("auto", "system", "comfortable"), "subtle")).toBe("light font-system");
    expect(rootClassName(at("dark", "inter", "comfortable"), "subtle")).toBe("dark font-inter");
  });

  it("carries all four when a non-default preset, font and density are in force", () => {
    expect(rootClassName(at("hc", "atkinson", "compact"), "pill")).toBe(
      "hc radius-pill font-atkinson density-compact",
    );
    expect(rootClassName(at("light", "system", "spacious"), "subtle")).toBe(
      "light font-system density-spacious",
    );
  });
});
