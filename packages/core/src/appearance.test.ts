import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  APPEARANCE_COLOR_TOKENS,
  APPEARANCE_FACES,
  Appearance,
  AppearancePalettes,
  CONTRAST_PAIRS,
  CONTRAST_THRESHOLDS,
  PALETTE_KINDS,
  checkPalette,
  checkPalettes,
  contrastRatio,
  deriveAppearance,
  mapFace,
  meetsContrast,
  parseAppearance,
  relativeLuminance,
  requiredRatio,
} from "./appearance.js";

const twoDp = (value: number): number => Math.floor(value * 100) / 100;

describe("WCAG contrast", () => {
  it.each([
    ["#000000", "#ffffff", 21],
    ["#ffffff", "#ffffff", 1],
    ["#767676", "#ffffff", 4.54],
    ["#777777", "#ffffff", 4.47],
    ["#595959", "#ffffff", 7],
    ["#949494", "#ffffff", 3.03],
    ["#0000ff", "#ffffff", 8.59],
    ["#ff0000", "#ffffff", 3.99],
  ])("%s on %s is %s:1", (foreground, background, expected) => {
    expect(twoDp(contrastRatio(foreground, background))).toBe(expected);
    expect(twoDp(contrastRatio(background, foreground))).toBe(expected);
  });

  it("computes relative luminance at the ends and on the linear segment", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#0a0a0a")).toBeCloseTo(10 / 255 / 12.92, 10);
  });

  it("places the thresholds where WCAG 2.2 puts them", () => {
    expect(CONTRAST_THRESHOLDS).toStrictEqual({
      text: 4.5,
      largeText: 3,
      nonText: 3,
      highContrastText: 7,
    });
    expect(meetsContrast("#767676", "#ffffff", 4.5)).toBe(true);
    expect(meetsContrast("#777777", "#ffffff", 4.5)).toBe(false);
  });

  it("refuses a colour that is not six-digit hex", () => {
    expect(() => relativeLuminance("#fff")).toThrow(TypeError);
    expect(() => contrastRatio("red", "#ffffff")).toThrow(TypeError);
  });

  it("asks 7:1 of text only in high contrast, and 3:1 of non-text everywhere", () => {
    const text = CONTRAST_PAIRS.find((pair) => pair.kind === "text");
    const nonText = CONTRAST_PAIRS.find((pair) => pair.kind === "non-text");
    if (text === undefined || nonText === undefined) throw new Error("no pairs");
    expect(requiredRatio("light", text)).toBe(4.5);
    expect(requiredRatio("dark", text)).toBe(4.5);
    expect(requiredRatio("lightHighContrast", text)).toBe(7);
    expect(requiredRatio("darkHighContrast", text)).toBe(7);
    for (const kind of PALETTE_KINDS) expect(requiredRatio(kind, nonText)).toBe(3);
  });

  it("measures the text pairs against the page background, so a tint is in the check", () => {
    const onPage = CONTRAST_PAIRS.filter((pair) => pair.background === "background");
    expect(onPage.map((pair) => pair.foreground)).toEqual(
      expect.arrayContaining(["text", "text-muted", "border-strong", "focus-ring", "primary"]),
    );
  });
});

function failuresOf(palettes: AppearancePalettes): string[] {
  return checkPalettes(palettes).map(
    (failure) =>
      `${failure.palette} ${failure.foreground}/${failure.background} ${failure.ratio.toFixed(2)} < ${String(failure.required)}`,
  );
}

describe("derivation", () => {
  it("derives four passing palettes from an ordinary brand colour, leaving light untouched", () => {
    const derived = deriveAppearance({ primary: "#2c6e63" });
    expect(failuresOf(derived.palettes)).toStrictEqual([]);
    expect(derived.report.corrections.filter((entry) => entry.palette === "light")).toStrictEqual(
      [],
    );
    expect(derived.palettes.light.primary).toBe("#2c6e63");
    expect(derived.face).toBe("system");
    expect(derived.report.face).toStrictEqual({ requested: null, mapped: "system" });
    expect(derived.report.tintDropped).toStrictEqual([]);
  });

  it("corrects light yellow on white and reports what moved", () => {
    const derived = deriveAppearance({ primary: "#FFF59D", background: "#ffffff" });
    expect(failuresOf(derived.palettes)).toStrictEqual([]);
    const primary = derived.report.corrections.find(
      (entry) => entry.palette === "light" && entry.token === "primary",
    );
    expect(primary?.from).toBe("#fff59d");
    expect(primary?.to).toBe(derived.palettes.light.primary);
    expect(contrastRatio(derived.palettes.light.primary, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(derived.palettes.light.background).toBe("#ffffff");
  });

  it("corrects a light text seed in the palette it belongs to", () => {
    const derived = deriveAppearance({ primary: "#2c6e63", text: "#757575" });
    expect(failuresOf(derived.palettes)).toStrictEqual([]);
    expect(derived.report.corrections).toContainEqual(
      expect.objectContaining({ palette: "light", token: "text", from: "#757575" }),
    );
  });

  it("corrects a mid grey brand, text and page", () => {
    const derived = deriveAppearance({
      primary: "#808080",
      text: "#5a5a5a",
      background: "#808080",
    });
    expect(failuresOf(derived.palettes)).toStrictEqual([]);
    const moved = derived.report.corrections.map((entry) => `${entry.palette}:${entry.token}`);
    expect(moved).toEqual(expect.arrayContaining(["light:primary", "light:background"]));
    for (const entry of derived.report.corrections) {
      expect(entry.to).not.toBe(entry.from);
      expect(derived.palettes[entry.palette][entry.token]).toBe(entry.to);
    }
  });

  it("reaches 7:1 on every text pair in both high-contrast palettes", () => {
    const derived = deriveAppearance({ primary: "#ffeb3b", pageTint: true });
    for (const kind of ["lightHighContrast", "darkHighContrast"] as const) {
      const palette = derived.palettes[kind];
      for (const pair of CONTRAST_PAIRS.filter((candidate) => candidate.kind === "text")) {
        expect(
          contrastRatio(palette[pair.foreground], palette[pair.background]),
          `${kind} ${pair.foreground}/${pair.background}`,
        ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("keeps a tint that every pair survives", () => {
    const plain = deriveAppearance({ primary: "#1f5eb8" });
    const tinted = deriveAppearance({ primary: "#1f5eb8", pageTint: true });
    expect(failuresOf(tinted.palettes)).toStrictEqual([]);
    expect(tinted.pageTint).toBe(true);
    expect(tinted.report.tintDropped).not.toContain("light");
    expect(tinted.palettes.light.background).not.toBe(plain.palettes.light.background);
  });

  it("drops the tint rather than move a colour when a pair would fail on the tinted page", () => {
    // #6a6a6a passes on white and its muted shade, and fails on an 8% blue wash.
    const derived = deriveAppearance({
      primary: "#1f5eb8",
      text: "#6a6a6a",
      background: "#ffffff",
      pageTint: true,
    });
    expect(failuresOf(derived.palettes)).toStrictEqual([]);
    expect(derived.report.tintDropped).toContain("light");
    expect(derived.palettes.light.background).toBe("#ffffff");
    expect(derived.palettes.light.text).toBe("#6a6a6a");
  });

  it("maps the seed's face into the registry", () => {
    expect(deriveAppearance({ primary: "#2c6e63", fontFamily: '"Open Sans", Arial' }).face).toBe(
      "opensans",
    );
    const unknown = deriveAppearance({ primary: "#2c6e63", fontFamily: "Comic Sans MS" });
    expect(unknown.face).toBe("system");
    expect(unknown.report.face).toStrictEqual({ requested: "Comic Sans MS", mapped: "system" });
  });

  it("refuses a seed with an unknown key", () => {
    expect(() => deriveAppearance({ primary: "#2c6e63", title: "x" } as never)).toThrow();
  });

  it("always yields passing palettes and an honest report (property)", () => {
    const hex = fc
      .tuple(fc.nat(255), fc.nat(255), fc.nat(255))
      .map(
        (channels) =>
          `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
      );
    fc.assert(
      fc.property(
        fc.record(
          { primary: hex, secondary: hex, text: hex, background: hex, pageTint: fc.boolean() },
          { requiredKeys: ["primary"] },
        ),
        (seed) => {
          const derived = deriveAppearance(seed);
          expect(failuresOf(derived.palettes)).toStrictEqual([]);
          expect(AppearancePalettes.safeParse(derived.palettes).success).toBe(true);
          for (const entry of derived.report.corrections) {
            expect(entry.from).not.toBe(entry.to);
            expect(derived.palettes[entry.palette][entry.token]).toBe(entry.to);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("face mapping", () => {
  it("maps registry keys and families, first match in a font-family list", () => {
    expect(mapFace("lexend")).toBe("lexend");
    expect(mapFace("Atkinson Hyperlegible")).toBe("atkinson");
    expect(mapFace("'IBM Plex Serif', Georgia, serif")).toBe("ibmplexserif");
    expect(mapFace("Helvetica Neue, Inter, sans-serif")).toBe("inter");
    expect(mapFace("Baloo 2")).toBe("baloo2");
  });

  it("maps anything outside the registry to System", () => {
    expect(mapFace("Papyrus")).toBe("system");
    expect(mapFace("system-ui")).toBe("system");
    expect(mapFace("")).toBe("system");
    expect(mapFace(null)).toBe("system");
    expect(mapFace(undefined)).toBe("system");
  });
});

function validAppearance(): Record<string, unknown> & { palettes: AppearancePalettes } {
  return {
    palettes: deriveAppearance({ primary: "#2c6e63" }).palettes,
    logo: null,
    face: "atkinson",
    corners: "subtle",
    density: "comfortable",
    textSize: 16,
    progress: "side-rail",
    pageTint: false,
  };
}

describe("the Appearance schema", () => {
  it("accepts a complete appearance and a logo key", () => {
    expect(parseAppearance(validAppearance()).ok).toBe(true);
    expect(parseAppearance({ ...validAppearance(), logo: "a".repeat(64) }).ok).toBe(true);
  });

  it("refuses unknown keys at every level", () => {
    const base = validAppearance();
    const { palettes } = base;
    expect(parseAppearance({ ...base, theme: "harbor" }).ok).toBe(false);
    expect(
      parseAppearance({
        ...base,
        palettes: { ...palettes, light: { ...palettes.light, "brand-glow": "#ffffff" } },
      }).ok,
    ).toBe(false);
    expect(parseAppearance({ ...base, palettes: { ...palettes, sepia: palettes.light } }).ok).toBe(
      false,
    );
  });

  it.each([15, 25, 16.5, "18"])("refuses a text size of %s", (textSize) => {
    const result = parseAppearance({ ...validAppearance(), textSize });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_APPEARANCE");
  });

  it.each([16, 20, 24])("accepts a text size of %s", (textSize) => {
    expect(parseAppearance({ ...validAppearance(), textSize }).ok).toBe(true);
  });

  it("refuses a face outside the registry", () => {
    expect(parseAppearance({ ...validAppearance(), face: "comicsans" }).ok).toBe(false);
    expect(parseAppearance({ ...validAppearance(), face: "Atkinson Hyperlegible" }).ok).toBe(false);
  });

  it("refuses a missing token, a non-hex colour and a malformed logo key", () => {
    const base = validAppearance();
    const { palettes } = base;
    const missing: Record<string, string> = { ...palettes.light };
    delete missing.primary;
    expect(parseAppearance({ ...base, palettes: { ...palettes, light: missing } }).ok).toBe(false);
    expect(
      parseAppearance({
        ...base,
        palettes: { ...palettes, dark: { ...palettes.dark, text: "white" } },
      }).ok,
    ).toBe(false);
    expect(parseAppearance({ ...base, logo: "logo.png" }).ok).toBe(false);
  });

  it("refuses unknown corners, density and progress values", () => {
    expect(parseAppearance({ ...validAppearance(), corners: "wobbly" }).ok).toBe(false);
    expect(parseAppearance({ ...validAppearance(), density: "auto" }).ok).toBe(false);
    expect(parseAppearance({ ...validAppearance(), progress: "bar" }).ok).toBe(false);
  });

  it("holds a palette of exactly the colour tokens, and System heads the face list", () => {
    const { palettes } = validAppearance();
    expect(Object.keys(palettes)).toStrictEqual([...PALETTE_KINDS]);
    expect(Object.keys(palettes.light).sort()).toStrictEqual([...APPEARANCE_COLOR_TOKENS].sort());
    expect(APPEARANCE_FACES[0]).toStrictEqual({ key: "system", family: null });
  });

  it("leaves contrast to the check: a structurally valid failing palette parses and fails it", () => {
    const { palettes } = validAppearance();
    const failing = { ...palettes.light, "text-muted": "#c0c0c0" };
    expect(Appearance.shape.palettes.shape.light.safeParse(failing).success).toBe(true);
    expect(checkPalette(failing, "light")).toContainEqual(
      expect.objectContaining({
        palette: "light",
        foreground: "text-muted",
        background: "surface",
        required: 4.5,
      }),
    );
  });
});
