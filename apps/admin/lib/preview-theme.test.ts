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

/**
 * The preview island's vocabulary and its one configuration input (task 058).
 *
 * Two properties are worth asserting below the browser, and the e2e spec asserts
 * neither because neither is observable there:
 *
 * 1. **The UNSET case.** Exit criterion 1 requires the base theme when the deployment
 *    knob is absent, and the browser harness deliberately runs with it SET to a
 *    non-default value, so that both apps are proven to read config rather than a
 *    literal. The absent case therefore has to be exercised here.
 * 2. **The typo case.** A misspelt theme name must degrade a preview, not take an
 *    authoring session down, and the only way to see the difference is to pass one.
 */

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
    // No `auto`: the config layer has one because a respondent's OS can answer for
    // them, but an author exploring appearances is choosing between things a
    // deployment can serve, and "whatever this laptop prefers" is not one of them.
    expect([...PREVIEW_MODES]).toEqual(["light", "dark", "hc"]);
    expect(DEFAULT_PREVIEW_MODE).toBe("light");
  });

  it("names ADR-38's carrier attribute exactly once, here", () => {
    expect(THEME_SCOPE_ATTRIBUTE).toBe("data-qcms-theme-scope");
  });

  it("accepts every offered value and refuses everything else", () => {
    for (const theme of PREVIEW_THEMES) expect(parsePreviewTheme(theme)).toBe(theme);
    for (const mode of PREVIEW_MODES) expect(parsePreviewMode(mode)).toBe(mode);

    // `undefined` rather than a substituted default, so a caller can tell "no answer"
    // from "the base theme was chosen".
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
    // The portal does exactly this with the same variable (`lib/server/theme.ts`), and
    // the reason is the same on both sides: presentation config must never be able to
    // take a deployment down.
    vi.stubEnv("QCMS_PORTAL_THEME", "chartreuse");
    expect(previewPortalTheme()).toBe(DEFAULT_PREVIEW_THEME);
  });
});
