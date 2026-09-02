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

/**
 * The scope carrier every block in `theme.css` is anchored on (ADR-38, task 060).
 * `:root` and `[data-qcms-theme-scope]` are both (0,1,0) and `:is()` takes its most
 * specific argument, so the anchor weighs exactly what the bare `:root` it replaced
 * weighed. `the specificity model` below asserts that rather than trusting it.
 */
const SCOPE_ANCHOR = ":is(:root, [data-qcms-theme-scope])";

/**
 * A CSS specificity, as the (id, class, type) triple the specification defines:
 * `.a` counts in the middle column, so do attribute selectors and plain
 * pseudo-classes, `#a` in the first, element names and pseudo-elements in the last.
 *
 * This replaces a hand-rolled model that counted `.` and `[` characters in the
 * selector string and returned a single number. That model was wrong in the way
 * that matters here: it cannot tell `:is()` (most specific argument) from
 * `:where()` (always zero), and it fed the theme x mode resolution that the WCAG
 * ratios below are computed FROM - so a re-ranking would have certified the wrong
 * colour pairs while the suite stayed green, rather than failing.
 */
type Specificity = readonly [number, number, number];

const ZERO: Specificity = [0, 0, 0];
const ID: Specificity = [1, 0, 0];
const CLASS: Specificity = [0, 1, 0];
const TYPE: Specificity = [0, 0, 1];

function plus(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Negative when `a` loses to `b`, zero when the cascade falls through to order. */
function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const NAME_CHARACTER = /[\w-]/u;

/** The index just past the identifier starting at `from`. */
function endOfName(selector: string, from: number): number {
  let index = from;
  while (index < selector.length && NAME_CHARACTER.test(selector[index])) index += 1;
  return index;
}

/**
 * The index just past the balanced group opening at `from`. The sheet's selectors
 * carry no bracket or parenthesis inside a quoted string, so nesting depth alone
 * is enough; `parseBlocks` asserts the anchor shape, which is what keeps it so.
 */
function endOfGroup(selector: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let index = from; index < selector.length; index += 1) {
    if (selector[index] === open) depth += 1;
    else if (selector[index] === close && --depth === 0) return index + 1;
  }
  return selector.length;
}

/** Split a selector list on its top-level commas (never one inside `:is(...)`). */
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

/** The weight of the most specific selector in a list, which is what `:is()` takes. */
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

/** Functional pseudo-classes that take the weight of their most specific argument. */
const MATCHING_FUNCTIONS = new Set([":is", ":not", ":has"]);

/** One pseudo-class or pseudo-element starting at `at`. */
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

/** One simple selector (or a combinator, which weighs nothing) starting at `at`. */
function stepAt(selector: string, at: number): Step {
  const character = selector[at];
  if (character === "#") return { weight: ID, next: endOfName(selector, at + 1) };
  if (character === ".") return { weight: CLASS, next: endOfName(selector, at + 1) };
  if (character === "[") return { weight: CLASS, next: endOfGroup(selector, at, "[", "]") };
  if (character === ":") return pseudoAt(selector, at);
  if (NAME_CHARACTER.test(character)) return { weight: TYPE, next: endOfName(selector, at) };
  return { weight: ZERO, next: at + 1 };
}

/** The specificity of one complex selector, per CSS Selectors Level 4 section 17. */
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
  /** `null` = applies to every theme (the bare anchor default blocks). */
  readonly theme: Theme | null;
  /** `null` = applies to every mode (a light block also matches dark, as in CSS). */
  readonly mode: Mode | null;
  /** A corners preset class (`radius-pill`), or `null` for the base blocks. */
  readonly corners: string | null;
  /** A density level class (`density-compact`), or `null` for the base blocks. */
  readonly density: string | null;
  /**
   * The `@media` condition the rule sits inside, or `null` at the top level of the
   * sheet. Only one condition exists today - the `--space-section-pad` breakpoint
   * (issue #188) - and `the spacing group` asserts that, so a second one cannot be
   * added without also deciding what it means for the resolution below.
   */
  readonly media: string | null;
  readonly specificity: Specificity;
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
 * Collect the style rules in one nesting level, recursing into an at-rule body so a
 * rule inside `@media` is captured with the condition that gates it rather than
 * silently dropped. Dropping was the previous behaviour and it was the dangerous
 * one: a media block whose declarations vanish from the parse cannot fail any guard
 * in this file, so the sheet could grow a viewport that lowers a floor and stay
 * green. Rules keep source order across levels, which is what the cascade needs.
 *
 * Scanned brace by brace rather than split on `}`: the sheet nests now, and a
 * `selector {body}` regex over the whole file is the shape ESLint rejects for
 * backtracking.
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
 * Parse a sheet into cascade-ordered blocks. Comments are stripped first, and
 * EVERY rule is captured rather than only those whose selector starts with the
 * anchor - so a block that quietly loses the scope carrier is picked up here and
 * fails `the scope carrier` guard below instead of vanishing from the resolution.
 */
function parseBlocks(css: string): readonly Block[] {
  const blocks: Block[] = [];
  collectRules(css.replaceAll(/\/\*[\s\S]*?\*\//gu, ""), null, blocks);
  return blocks;
}

const BLOCKS = parseBlocks(THEME_CSS);

/**
 * The token values in force for one theme x mode, resolved the way the browser
 * resolves them: every block whose selector matches contributes, ordered by
 * specificity and then by source order. That ordering is why the shared `.hc`
 * layer (equally specific, emitted last) beats a theme's light block.
 *
 * The corners and density blocks are excluded because neither class is on the
 * root in this resolution: this is the Subtle / Comfortable baseline, and each of
 * those two groups is asserted separately against its own blocks below. Leaving
 * either one in would silently apply the LAST preset in source order to every
 * contrast and floor assertion in the file.
 *
 * A rule inside `@media` is excluded for the same reason and resolved separately by
 * `the spacing group`: this is the narrow baseline, and a viewport override applied
 * unconditionally here would be an override no viewport actually has.
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
        (block.mode === null || block.mode === mode),
    )
    .sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.index - b.index);
  return Object.assign({}, ...applicable.map((block) => block.tokens)) as Record<string, string>;
}

function resolve(theme: Theme, mode: Mode): Readonly<Record<string, string>> {
  return resolveFrom(BLOCKS, theme, mode);
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

  // The property ADR-38 turns on, and the one the old character-counting model
  // could not express: `:is()` takes its most specific argument, `:where()` is
  // always zero. Softening the anchor to `:where()` would drop every block in the
  // sheet to specificity 0 and silently re-rank it against an adopter's `:root`.
  it("takes :is() from its most specific argument and :where() as zero", () => {
    expect(specificityOf(":is(p, .a.b)")).toStrictEqual([0, 2, 0]);
    expect(specificityOf(":not(.a, #b)")).toStrictEqual([1, 0, 0]);
    expect(specificityOf(":where(:root, [data-qcms-theme-scope])")).toStrictEqual([0, 0, 0]);
    expect(specificityOf(`${SCOPE_ANCHOR}[data-theme="harbor"].hc`)).toStrictEqual([0, 3, 0]);
  });

  // Exit criterion 2, asserted rather than assumed: the rewrite moved no selector.
  it("scores every anchored selector exactly as its pre-rewrite :root form scored", () => {
    for (const block of BLOCKS) {
      const asRoot = block.selector.replace(SCOPE_ANCHOR, ":root");
      expect(specificityOf(block.selector), block.selector).toStrictEqual(specificityOf(asRoot));
    }
  });

  // What `docs/theming.md` records as load-bearing: the shared `.hc` layer and a
  // theme's own light block are EQUALLY specific, so only source order separates
  // them. If this ever came out non-zero, the ordering guarantee below would be
  // decided by specificity instead and the comment in `theme.css` would be a lie.
  it("leaves the shared .hc layer exactly as specific as a theme's light block", () => {
    const shared = specificityOf(`${SCOPE_ANCHOR}.hc`);
    const themed = specificityOf(`${SCOPE_ANCHOR}[data-theme="harbor"]`);
    expect(compareSpecificity(shared, themed)).toBe(0);
    expect(compareSpecificity(specificityOf(SCOPE_ANCHOR), shared)).toBeLessThan(0);
  });

  /**
   * The same blocks re-emitted with the shared `.hc` layer BEFORE the light/dark
   * blocks: a sheet that is valid CSS, declares identical values, and is wrong.
   *
   * Re-emitted from the top-level rules only. What this proves is a claim about the
   * colour layer's source order, and the media block carries no colour; flattening
   * it to the top level would make the re-emitted sheet say something the real one
   * does not, for no gain in the property under test.
   */
  function misordered(): readonly Block[] {
    const sheet = BLOCKS.filter((block) => block.media === null);
    const hc = sheet.filter((block) => block.mode === "hc" && block.theme === null);
    const rest = sheet.filter((block) => !(block.mode === "hc" && block.theme === null));
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

  // Exit criterion 3's proof obligation: a green suite is not evidence, a suite
  // shown capable of going red is. Feed the resolver a deliberately mis-ordered
  // sheet and it must produce the WRONG answer - which is what makes its answer on
  // the real sheet worth something. Both HC guarantees this file certifies (black
  // on white, and one shared layer across themes) collapse under the mis-ordering.
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

describe("spacing group: the three density levels x the two viewports", () => {
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

  /**
   * The one breakpoint the sheet has (issue #188): Tailwind's `sm`, so the token
   * turns over at the same width the step card's old `sm:p-8` turned over at.
   */
  const BREAKPOINT = "@media (min-width: 40rem)";
  /** Below the breakpoint no media rule applies; at or above it, that one does. */
  const VIEWPORTS = ["narrow", "wide"] as const;
  type Viewport = (typeof VIEWPORTS)[number];

  /**
   * The five spacing values in force at one density level and one viewport (task
   * 053, then issue #188). Resolved from the blocks rather than read off one of
   * them, because two now contribute at the wide end and the later one wins.
   */
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
          `the ${block.density} block sets ${token}, which is not one of the five spacing tokens`,
        ).toBe(true);
      }
    }
  });

  // The same boundary for the viewport axis, and the reason the WCAG floors this
  // file certifies survive issue #188. Every floor assertion above resolves the
  // sheet at the narrow end; a media query that could set a --type-* or --color-*
  // token could therefore move a floor or a contrast pair at a width nothing here
  // measures. Restricting the media block to the spacing group is what makes
  // "checked once" honest, and it is why only ONE condition is permitted: a second
  // one would need its own decision about which end of it the floors are read at.
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

  // Density is a monotonic scale, not three unrelated presets: Compact is smaller
  // than Comfortable is smaller than Spacious on every token. This is what makes
  // the control a meaningful choice rather than three arbitrary looks, and it
  // catches a value edited in the wrong block. Checked at BOTH ends of the
  // breakpoint, which is the property issue #188's decision turns on: a narrow
  // override that flattened two levels together would leave a respondent on a
  // phone choosing between two looks that render the same.
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

  // Issue #188 itself: the step card's padding is smaller on a phone than at the
  // breakpoint, at every density, and --space-section-pad is the only token that
  // moves. The narrow Comfortable value is the p-5 the card carried before task
  // 051, so this is a restoration rather than a new number.
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
