// Resolves `theme.css` per theme and mode and runs the core appearance module's contrast check on the result, so a
// palette edit that drops a pair below target fails here.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APPEARANCE_COLOR_TOKENS,
  checkPalette,
  type AppearancePalette,
  type PaletteKind,
} from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

const THEME_CSS = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

const THEMES = ["slate", "harbor", "sand", "plum"] as const;
type Theme = (typeof THEMES)[number];

type Mode = "light" | "dark" | "hc" | "dark-hc";

// Both arguments are (0,1,0) and `:is()` takes its most specific one, so the ADR-38
// anchor weighs exactly what a bare `:root` would. The model below asserts that.

const SCOPE_ANCHOR = ":is(:root, [data-qcms-theme-scope])";

/**
 * A model that counts `.` and `[` characters cannot tell `:is()` from `:where()`, and
 * this feeds the resolution the WCAG ratios are computed from, so a re-ranking would
 * certify the wrong colour pairs while the suite stayed green.
 */
type Specificity = readonly [number, number, number];

const ZERO: Specificity = [0, 0, 0];
const ID: Specificity = [1, 0, 0];
const CLASS: Specificity = [0, 1, 0];
const TYPE: Specificity = [0, 0, 1];

function plus(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const NAME_CHARACTER = /[\w-]/u;

function endOfName(selector: string, from: number): number {
  let index = from;
  while (index < selector.length && NAME_CHARACTER.test(selector[index])) index += 1;
  return index;
}

/**
 * The sheet's selectors carry no bracket or parenthesis inside a quoted string, so
 * nesting depth alone is enough, and the anchor-shape assertion keeps it so.
 */
function endOfGroup(selector: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let index = from; index < selector.length; index += 1) {
    if (selector[index] === open) depth += 1;
    else if (selector[index] === close && --depth === 0) return index + 1;
  }
  return selector.length;
}

/** Top-level commas only, never one inside `:is(...)`. */
function splitList(list: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const character = list[index];
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(list.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function mostSpecific(list: string): Specificity {
  let best = ZERO;
  for (const part of splitList(list)) {
    const weight = specificityOf(part);
    if (compareSpecificity(weight, best) > 0) best = weight;
  }
  return best;
}

interface Step {
  readonly weight: Specificity;
  readonly next: number;
}

const MATCHING_FUNCTIONS = new Set([":is", ":not", ":has"]);

function pseudoAt(selector: string, at: number): Step {
  if (selector.startsWith("::", at)) {
    return { weight: TYPE, next: endOfName(selector, at + 2) };
  }
  const nameEnd = endOfName(selector, at + 1);
  const name = selector.slice(at, nameEnd);
  if (selector[nameEnd] !== "(") return { weight: CLASS, next: nameEnd };
  const groupEnd = endOfGroup(selector, nameEnd, "(", ")");
  const argument = selector.slice(nameEnd + 1, groupEnd - 1);
  if (name === ":where") return { weight: ZERO, next: groupEnd };
  if (MATCHING_FUNCTIONS.has(name)) return { weight: mostSpecific(argument), next: groupEnd };
  return { weight: CLASS, next: groupEnd };
}

/** A combinator weighs nothing. */
function stepAt(selector: string, at: number): Step {
  const character = selector[at];
  if (character === "#") return { weight: ID, next: endOfName(selector, at + 1) };
  if (character === ".") return { weight: CLASS, next: endOfName(selector, at + 1) };
  if (character === "[") return { weight: CLASS, next: endOfGroup(selector, at, "[", "]") };
  if (character === ":") return pseudoAt(selector, at);
  if (NAME_CHARACTER.test(character)) return { weight: TYPE, next: endOfName(selector, at) };
  return { weight: ZERO, next: at + 1 };
}

/** Per CSS Selectors Level 4 section 17. */
function specificityOf(selector: string): Specificity {
  let total = ZERO;
  let index = 0;
  while (index < selector.length) {
    const step = stepAt(selector, index);
    total = plus(total, step.weight);
    index = step.next;
  }
  return total;
}

interface Block {
  readonly index: number;
  readonly selector: string;
  /** `null` applies to every theme. */
  readonly theme: Theme | null;
  /** `null` applies to every mode, as a light block also matches dark in CSS. */
  readonly mode: Mode | null;
  readonly corners: string | null;
  readonly density: string | null;
  /**
   * Only one condition exists, and the spacing group asserts that, so a second cannot
   * be added without deciding what it means for the resolution below.
   */
  readonly media: string | null;
  readonly specificity: Specificity;
  readonly tokens: Readonly<Record<string, string>>;
}

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

function modeOf(selector: string): Mode | null {
  const dark = selector.includes(".dark");
  const high = selector.includes(".hc");
  if (dark && high) return "dark-hc";
  if (high) return "hc";
  if (dark) return "dark";
  return null;
}

/**
 * A `.dark` block matches `dark hc` too, and so does a `.hc` one, which equality on the
 * block's own mode would miss: the whole point of the two-axis model is that the dark
 * field inherits both layers and overrides only what has to flip.
 */
function appliesInMode(blockMode: Mode | null, mode: Mode): boolean {
  if (blockMode === null) return true;
  if (blockMode === "light") return mode === "light";
  if (blockMode === "dark") return mode === "dark" || mode === "dark-hc";
  if (blockMode === "hc") return mode === "hc" || mode === "dark-hc";
  return mode === "dark-hc";
}

/**
 * A rule inside `@media` is captured with its condition rather than dropped, or a viewport that lowers a floor
 * would stay green. Scanned brace by brace, because a `selector {body}` regex over a nesting sheet is what the
 * lint rejects.
 */
function collectRules(css: string, media: string | null, out: Block[]): void {
  let index = 0;
  while (index < css.length) {
    const brace = css.indexOf("{", index);
    if (brace < 0) return;
    const prelude = css.slice(index, brace).trim();
    const end = endOfGroup(css, brace, "{", "}");
    const body = css.slice(brace + 1, end - 1);
    if (prelude.startsWith("@")) {
      collectRules(body, prelude, out);
    } else if (prelude.length > 0) {
      const themeMatch = /\[data-theme="(?<theme>[^"]+)"\]/u.exec(prelude);
      const cornersMatch = /\.(?<corners>radius-[\w-]+)/u.exec(prelude);
      const densityMatch = /\.(?<density>density-[\w-]+)/u.exec(prelude);
      out.push({
        index: out.length,
        selector: prelude,
        theme: (themeMatch?.groups?.theme as Theme | undefined) ?? null,
        mode: modeOf(prelude),
        corners: cornersMatch?.groups?.corners ?? null,
        density: densityMatch?.groups?.density ?? null,
        media,
        specificity: specificityOf(prelude),
        tokens: parseDeclarations(body),
      });
    }
    index = end;
  }
}

/**
 * Every rule is captured, not only those whose selector starts with the anchor, so a
 * block that loses the carrier fails the guard below instead of vanishing from the
 * resolution.
 */
function parseBlocks(css: string): readonly Block[] {
  const blocks: Block[] = [];
  collectRules(css.replaceAll(/\/\*[\s\S]*?\*\//gu, ""), null, blocks);
  return blocks;
}

const BLOCKS = parseBlocks(THEME_CSS);

/**
 * Resolved the way a browser does, by specificity then source order, so the equally specific `.hc` layer emitted
 * last beats a theme's light block. Corners, density and `@media` blocks are excluded (each asserted separately),
 * or the last preset in source order would apply to every contrast assertion.
 */
function resolveFrom(
  blocks: readonly Block[],
  theme: Theme,
  mode: Mode,
): Readonly<Record<string, string>> {
  const applicable = blocks
    .filter(
      (block) =>
        block.corners === null &&
        block.density === null &&
        block.media === null &&
        (block.theme === null || block.theme === theme) &&
        appliesInMode(block.mode, mode),
    )
    .sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.index - b.index);
  return Object.assign({}, ...applicable.map((block) => block.tokens)) as Record<string, string>;
}

function resolve(theme: Theme, mode: Mode): Readonly<Record<string, string>> {
  return resolveFrom(BLOCKS, theme, mode);
}

const MODES: readonly Mode[] = ["light", "dark", "hc", "dark-hc"];
const HIGH_CONTRAST_MODES: readonly Mode[] = ["hc", "dark-hc"];
const PALETTE_KIND: Readonly<Record<Mode, PaletteKind>> = {
  light: "light",
  dark: "dark",
  hc: "lightHighContrast",
  "dark-hc": "darkHighContrast",
};

function paletteOf(tokens: Readonly<Record<string, string>>): AppearancePalette {
  return Object.fromEntries(
    APPEARANCE_COLOR_TOKENS.map((token) => [token, tokens[`--color-${token}`] ?? ""]),
  ) as AppearancePalette;
}

describe("the scope carrier and the specificity model it is measured with", () => {
  it("anchors every rule in the sheet on the scope carrier", () => {
    expect(BLOCKS.length).toBeGreaterThan(0);
    for (const block of BLOCKS) {
      expect(
        block.selector.startsWith(SCOPE_ANCHOR),
        `${block.selector} is not anchored on ${SCOPE_ANCHOR}`,
      ).toBe(true);
    }
  });

  it("weighs the carrier exactly as the bare :root it replaced", () => {
    expect(specificityOf(SCOPE_ANCHOR)).toStrictEqual([0, 1, 0]);
    expect(specificityOf(":root")).toStrictEqual([0, 1, 0]);
  });

  // Softening the anchor to `:where()` would drop every block in the sheet to
  // specificity 0 and re-rank it against an adopter's `:root`.
  it("takes :is() from its most specific argument and :where() as zero", () => {
    expect(specificityOf(":is(p, .a.b)")).toStrictEqual([0, 2, 0]);
    expect(specificityOf(":not(.a, #b)")).toStrictEqual([1, 0, 0]);
    expect(specificityOf(":where(:root, [data-qcms-theme-scope])")).toStrictEqual([0, 0, 0]);
    expect(specificityOf(`${SCOPE_ANCHOR}[data-theme="harbor"].hc`)).toStrictEqual([0, 3, 0]);
  });

  it("scores every anchored selector exactly as its pre-rewrite :root form scored", () => {
    for (const block of BLOCKS) {
      const asRoot = block.selector.replace(SCOPE_ANCHOR, ":root");
      expect(specificityOf(block.selector), block.selector).toStrictEqual(specificityOf(asRoot));
    }
  });

  /** The sheet's layout, as six groups rather than as a comment. */
  it("emits the colour layer in the six fixed groups, in order", () => {
    const group = (block: Block): number => {
      if (block.mode === null) return block.theme === null ? 0 : 1;
      if (block.mode === "dark") return 1;
      if (block.mode === "hc") return block.theme === null ? 2 : 4;
      return block.theme === null ? 3 : 5;
    };
    const colour = BLOCKS.filter(
      (block) =>
        block.media === null &&
        block.corners === null &&
        block.density === null &&
        Object.keys(block.tokens).some((token) => token.startsWith("--color-")),
    );
    const groups = colour.map(group);
    expect(groups).toStrictEqual([...groups].sort((a, b) => a - b));
    expect(new Set(groups)).toStrictEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  /** From the top-level rules only, because the claim is about the colour layer's source order. */
  function sharedHighContrastFirst(): readonly Block[] {
    const sheet = BLOCKS.filter((block) => block.media === null);
    const isShared = (block: Block): boolean =>
      block.theme === null && block.mode !== null && HIGH_CONTRAST_MODES.includes(block.mode);
    return parseBlocks(
      [...sheet.filter(isShared), ...sheet.filter((block) => !isShared(block))]
        .map(
          (block) =>
            `${block.selector} {${Object.entries(block.tokens)
              .map(([name, value]) => ` ${name}: ${value};`)
              .join("")} }`,
        )
        .join("\n"),
    );
  }

  it("resolves every theme and mode identically whatever the order of the shared HC blocks", () => {
    const reordered = sharedHighContrastFirst();
    for (const theme of THEMES) {
      for (const mode of MODES) {
        expect(resolveFrom(reordered, theme, mode), `${theme}/${mode}`).toStrictEqual(
          resolve(theme, mode),
        );
      }
    }
  });
});

describe("colour group: every shipped palette passes the appearance module's contrast check", () => {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      it(`${theme} / ${mode}`, () => {
        const failures = checkPalette(paletteOf(resolve(theme, mode)), PALETTE_KIND[mode]).map(
          (failure) =>
            `${failure.foreground} / ${failure.background} = ${failure.ratio.toFixed(2)}:1, needs ${String(failure.required)}:1`,
        );
        expect(failures, `${theme}/${mode}`).toStrictEqual([]);
      });
    }
  }
});

describe("every theme ships its own high-contrast palettes", () => {
  const COLOR_TOKENS = APPEARANCE_COLOR_TOKENS.map((token) => `--color-${token}`);

  function ownBlock(theme: Theme, mode: Mode): Block | undefined {
    const owner = theme === "slate" ? null : theme;
    return BLOCKS.find(
      (block) => block.theme === owner && block.mode === mode && block.media === null,
    );
  }

  it.each(THEMES.flatMap((theme) => HIGH_CONTRAST_MODES.map((mode) => [theme, mode] as const)))(
    "%s declares a full %s palette in its own block",
    (theme, mode) => {
      const block = ownBlock(theme, mode);
      expect(block, `${theme} has no ${mode} block`).toBeDefined();
      for (const token of [...COLOR_TOKENS, "--color-ghost", "--color-overlay"]) {
        expect(block?.tokens[token], `${theme}/${mode} does not set ${token}`).toBeDefined();
      }
    },
  );

  it.each(HIGH_CONTRAST_MODES)("resolves each theme's %s palette from its own block", (mode) => {
    for (const theme of THEMES) {
      const block = ownBlock(theme, mode);
      const resolved = resolve(theme, mode);
      for (const token of COLOR_TOKENS) {
        expect(resolved[token], `${theme}/${mode} ${token}`).toBe(block?.tokens[token]);
      }
    }
  });
});

describe("typography group: the WCAG 1.4.12 floors are carried by tokens", () => {
  const base = resolve("slate", "light");
  const rem = (value: string): number => Number.parseFloat(value.replace("rem", "")) * 16;

  const flat = (value: string): string => value.replaceAll(/\s+/gu, " ").trim();

  it("declares the family tokens, and both delegate their tail to one token", () => {
    expect(base["--font-portal"]).toBe("var(--font-fallback-sans)");
    expect(base["--font-mono"]).toBe("var(--font-fallback-mono)");
  });

  it("every fallback tail names a CSS generic, last except for symbol faces", () => {
    // The only entry that can serve a script none of the named faces cover, because a
    // user's own per-script preference answers it.
    const symbolFaces = new Set([
      '"Apple Color Emoji"',
      '"Segoe UI Emoji"',
      '"Segoe UI Symbol"',
      '"Noto Color Emoji"',
    ]);
    const expected: Readonly<Record<string, string>> = {
      "--font-fallback-sans": "sans-serif",
      "--font-fallback-serif": "serif",
      "--font-fallback-mono": "monospace",
    };
    for (const [token, generic] of Object.entries(expected)) {
      const families = flat(base[token] ?? "")
        .split(",")
        .map((family) => family.trim());
      expect(families, `${token} is not declared`).not.toEqual([""]);
      const at = families.indexOf(generic);
      expect(at, `${token} never names ${generic}: ${base[token] ?? ""}`).toBeGreaterThanOrEqual(0);
      for (const trailing of families.slice(at + 1)) {
        expect(symbolFaces, `${token} has "${trailing}" after ${generic}`).toContain(trailing);
      }
    }
  });

  it("the sans tail does not lead with system-ui", () => {
    // It resolves from the OS locale rather than the content language and used to
    // short-circuit the rest of the list for non-Latin text (Mozilla bug 1724907). It
    // stays, because Firefox has no `ui-sans-serif`, but never in front or alone.
    const families = flat(base["--font-fallback-sans"] ?? "").split(", ");
    expect(families[0]).toBe("ui-sans-serif");
    expect(families).toContain("system-ui");
    expect(families.length).toBeGreaterThan(2);
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

  // A token, so the feature is unconditional across the registry and an adopter can
  // turn it off in one place.
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

describe("spacing group: the three density levels x the two viewports", () => {
  const base = resolve("slate", "light");
  const SPACING_TOKENS = [
    "--space-control-h",
    "--space-control-pad-x",
    "--space-field-gap",
    "--space-section-pad",
    "--space-stack",
  ] as const;
  const DENSITY_CLASSES = ["density-compact", "density-spacious"] as const;

  const BREAKPOINT = "@media (min-width: 40rem)";
  const VIEWPORTS = ["narrow", "wide"] as const;
  type Viewport = (typeof VIEWPORTS)[number];

  /** Resolved rather than read off one block, because two contribute at the wide end. */
  function at(density: string | null, viewport: Viewport): Readonly<Record<string, string>> {
    const applicable = BLOCKS.filter(
      (block) =>
        block.theme === null &&
        block.mode === null &&
        block.corners === null &&
        (block.density === null || block.density === density) &&
        (block.media === null || viewport === "wide"),
    ).sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.index - b.index);
    return Object.assign({}, ...applicable.map((block) => block.tokens)) as Record<string, string>;
  }

  it("declares all five spacing tokens", () => {
    for (const token of SPACING_TOKENS) {
      expect(base[token], `${token} is missing from the spacing group`).toBeDefined();
    }
  });

  it("Compact and Spacious each override all five tokens", () => {
    for (const density of DENSITY_CLASSES) {
      const block = BLOCKS.find(
        (candidate) => candidate.density === density && candidate.media === null,
      );
      expect(block, `no ${density} block in theme.css`).toBeDefined();
      for (const token of SPACING_TOKENS) {
        expect(block?.tokens[token], `the ${density} block does not set ${token}`).toBeDefined();
      }
    }
  });

  // A density level that could set a --type-* token could lower a 1.4.12 floor and one
  // that could set a --color-* token could break a contrast pair, and both are asserted
  // elsewhere against the base blocks only.
  it("a density level sets ONLY spacing tokens (never a type, colour or radius value)", () => {
    for (const block of BLOCKS.filter((candidate) => candidate.density !== null)) {
      for (const token of Object.keys(block.tokens)) {
        expect(
          SPACING_TOKENS.includes(token as (typeof SPACING_TOKENS)[number]),
          `the ${block.density} block sets ${token}, which is not one of the five spacing tokens`,
        ).toBe(true);
      }
    }
  });

  // Every floor assertion above resolves the sheet at the narrow end, so a media query
  // that could set a --type-* or --color-* token could move a floor at a width nothing
  // here measures. That is why only one condition is permitted.
  it("the sheet has exactly one media query, and it sets ONLY spacing tokens", () => {
    const conditions = new Set(
      BLOCKS.map((block) => block.media).filter((media) => media !== null),
    );
    expect([...conditions]).toStrictEqual([BREAKPOINT]);
    for (const block of BLOCKS.filter((candidate) => candidate.media !== null)) {
      for (const token of Object.keys(block.tokens)) {
        expect(
          SPACING_TOKENS.includes(token as (typeof SPACING_TOKENS)[number]),
          `${BREAKPOINT} sets ${token}, which is not one of the five spacing tokens`,
        ).toBe(true);
      }
    }
  });

  it("the control height clears the WCAG 2.5.8 target-size floor at EVERY density x viewport", () => {
    for (const viewport of VIEWPORTS) {
      for (const density of [null, ...DENSITY_CLASSES]) {
        const height = Number.parseFloat(at(density, viewport)["--space-control-h"]);
        expect(
          height,
          `--space-control-h at ${density ?? "comfortable"} / ${viewport}`,
        ).toBeGreaterThanOrEqual(24);
      }
    }
  });

  // A monotonic scale rather than three unrelated presets, which catches a value edited in the wrong block. Both
  // ends are checked, since a narrow override that flattened two levels would leave a phone user two identical looks.
  it("the three levels are ordered Compact < Comfortable < Spacious at both viewports", () => {
    for (const viewport of VIEWPORTS) {
      const levels = [
        at("density-compact", viewport),
        at(null, viewport),
        at("density-spacious", viewport),
      ];
      for (const token of SPACING_TOKENS) {
        const values = levels.map((level) => Number.parseFloat(level[token]));
        expect(values[0], `${token} at ${viewport}: compact < comfortable`).toBeLessThan(values[1]);
        expect(values[1], `${token} at ${viewport}: comfortable < spacious`).toBeLessThan(
          values[2],
        );
      }
    }
  });

  it("only --space-section-pad moves with the viewport, and only downward on a phone", () => {
    for (const density of [null, ...DENSITY_CLASSES]) {
      const narrow = at(density, "narrow");
      const wide = at(density, "wide");
      for (const token of SPACING_TOKENS) {
        if (token === "--space-section-pad") continue;
        expect(narrow[token], `${token} at ${density ?? "comfortable"}`).toBe(wide[token]);
      }
      expect(
        Number.parseFloat(narrow["--space-section-pad"]),
        `--space-section-pad at ${density ?? "comfortable"}`,
      ).toBeLessThan(Number.parseFloat(wide["--space-section-pad"]));
    }
    expect(at(null, "narrow")["--space-section-pad"]).toBe("1.25rem");
    expect(at(null, "wide")["--space-section-pad"]).toBe("2.25rem");
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
      expect(block, `no ${preset} block in theme.css`).toBeDefined();
      for (const token of RADIUS_TOKENS) {
        expect(block?.tokens[token], `the ${preset} block does not set ${token}`).toBeDefined();
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
