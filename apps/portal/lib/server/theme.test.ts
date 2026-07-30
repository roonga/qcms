/**
 * Per-deployment theme and font selection resolves from config (task 051 exit
 * criterion 2; task 052's curation config). Every accepted value, the defaults,
 * and the typo path are covered here; the browser end of the same wire
 * (config -> `<html>` -> computed style -> a same-origin font request) is asserted
 * in `e2e/theming.pw.ts` and `e2e/fonts.pw.ts`.
 */

import { FONT_REGISTRY, SYSTEM_FONT_KEY } from "@qcms/ui/fonts";
import { afterEach, describe, expect, it } from "vitest";

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
  portalCorners,
  portalFont,
  portalFontChoices,
  portalMode,
  portalTheme,
  rootClassName,
} from "./theme.js";

const KEYS = [
  "QCMS_PORTAL_THEME",
  "QCMS_PORTAL_CORNERS",
  "QCMS_PORTAL_MODE",
  "QCMS_PORTAL_FONT",
  "QCMS_PORTAL_FONTS",
] as const;

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
      expect(portalFontChoices().map((entry) => entry.key), raw).toEqual([
        SYSTEM_FONT_KEY,
        "inter",
        "merriweather",
      ]);
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

describe("root class name", () => {
  it("carries the mode and the font, omitting the class for the base corner preset", () => {
    expect(rootClassName("auto", "subtle", "system")).toBe("light font-system");
    expect(rootClassName("dark", "subtle", "inter")).toBe("dark font-inter");
  });

  it("carries all three when a non-default preset and font are configured", () => {
    expect(rootClassName("hc", "pill", "atkinson")).toBe("hc radius-pill font-atkinson");
  });
});
