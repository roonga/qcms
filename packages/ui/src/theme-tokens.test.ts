/**
 * The token contract, measured rather than asserted (task 051, ADR-30).
 *
 * This suite reads `theme.css` itself, resolves the cascade the way a browser
 * would for every theme x mode combination, and then COMPUTES the WCAG 2.2
 * relative-luminance contrast ratio of every critical pair from the shipped
 * values. A palette edit that drops a pair below its target fails here instead of
 * reaching a respondent, and the numbers in `docs/theming.md` and the design
 * deliverable can never quietly diverge from the CSS.
 *
 * Targets (from the design deliverable): Light and Dark are AA - 4.5:1 for body
 * text, 3:1 for UI, borders and focus. High-contrast is the AAA layer - 7:1 for
 * every text pair, 3:1 for UI.
 *
 * The typography group is checked the same way: the five WCAG 1.4.12 floors are
 * numeric requirements, so the token values are parsed and compared, not trusted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const THEME_CSS = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

const THEMES = ["slate", "harbor", "sand", "plum"] as const;
type Theme = (typeof THEMES)[number];
type Mode = "light" | "dark" | "hc";

interface Block {
  readonly index: number;
  /** `null` = applies to every theme (the bare `:root` default blocks). */
  readonly theme: Theme | null;
  /** `null` = applies to every mode (a light block also matches dark, as in CSS). */
  readonly mode: Mode | null;
  /** A corners preset class (`radius-pill`), or `null` for the base blocks. */
  readonly corners: string | null;
  /** A density level class (`density-compact`), or `null` for the base blocks. */
  readonly density: string | null;
  readonly specificity: number;
  readonly tokens: Readonly<Record<string, string>>;
}

/** The custom properties declared in one block body, `--name: value` per entry. */
function parseDeclarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const line of body.split(";")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    tokens[name] = line.slice(colon + 1).trim();
  }
  return tokens;
}

/** The mode a selector selects, or `null` when it applies to every mode. */
function modeOf(selector: string): Mode | null {
  if (selector.includes(".hc")) return "hc";
  if (selector.includes(".dark")) return "dark";
  return null;
}

/**
 * Selector specificity, counted the only way these selectors need it: each is
 * `:root` plus zero or more classes and attribute selectors, and each of those
 * raises specificity by one. That is enough to order
 * `:root` < `:root.hc` < `:root[data-theme="x"].hc`.
 */
function specificityOf(selector: string): number {
  return selector.split(".").length - 1 + (selector.split("[").length - 1);
}

/** Parse `theme.css` into cascade-ordered blocks. Comments are stripped first. */
function parseBlocks(css: string): readonly Block[] {
  const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
  const blocks: Block[] = [];
  const blockPattern = /(?<selector>:root[^{]*)\{(?<body>[^}]*)\}/gu;
  let match = blockPattern.exec(withoutComments);
  for (let index = 0; match !== null; index += 1, match = blockPattern.exec(withoutComments)) {
    const selector = (match.groups?.selector ?? "").trim();
    const themeMatch = /\[data-theme="(?<theme>[^"]+)"\]/u.exec(selector);
    const cornersMatch = /\.(?<corners>radius-[\w-]+)/u.exec(selector);
    const densityMatch = /\.(?<density>density-[\w-]+)/u.exec(selector);
    blocks.push({
      index,
      theme: (themeMatch?.groups?.theme as Theme | undefined) ?? null,
      mode: modeOf(selector),
      corners: cornersMatch?.groups?.corners ?? null,
      density: densityMatch?.groups?.density ?? null,
      specificity: specificityOf(selector),
      tokens: parseDeclarations(match.groups?.body ?? ""),
    });
  }
  return blocks;
}

const BLOCKS = parseBlocks(THEME_CSS);

/**
 * The token values in force for one theme x mode, resolved the way the browser
 * resolves them: every block whose selector matches contributes, ordered by
 * specificity and then by source order. That ordering is why the shared `.hc`
 * layer (specificity 1, emitted last) beats a theme's light block (also 1).
 *
 * The corners and density blocks are excluded because neither class is on the
 * root in this resolution: this is the Subtle / Comfortable baseline, and each of
 * those two groups is asserted separately against its own blocks below. Leaving
 * either one in would silently apply the LAST preset in source order to every
 * contrast and floor assertion in the file.
 */
function resolve(theme: Theme, mode: Mode): Readonly<Record<string, string>> {
  const applicable = BLOCKS.filter(
    (block) =>
      block.corners === null &&
      block.density === null &&
      (block.theme === null || block.theme === theme) &&
      (block.mode === null || block.mode === mode),
  ).sort((a, b) => a.specificity - b.specificity || a.index - b.index);
  return Object.assign({}, ...applicable.map((block) => block.tokens)) as Record<string, string>;
}

/** sRGB relative luminance (WCAG 2.x definition). */
function luminance(hex: string): number {
  const value = hex.trim().replace("#", "");
  expect(value, `token value ${hex} is not a 6-digit hex colour`).toMatch(/^[0-9a-f]{6}$/iu);
  const channels = [0, 2, 4].map((offset) => {
    const srgb = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.040_45 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio, rounded down to 2dp so a reported number never flatters. */
function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return Math.floor(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/** The critical pairs, as `[foreground, background, label]`. */
const TEXT_PAIRS = [
  ["--color-text", "--color-background", "text / background"],
  ["--color-text", "--color-surface", "text / surface"],
  ["--color-text-muted", "--color-background", "text-muted / background"],
  ["--color-text-muted", "--color-surface", "text-muted / surface"],
  ["--color-primary-foreground", "--color-primary", "primary-fg / primary"],
  ["--color-secondary-foreground", "--color-secondary", "secondary-fg / secondary"],
  ["--color-danger-foreground", "--color-danger", "danger-fg / danger"],
  ["--color-danger-fg", "--color-danger-subtle", "danger-fg / danger-subtle"],
  ["--color-info-fg", "--color-info-subtle", "info-fg / info-subtle"],
  ["--color-success-fg", "--color-success-subtle", "success-fg / success-subtle"],
  ["--color-warning-fg", "--color-warning-subtle", "warning-fg / warning-subtle"],
] as const;

const UI_PAIRS = [
  ["--color-border-strong", "--color-surface", "border-strong / surface"],
  ["--color-border-strong", "--color-background", "border-strong / background"],
  ["--color-focus-ring", "--color-background", "focus-ring / background"],
  ["--color-focus-ring", "--color-surface", "focus-ring / surface"],
  ["--color-primary", "--color-surface", "primary / surface (link + primary UI)"],
] as const;

const MODES: readonly Mode[] = ["light", "dark", "hc"];
/** Body-text target per mode: AA everywhere, AAA in the High-contrast layer. */
const TEXT_TARGET: Readonly<Record<Mode, number>> = { light: 4.5, dark: 4.5, hc: 7 };
const UI_TARGET = 3;

describe("colour group: every critical pair meets its WCAG 2.2 target", () => {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      it(`${theme} / ${mode}`, () => {
        const tokens = resolve(theme, mode);
        for (const [fg, bg, label] of TEXT_PAIRS) {
          const ratio = contrast(tokens[fg], tokens[bg]);
          expect(
            ratio,
            `${theme}/${mode} ${label} (${tokens[fg]} on ${tokens[bg]}) = ${ratio}:1, needs ${TEXT_TARGET[mode]}:1`,
          ).toBeGreaterThanOrEqual(TEXT_TARGET[mode]);
        }
        for (const [fg, bg, label] of UI_PAIRS) {
          const ratio = contrast(tokens[fg], tokens[bg]);
          expect(
            ratio,
            `${theme}/${mode} ${label} (${tokens[fg]} on ${tokens[bg]}) = ${ratio}:1, needs ${UI_TARGET}:1`,
          ).toBeGreaterThanOrEqual(UI_TARGET);
        }
      });
    }
  }
});

describe("High-contrast is one mode layer, not a palette per theme", () => {
  const ACCENT = new Set([
    "--color-primary",
    "--color-primary-hover",
    "--color-primary-active",
    "--color-primary-foreground",
  ]);

  it("every theme resolves to the identical HC palette apart from its accent", () => {
    const slate = resolve("slate", "hc");
    for (const theme of THEMES.filter((candidate) => candidate !== "slate")) {
      const other = resolve(theme, "hc");
      for (const token of Object.keys(slate).filter((name) => name.startsWith("--color-"))) {
        if (ACCENT.has(token)) continue;
        expect(other[token], `${theme}/hc diverges from the shared HC layer at ${token}`).toBe(
          slate[token],
        );
      }
    }
  });

  it("an alternate theme's HC block contributes ONLY accent tokens", () => {
    for (const block of BLOCKS.filter((candidate) => candidate.mode === "hc")) {
      if (block.theme === null) continue;
      for (const token of Object.keys(block.tokens)) {
        expect(
          ACCENT.has(token),
          `${block.theme}/hc overrides ${token}, which is not an accent`,
        ).toBe(true);
      }
    }
  });

  it("the HC layer is theme-agnostic black on white with heavy separators", () => {
    const hc = resolve("slate", "hc");
    expect(hc["--color-text"]).toBe("#000000");
    expect(hc["--color-surface"]).toBe("#ffffff");
    expect(hc["--color-background"]).toBe("#ffffff");
    expect(hc["--color-border-strong"]).toBe("#000000");
  });
});

describe("typography group: the WCAG 1.4.12 floors are carried by tokens", () => {
  const base = resolve("slate", "light");
  const rem = (value: string): number => Number.parseFloat(value.replace("rem", "")) * 16;

  it("declares the family token", () => {
    expect(base["--font-portal"]).toContain("system-ui");
  });

  it("body and label text are at least 16px", () => {
    expect(rem(base["--type-body"])).toBeGreaterThanOrEqual(16);
    expect(rem(base["--type-label"])).toBeGreaterThanOrEqual(16);
  });

  it("hint text is at least 14px and never the body size", () => {
    expect(rem(base["--type-hint"])).toBeGreaterThanOrEqual(14);
    expect(rem(base["--type-hint"])).toBeLessThan(rem(base["--type-body"]));
  });

  it("line-height is at least 1.5", () => {
    expect(Number.parseFloat(base["--type-line-height"])).toBeGreaterThanOrEqual(1.5);
  });

  it("letter-spacing is at least 0.12em", () => {
    expect(Number.parseFloat(base["--type-letter-spacing"])).toBeGreaterThanOrEqual(0.12);
  });

  it("word-spacing is at least 0.16em", () => {
    expect(Number.parseFloat(base["--type-word-spacing"])).toBeGreaterThanOrEqual(0.16);
  });

  it("paragraph spacing is at least 2em", () => {
    expect(Number.parseFloat(base["--type-paragraph-spacing"])).toBeGreaterThanOrEqual(2);
  });

  // Task 052: numeric controls get tabular figures from a token, so the feature is
  // unconditional across the font registry and an adopter can turn it off in one
  // place. `font-registry.test.ts` proves theme-components.css consumes it.
  it("declares the tabular-figures token, and no mode or theme turns it off", () => {
    expect(base["--type-numeric"]).toBe('"tnum"');
    for (const theme of THEMES) {
      for (const mode of MODES) {
        expect(resolve(theme, mode)["--type-numeric"], `${theme}/${mode}`).toBe('"tnum"');
      }
    }
  });

  it("no mode or theme lowers a floor", () => {
    for (const theme of THEMES) {
      for (const mode of MODES) {
        const tokens = resolve(theme, mode);
        expect(tokens["--type-line-height"], `${theme}/${mode}`).toBe(base["--type-line-height"]);
        expect(tokens["--type-letter-spacing"], `${theme}/${mode}`).toBe(
          base["--type-letter-spacing"],
        );
        expect(tokens["--type-word-spacing"], `${theme}/${mode}`).toBe(base["--type-word-spacing"]);
        expect(tokens["--type-body"], `${theme}/${mode}`).toBe(base["--type-body"]);
      }
    }
  });
});

describe("spacing group: the three density levels", () => {
  const base = resolve("slate", "light");
  const SPACING_TOKENS = [
    "--space-control-h",
    "--space-control-pad-x",
    "--space-field-gap",
    "--space-section-pad",
    "--space-stack",
  ] as const;
  /** Compact and Spacious are classes; Comfortable is the base block. */
  const DENSITY_CLASSES = ["density-compact", "density-spacious"] as const;

  /** The five spacing values in force at one density level (task 053). */
  function atDensity(density: string | null): Readonly<Record<string, string>> {
    if (density === null) return base;
    const block = BLOCKS.find((candidate) => candidate.density === density);
    expect(block, `no :root.${density} block in theme.css`).toBeDefined();
    return { ...base, ...block!.tokens };
  }

  it("declares all five spacing tokens", () => {
    for (const token of SPACING_TOKENS) {
      expect(base[token], `${token} is missing from the spacing group`).toBeDefined();
    }
  });

  it("Compact and Spacious each override all five tokens", () => {
    for (const density of DENSITY_CLASSES) {
      const block = BLOCKS.find((candidate) => candidate.density === density);
      expect(block, `no :root.${density} block in theme.css`).toBeDefined();
      for (const token of SPACING_TOKENS) {
        expect(block?.tokens[token], `:root.${density} does not set ${token}`).toBeDefined();
      }
    }
  });

  // The boundary that keeps density out of the other three groups. A density level
  // that could set a --type-* token could lower a WCAG 1.4.12 floor, and one that
  // could set a --color-* token could break a contrast pair; both are asserted
  // elsewhere in this file against the base blocks only, so the guarantee those
  // assertions give is only as good as this one.
  it("a density level sets ONLY spacing tokens (never a type, colour or radius value)", () => {
    for (const block of BLOCKS.filter((candidate) => candidate.density !== null)) {
      for (const token of Object.keys(block.tokens)) {
        expect(
          SPACING_TOKENS.includes(token as (typeof SPACING_TOKENS)[number]),
          `:root.${block.density} sets ${token}, which is not one of the five spacing tokens`,
        ).toBe(true);
      }
    }
  });

  it("the control height clears the WCAG 2.5.8 target-size floor at EVERY density", () => {
    for (const density of [null, ...DENSITY_CLASSES]) {
      const height = Number.parseFloat(atDensity(density)["--space-control-h"]);
      expect(height, `--space-control-h at ${density ?? "comfortable"}`).toBeGreaterThanOrEqual(24);
    }
  });

  // Density is a monotonic scale, not three unrelated presets: Compact is smaller
  // than Comfortable is smaller than Spacious on every token. This is what makes
  // the control a meaningful choice rather than three arbitrary looks, and it
  // catches a value edited in the wrong block.
  it("the three levels are ordered Compact < Comfortable < Spacious on every token", () => {
    const levels = [atDensity("density-compact"), base, atDensity("density-spacious")];
    for (const token of SPACING_TOKENS) {
      const values = levels.map((level) => Number.parseFloat(level[token]));
      expect(values[0], `${token}: compact < comfortable`).toBeLessThan(values[1]);
      expect(values[1], `${token}: comfortable < spacious`).toBeLessThan(values[2]);
    }
  });
});

describe("radius group: the four corner presets", () => {
  const RADIUS_TOKENS = ["--radius-control", "--radius-card", "--radius-sm"] as const;

  it("Subtle is the base and declares all three tokens", () => {
    const base = resolve("slate", "light");
    for (const token of RADIUS_TOKENS) expect(base[token]).toBeDefined();
  });

  it("Sharp, Rounded and Pill each override all three tokens", () => {
    for (const preset of ["radius-sharp", "radius-rounded", "radius-pill"]) {
      const block = BLOCKS.find((candidate) => candidate.corners === preset);
      expect(block, `no :root.${preset} block in theme.css`).toBeDefined();
      for (const token of RADIUS_TOKENS) {
        expect(block?.tokens[token], `:root.${preset} does not set ${token}`).toBeDefined();
      }
    }
  });

  it("no radius preset carries a colour (geometry only, so no contrast impact)", () => {
    for (const block of BLOCKS.filter((candidate) => candidate.corners !== null)) {
      for (const token of Object.keys(block.tokens)) {
        expect(token.startsWith("--radius-"), `${block.corners} sets ${token}`).toBe(true);
      }
    }
  });
});
