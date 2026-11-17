import { FONT_REGISTRY, SYSTEM_FONT_KEY } from "@roonga/qcms-ui/fonts";
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
  pageFontChoices,
  portalBrand,
  portalCorners,
  portalDensity,
  portalFont,
  portalFontChoices,
  portalMode,
  portalTheme,
  resolveAppearance,
  resolveCorners,
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
const NO_COOKIES = { mode: undefined, font: undefined, textSize: undefined } as const;

/** System and the three legibility faces, in registry order: curation never removes them. */
const LEGIBILITY = [SYSTEM_FONT_KEY, "atkinson", "lexend", "opendyslexic"] as const;

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

  it("falls back to System for a real key the deployment has curated away", () => {
    process.env.QCMS_PORTAL_FONTS = "inter, merriweather";
    process.env.QCMS_PORTAL_FONT = "roboto";
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
      ).toEqual([...LEGIBILITY, "inter", "merriweather"]);
    }
  });

  it("keeps System and the legibility faces whatever the operator lists", () => {
    process.env.QCMS_PORTAL_FONTS = "inter";
    expect(portalFontChoices().map((entry) => entry.key)).toEqual([...LEGIBILITY, "inter"]);
    process.env.QCMS_PORTAL_FONTS = "papyrus, wingdings";
    expect(portalFontChoices()).toEqual(FONT_REGISTRY);
  });

  it("drops an unknown key rather than failing the deployment", () => {
    process.env.QCMS_PORTAL_FONTS = "inter, papyrus";
    expect(portalFontChoices().map((entry) => entry.key)).toEqual([...LEGIBILITY, "inter"]);
  });

  it("returns entries in registry order, not the order the operator typed", () => {
    process.env.QCMS_PORTAL_FONTS = "jetbrainsmono, opendyslexic, inter";
    expect(portalFontChoices().map((entry) => entry.key)).toEqual([
      ...LEGIBILITY,
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
      textScale: "100",
    });
  });

  it("an explicit cookie beats config on every respondent axis", () => {
    process.env.QCMS_PORTAL_MODE = "light";
    process.env.QCMS_PORTAL_DENSITY = "comfortable";
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(resolveAppearance({ mode: "hc", font: "atkinson", textSize: "150" })).toEqual({
      mode: "hc",
      modeChosen: true,
      font: "atkinson",
      density: "comfortable",
      textScale: "150",
    });
  });

  it("leaves a configured `auto` as `auto`, and reports no explicit choice", () => {
    const resolved = resolveAppearance(NO_COOKIES);
    expect(resolved.mode).toBe("auto");
    expect(resolved.modeChosen).toBe(false);
    expect(modeClass(resolved.mode)).toBe("light");
  });

  it("treats a nonsense cookie as no choice, not as a value to render", () => {
    process.env.QCMS_PORTAL_MODE = "dark";
    const resolved = resolveAppearance({ mode: "sepia", font: "papyrus", textSize: "175" });
    expect(resolved.mode).toBe("dark");
    expect(resolved.modeChosen).toBe(false);
    expect(resolved.font).toBe(DEFAULT_FONT);
    expect(resolved.density).toBe(DEFAULT_DENSITY);
    expect(resolved.textScale).toBe("100");
  });

  it("ignores a font cookie naming a face this deployment no longer offers", () => {
    process.env.QCMS_PORTAL_FONTS = "inter";
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(resolveAppearance({ ...NO_COOKIES, font: "roboto" }).font).toBe("inter");
    expect(resolveAppearance({ ...NO_COOKIES, font: SYSTEM_FONT_KEY }).font).toBe(SYSTEM_FONT_KEY);
  });

  it("keeps a legibility face the operator did not list", () => {
    process.env.QCMS_PORTAL_FONTS = "inter";
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(resolveAppearance({ ...NO_COOKIES, font: "opendyslexic" }).font).toBe("opendyslexic");
  });
});

describe("a form's appearance sits between the respondent's choice and config", () => {
  const FORM = { face: "roboto", density: "spacious", corners: "pill" } as const;

  it("the form beats config on face, density and corners", () => {
    process.env.QCMS_PORTAL_FONT = "inter";
    process.env.QCMS_PORTAL_DENSITY = "compact";
    process.env.QCMS_PORTAL_CORNERS = "sharp";
    const resolved = resolveAppearance(NO_COOKIES, FORM);
    expect(resolved.font).toBe("roboto");
    expect(resolved.density).toBe("spacious");
    expect(resolveCorners(FORM)).toBe("pill");
  });

  it("the respondent's cookie beats the form on every axis it carries, never on density", () => {
    process.env.QCMS_PORTAL_MODE = "light";
    expect(resolveAppearance({ mode: "hc", font: "atkinson", textSize: "200" }, FORM)).toEqual({
      mode: "hc",
      modeChosen: true,
      font: "atkinson",
      density: "spacious",
      textScale: "200",
    });
  });

  it("leaves the mode to the respondent and config, since a form sets none", () => {
    process.env.QCMS_PORTAL_MODE = "dark";
    expect(resolveAppearance(NO_COOKIES, FORM).mode).toBe("dark");
  });

  it("falls back to config with no form appearance", () => {
    process.env.QCMS_PORTAL_FONT = "inter";
    process.env.QCMS_PORTAL_DENSITY = "compact";
    process.env.QCMS_PORTAL_CORNERS = "sharp";
    for (const form of [null, undefined]) {
      expect(resolveAppearance(NO_COOKIES, form)).toMatchObject({
        font: "inter",
        density: "compact",
      });
      expect(resolveCorners(form)).toBe("sharp");
    }
  });

  it("applies the form's face when the deployment does not offer it, and adds it to the menu", () => {
    process.env.QCMS_PORTAL_FONTS = "inter";
    process.env.QCMS_PORTAL_FONT = "inter";
    expect(resolveAppearance(NO_COOKIES, FORM).font).toBe("roboto");
    expect(pageFontChoices(FORM).map((entry) => entry.key)).toEqual([
      ...LEGIBILITY,
      "inter",
      "roboto",
    ]);
  });

  it("keeps a saved choice of the form's face on that form's page only", () => {
    process.env.QCMS_PORTAL_FONTS = "inter";
    process.env.QCMS_PORTAL_FONT = "inter";
    const saved = { ...NO_COOKIES, font: "roboto" };
    expect(resolveAppearance(saved, FORM).font).toBe("roboto");
    expect(resolveAppearance(saved, { ...FORM, face: "merriweather" }).font).toBe("merriweather");
    expect(resolveAppearance(saved).font).toBe("inter");
  });

  it("adds nothing to the menu for a face the deployment already offers, or with no form", () => {
    process.env.QCMS_PORTAL_FONTS = "inter, roboto";
    expect(pageFontChoices(FORM)).toEqual(portalFontChoices());
    expect(pageFontChoices(null)).toEqual(portalFontChoices());
  });
});

describe("root class name", () => {
  const at = (mode: string, font: string, density: string, textScale = "100") =>
    ({ mode, modeChosen: false, font, density, textScale }) as Parameters<typeof rootClassName>[0];

  it("carries the mode, the font and the scale, omitting the class for the two base presets", () => {
    expect(rootClassName(at("auto", "system", "comfortable"), "subtle")).toBe(
      "light font-system text-scale-100",
    );
    expect(rootClassName(at("dark", "inter", "comfortable"), "subtle")).toBe(
      "dark font-inter text-scale-100",
    );
  });

  it("carries all five when a non-default preset, font, density and scale are in force", () => {
    expect(rootClassName(at("hc", "atkinson", "compact", "200"), "pill")).toBe(
      "hc radius-pill font-atkinson density-compact text-scale-200",
    );
    expect(rootClassName(at("light", "system", "spacious", "125"), "subtle")).toBe(
      "light font-system density-spacious text-scale-125",
    );
  });
});
