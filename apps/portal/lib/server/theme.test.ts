/**
 * Per-deployment theme selection resolves from config (task 051, exit criterion
 * 2). Every accepted value, the defaults, and the typo path are covered here; the
 * browser end of the same wire (config -> `<html>` -> computed style) is asserted
 * in `e2e/theming.pw.ts`.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CORNERS,
  DEFAULT_MODE,
  DEFAULT_THEME,
  PORTAL_CORNERS,
  PORTAL_MODES,
  PORTAL_THEMES,
  cornersClass,
  modeClass,
  portalCorners,
  portalMode,
  portalTheme,
  rootClassName,
} from "./theme.js";

const KEYS = ["QCMS_PORTAL_THEME", "QCMS_PORTAL_CORNERS", "QCMS_PORTAL_MODE"] as const;

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

describe("root class name", () => {
  it("carries the mode and omits the class for the base corner preset", () => {
    expect(rootClassName("auto", "subtle")).toBe("light");
    expect(rootClassName("dark", "subtle")).toBe("dark");
  });

  it("carries both when a non-default preset is configured", () => {
    expect(rootClassName("hc", "pill")).toBe("hc radius-pill");
  });
});
