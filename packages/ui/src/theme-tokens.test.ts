// Reads `theme.css` and computes the WCAG 2.2 contrast ratio of every critical pair, so a palette edit that drops
// a pair below target fails here. Targets: AA in Light and Dark (4.5:1 text, 3:1 UI); AAA in both High-contrast
// polarities (7:1 text, 3:1 UI).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const THEME_CSS = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

const THEMES = ["slate", "harbor", "sand", "plum"] as const;
type Theme = (typeof THEMES)[number];
/** Polarity x contrast, flattened: the four states a root class combination can select. */
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

/** Zero when the cascade falls through to source order. */
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

/** What `:is()` takes. */
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

function luminance(hex: string): number {
  const value = hex.trim().replace("#", "");
  expect(value, `token value ${hex} is not a 6-digit hex colour`).toMatch(/^[0-9a-f]{6}$/iu);
  const channels = [0, 2, 4].map((offset) => {
    const srgb = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.040_45 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Rounded down to 2dp, so a reported number never flatters. */
function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return Math.floor(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

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

const MODES: readonly Mode[] = ["light", "dark", "hc", "dark-hc"];
const HIGH_CONTRAST_MODES: readonly Mode[] = ["hc", "dark-hc"];
const TEXT_TARGET: Readonly<Record<Mode, number>> = {
  light: 4.5,
  dark: 4.5,
  hc: 7,
  "dark-hc": 7,
};
const UI_TARGET = 3;

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

  // Only source order separates these two. Non-zero here and the ordering guarantee
  // below would be decided by specificity instead, and the sheet's own note wrong.
  it("leaves the shared .hc layer exactly as specific as a theme's light block", () => {
    const shared = specificityOf(`${SCOPE_ANCHOR}.hc`);
    const themed = specificityOf(`${SCOPE_ANCHOR}[data-theme="harbor"]`);
    expect(compareSpecificity(shared, themed)).toBe(0);
    expect(compareSpecificity(specificityOf(SCOPE_ANCHOR), shared)).toBeLessThan(0);
  });

  // The tie the two-axis model rests on: a theme's light-HC accent has to reach the dark
  // field, and it does so only because it is emitted after the shared `.dark.hc` block at
  // the same weight. Decided by specificity instead and the dark field would flatten
  // every theme back to slate's accent.
  it("leaves shared .dark.hc exactly as specific as a per-theme .hc accent", () => {
    const shared = specificityOf(`${SCOPE_ANCHOR}.dark.hc`);
    const accent = specificityOf(`${SCOPE_ANCHOR}[data-theme="harbor"].hc`);
    expect(compareSpecificity(shared, accent)).toBe(0);
    expect(
      compareSpecificity(specificityOf(`${SCOPE_ANCHOR}[data-theme="harbor"].dark.hc`), shared),
    ).toBeGreaterThan(0);
  });

  /**
   * The order itself, as six groups rather than as a comment. Ties inside the colour
   * layer are resolved by source order, so an edit that appends a block in the wrong
   * place is valid CSS that certifies the wrong pairs.
   */
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

  /**
   * A sheet that is valid CSS, declares identical values, and is wrong. From the
   * top-level rules only, because the claim is about the colour layer's source order
   * and flattening the media block would make it say something the real sheet does not.
   */
  function misordered(): readonly Block[] {
    const sheet = BLOCKS.filter((block) => block.media === null);
    const isShared = (block: Block): boolean =>
      block.theme === null && block.mode !== null && HIGH_CONTRAST_MODES.includes(block.mode);
    const hc = sheet.filter((block) => isShared(block));
    const rest = sheet.filter((block) => !isShared(block));
    return parseBlocks(
      [...hc, ...rest]
        .map(
          (block) =>
            `${block.selector} {${Object.entries(block.tokens)
              .map(([name, value]) => ` ${name}: ${value};`)
              .join("")} }`,
        )
        .join("\n"),
    );
  }

  // A green suite is not evidence; one shown capable of going red is. Fed a
  // mis-ordered sheet the resolver must produce the wrong answer, which is what makes
  // its answer on the real sheet worth something.
  it("resolves a deliberately mis-ordered sheet to the wrong palette", () => {
    expect(resolve("harbor", "hc")["--color-text"]).toBe("#000000");

    const broken = misordered();
    const brokenHc = resolveFrom(broken, "harbor", "hc");
    expect(brokenHc["--color-text"]).not.toBe("#000000");
    expect(brokenHc["--color-text"]).toBe(resolveFrom(broken, "harbor", "light")["--color-text"]);
    expect(brokenHc["--color-background"]).not.toBe(
      resolveFrom(broken, "slate", "hc")["--color-background"],
    );
  });
});

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

  it.each(HIGH_CONTRAST_MODES)(
    "every theme resolves to the identical %s palette apart from its accent",
    (mode) => {
      const slate = resolve("slate", mode);
      for (const theme of THEMES.filter((candidate) => candidate !== "slate")) {
        const other = resolve(theme, mode);
        for (const token of Object.keys(slate).filter((name) => name.startsWith("--color-"))) {
          if (ACCENT.has(token)) continue;
          expect(
            other[token],
            `${theme}/${mode} diverges from the shared HC layer at ${token}`,
          ).toBe(slate[token]);
        }
      }
    },
  );

  it("an alternate theme's HC block contributes ONLY accent tokens, on either field", () => {
    for (const block of BLOCKS.filter(
      (candidate) => candidate.mode !== null && HIGH_CONTRAST_MODES.includes(candidate.mode),
    )) {
      if (block.theme === null) continue;
      for (const token of Object.keys(block.tokens)) {
        expect(
          ACCENT.has(token),
          `${block.theme}/${block.mode ?? ""} overrides ${token}, which is not an accent`,
        ).toBe(true);
      }
    }
  });

  it("the HC layers are theme-agnostic: black on white, then white on black", () => {
    const hc = resolve("slate", "hc");
    expect(hc["--color-text"]).toBe("#000000");
    expect(hc["--color-surface"]).toBe("#ffffff");
    expect(hc["--color-background"]).toBe("#ffffff");
    expect(hc["--color-border-strong"]).toBe("#000000");

    const dark = resolve("slate", "dark-hc");
    expect(dark["--color-text"]).toBe("#ffffff");
    expect(dark["--color-surface"]).toBe("#000000");
    expect(dark["--color-background"]).toBe("#000000");
    expect(dark["--color-border-strong"]).toBe("#ffffff");
  });

  /**
   * The rule a new theme follows: measure the light-HC accent against the dark-HC
   * background, and own a `.dark.hc` accent only when it misses. Asserted as the
   * measurement rather than as a list of themes, so a fifth theme is told what it owes
   * by the gate rather than by whoever reviews it.
   */
  it("gives a theme a dark-HC accent exactly when its light-HC accent misses on that field", () => {
    const target = TEXT_TARGET["dark-hc"];
    const field = resolve("slate", "dark-hc")["--color-background"];
    for (const theme of THEMES) {
      const lightAccent = resolve(theme, "hc")["--color-primary"];
      const darkAccent = resolve(theme, "dark-hc")["--color-primary"];
      const owns = BLOCKS.some(
        (block) => block.theme === theme && block.mode === "dark-hc" && block.media === null,
      );
      if (contrast(lightAccent, field) < target) {
        expect(darkAccent, `${theme}'s light-HC accent misses on the dark field`).not.toBe(
          lightAccent,
        );
      } else {
        expect(owns, `${theme} gets the dark field for free and owes no accent`).toBe(false);
      }
      expect(
        contrast(darkAccent, field),
        `${theme}'s dark-HC accent ${darkAccent} on ${field}`,
      ).toBeGreaterThanOrEqual(target);
    }
  });
});

describe("typography group: the WCAG 1.4.12 floors are carried by tokens", () => {
  const base = resolve("slate", "light");
  const rem = (value: string): number => Number.parseFloat(value.replace("rem", "")) * 16;

  /** Prettier reflows a long value, so compare on content. */
  const flat = (value: string): string => value.replaceAll(/\s+/gu, " ").trim();

  it("declares the family tokens, and both delegate their tail to one token", () => {
    // The fallback list is declared once, so a tail improvement cannot reach one
    // surface and miss another.
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

  // --space-section-pad is the only token that moves with the viewport.
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
