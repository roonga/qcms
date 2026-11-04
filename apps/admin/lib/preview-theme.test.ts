import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREVIEW_MODE,
  DEFAULT_PREVIEW_THEME,
  PREVIEW_MODES,
  PREVIEW_THEMES,
  THEME_SCOPE_ATTRIBUTE,
  parsePreviewMode,
  parsePreviewTheme,
} from "./preview-theme.ts";
import { previewPortalTheme } from "./server/config.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the island's vocabulary", () => {
  it("offers the four predefined themes, with the shipped base as the default", () => {
    expect([...PREVIEW_THEMES]).toEqual(["slate", "harbor", "sand", "plum"]);
    expect(PREVIEW_THEMES).toContain(DEFAULT_PREVIEW_THEME);
    expect(DEFAULT_PREVIEW_THEME).toBe("slate");
  });

  it("offers the three respondent modes and opens in light", () => {
    expect([...PREVIEW_MODES]).toEqual(["light", "dark", "hc"]);
    expect(DEFAULT_PREVIEW_MODE).toBe("light");
  });

  it("names ADR-38's carrier attribute exactly once, here", () => {
    expect(THEME_SCOPE_ATTRIBUTE).toBe("data-qcms-theme-scope");
  });

  it("accepts every offered value and refuses everything else", () => {
    for (const theme of PREVIEW_THEMES) expect(parsePreviewTheme(theme)).toBe(theme);
    for (const mode of PREVIEW_MODES) expect(parsePreviewMode(mode)).toBe(mode);

    for (const raw of ["chartreuse", "", "SLATE", undefined]) {
      expect(parsePreviewTheme(raw)).toBeUndefined();
    }
    for (const raw of ["auto", "high-contrast", "", undefined]) {
      expect(parsePreviewMode(raw)).toBeUndefined();
    }
  });
});

describe("previewPortalTheme", () => {
  it("reads the same variable the portal reads", () => {
    for (const theme of PREVIEW_THEMES) {
      vi.stubEnv("QCMS_PORTAL_THEME", theme);
      expect(previewPortalTheme()).toBe(theme);
    }
  });

  it("falls back to the base theme when the knob is unset or blank", () => {
    vi.stubEnv("QCMS_PORTAL_THEME", undefined);
    expect(previewPortalTheme()).toBe(DEFAULT_PREVIEW_THEME);
    vi.stubEnv("QCMS_PORTAL_THEME", "");
    expect(previewPortalTheme()).toBe(DEFAULT_PREVIEW_THEME);
  });

  it("degrades a typo to the base theme rather than throwing", () => {
    vi.stubEnv("QCMS_PORTAL_THEME", "chartreuse");
    expect(previewPortalTheme()).toBe(DEFAULT_PREVIEW_THEME);
  });
});
