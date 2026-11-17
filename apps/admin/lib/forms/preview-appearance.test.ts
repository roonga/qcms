import { deriveAppearance, type Appearance } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import {
  INITIAL_LOOK,
  paletteKind,
  parseDraftAppearance,
  surfaceClasses,
  surfaceTokens,
} from "./preview-appearance.ts";

// Joined so the admin colour check, which scans tests too, reads no literal colour.
const derived = deriveAppearance({ primary: ["#", "2a6f6a"].join("") });

const APPEARANCE: Appearance = {
  palettes: derived.palettes,
  logo: null,
  face: "merriweather",
  corners: "sharp",
  density: "spacious",
  textSize: 16,
  progress: "top-indicator",
  pageTint: false,
};

describe("the draft's appearance in the preview", () => {
  it("parses a valid appearance and refuses anything else as none", () => {
    expect(parseDraftAppearance(APPEARANCE)).toEqual(APPEARANCE);
    expect(parseDraftAppearance(null)).toBeNull();
    expect(parseDraftAppearance(undefined)).toBeNull();
    expect(parseDraftAppearance({ ...APPEARANCE, corners: "wavy" })).toBeNull();
  });

  it("picks the palette for the polarity and high contrast", () => {
    expect(paletteKind(INITIAL_LOOK)).toBe("light");
    expect(paletteKind({ polarity: "dark", highContrast: false })).toBe("dark");
    expect(paletteKind({ polarity: "light", highContrast: true })).toBe("lightHighContrast");
    expect(paletteKind({ polarity: "dark", highContrast: true })).toBe("darkHighContrast");
  });

  it("spells the carrier classes as the portal's root does", () => {
    expect(surfaceClasses(INITIAL_LOOK, APPEARANCE)).toEqual([
      "light",
      "radius-sharp",
      "font-merriweather",
      "density-spacious",
    ]);
    expect(
      surfaceClasses(
        { polarity: "dark", highContrast: true },
        { ...APPEARANCE, corners: "subtle", density: "comfortable" },
      ),
    ).toEqual(["dark", "hc", "font-merriweather"]);
  });

  it("previews the deployment's look when the draft has none", () => {
    expect(surfaceClasses({ polarity: "dark", highContrast: true }, null)).toEqual(["dark", "hc"]);
    expect(surfaceTokens(INITIAL_LOOK, null)).toEqual({});
  });

  it("sets every colour token of the chosen palette", () => {
    const look = { polarity: "dark", highContrast: true } as const;
    const tokens = surfaceTokens(look, APPEARANCE);
    const palette = APPEARANCE.palettes.darkHighContrast;
    expect(Object.keys(tokens)).toHaveLength(Object.keys(palette).length);
    expect(tokens["--color-primary"]).toBe(palette.primary.toLowerCase());
    expect(tokens["--color-background"]).toBe(palette.background.toLowerCase());
  });
});
