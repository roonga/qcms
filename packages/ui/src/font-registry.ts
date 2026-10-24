/**
 * The declarative font registry (ADR-30 group 2). Contract: docs/theming.md.
 *
 * This file is the manifest, and `src/fonts.css` is generated from it by
 * `renderFontsCss()`; `font-registry.test.ts` fails when the two disagree. Adding or
 * removing a font is a one-entry change here plus, for an addition, the `woff2` next to
 * it in `src/fonts/`.
 *
 * Every font is self-hosted, so a portal makes no external request for a typeface:
 * nothing for a CSP to allow (SEC-9) and nothing that makes CI depend on a third party.
 *
 * Licensing: every family is open-licensed and MIT-redistributable, each entry carries
 * its upstream copyright notice verbatim, and the license texts those notices refer to
 * ship beside the binaries, as OFL-1.1 and Apache-2.0 each require of a redistribution.
 *
 * An entry sets exactly one token, `--font-portal`. It may never touch a `--type-*`
 * value: those carry the WCAG 1.4.12 floors and no font selection may lower one.
 *
 * The shipped `woff2` files are Latin subsets, so other scripts fall back through the
 * entry's shared fallback token. Which non-Latin scripts QCMS self-hosts is not owned
 * here.
 */

/** Display order of the groups, and the order the generated CSS is emitted in. */
export const FONT_GROUPS = [
  "System",
  "Accessibility",
  "Popular",
  "Playful & Kids",
  "Traditional & Corporate",
  "Monospace",
] as const;

export type FontGroup = (typeof FONT_GROUPS)[number];

/**
 * The license of a shipped family, as an SPDX identifier or expression. Nothing outside
 * this allow-list may be added without the CONTRIBUTING license check.
 */
export type FontLicense = "OFL-1.1" | "Apache-2.0" | "OFL-1.1 OR Apache-2.0";

/** One self-hosted static weight: the file sits at `src/fonts/<file>`. */
export interface FontFace {
  readonly weight: number;
  readonly file: string;
}

/** One registry entry: the whole unit of add and remove. */
export interface FontEntry {
  /** CSS-class-safe token: the class is `font-<key>`. */
  readonly key: string;
  /** Respondent-facing name (`family` for a webfont, a plain label for System). */
  readonly label: string;
  /** The `font-family` name the `@font-face` declares, or `null` for System. */
  readonly family: string | null;
  readonly group: FontGroup;
  /** The full `--font-portal` value: the family first, then the fallback stack. */
  readonly stack: string;
  /** Self-hosted weights, empty for System (which downloads nothing). */
  readonly faces: readonly FontFace[];
  readonly license: FontLicense | null;
  /** The upstream copyright notice, verbatim; `null` only for System. */
  readonly copyright: string | null;
  readonly note: string;
}

/**
 * The three fallback tails, as token references rather than literal family lists. The
 * lists live in one place, the base anchor block of `theme.css`, and
 * `scripts/check-font-tokens.mjs` fails the build on a second copy.
 *
 * Because these are `var()` references, `fonts.css` works only when `theme.css` is
 * imported first; an adopter who imports `fonts.css` alone gets a `font-family` that is
 * invalid at computed-value time rather than a silent wrong font.
 */
const SANS_TAIL = "var(--font-fallback-sans)";
const SERIF_TAIL = "var(--font-fallback-serif)";
const MONO_TAIL = "var(--font-fallback-mono)";

/** The System entry's key. It is always present and can never be curated away. */
export const SYSTEM_FONT_KEY = "system";

/** The System entry: whatever the respondent's device already has, no download. */
const SYSTEM_ENTRY: FontEntry = {
  key: SYSTEM_FONT_KEY,
  label: "System default",
  family: null,
  group: "System",
  stack: SANS_TAIL,
  faces: [],
  license: null,
  copyright: null,
  note: "the device's own UI face; downloads nothing and is always available",
};

interface WebfontSpec {
  readonly key: string;
  readonly family: string;
  readonly group: Exclude<FontGroup, "System">;
  readonly tail: string;
  readonly weights: readonly number[];
  /**
   * Set for a variable font, where upstream serves one file covering every weight: all
   * declared weights then point at it. Without this, each weight gets its own
   * `<key>-<weight>.woff2`.
   */
  readonly file?: string;
  readonly license: FontLicense;
  readonly copyright: string;
  readonly note: string;
}

/** One self-hosted family: derives the stack and the per-weight file names. */
function webfont(spec: WebfontSpec): FontEntry {
  return {
    key: spec.key,
    label: spec.family,
    family: spec.family,
    group: spec.group,
    stack: `"${spec.family}", ${spec.tail}`,
    faces: spec.weights.map((weight) => ({
      weight,
      file: spec.file ?? `${spec.key}-${weight}.woff2`,
    })),
    license: spec.license,
    copyright: spec.copyright,
    note: spec.note,
  };
}

/**
 * The shipped registry.
 *
 * The Accessibility faces ship 400 and 700 because weight itself carries legibility for
 * low-vision and dyslexic readers. Every other family ships 400 only, to keep the
 * self-hosted payload small, and the browser synthesises bold.
 */
export const FONT_REGISTRY: readonly FontEntry[] = [
  SYSTEM_ENTRY,

  webfont({
    key: "atkinson",
    family: "Atkinson Hyperlegible",
    group: "Accessibility",
    tail: SANS_TAIL,
    weights: [400, 700],
    license: "OFL-1.1",
    copyright: "Copyright 2020 Braille Institute of America, Inc.",
    note: "letterforms designed to be unambiguous for low vision",
  }),
  webfont({
    key: "lexend",
    family: "Lexend",
    group: "Accessibility",
    tail: SANS_TAIL,
    weights: [400, 700],
    // Variable upstream: one file carries the whole wght axis, so both faces point at it.
    file: "lexend-variable.woff2",
    license: "OFL-1.1",
    copyright:
      "Copyright 2018 The Lexend Project Authors (https://github.com/googlefonts/lexend), with Reserved Font Name RevReading Lexend.",
    note: "tuned for reading proficiency",
  }),
  webfont({
    key: "opendyslexic",
    family: "OpenDyslexic",
    group: "Accessibility",
    tail: SANS_TAIL,
    weights: [400, 700],
    license: "OFL-1.1",
    copyright:
      "Copyright (c) 2019-07-29, Abbie Gonzalez (https://abbiecod.es|support@abbiecod.es), with Reserved Font Name OpenDyslexic.",
    note: "weighted letterforms for dyslexia",
  }),

  webfont({
    key: "inter",
    family: "Inter",
    group: "Popular",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright: "Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)",
    note: "neutral UI sans",
  }),
  webfont({
    key: "roboto",
    family: "Roboto",
    group: "Popular",
    tail: SANS_TAIL,
    weights: [400],
    // Dual-stated because upstream relicensed from Apache-2.0 to OFL-1.1: both texts
    // ship beside the binaries, so the redistribution is covered either way.
    license: "OFL-1.1 OR Apache-2.0",
    copyright:
      "Copyright 2011 The Roboto Project Authors (https://github.com/googlefonts/roboto-classic)",
    note: "Android's system sans",
  }),
  webfont({
    key: "opensans",
    family: "Open Sans",
    group: "Popular",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)",
    note: "humanist sans, very wide coverage",
  }),
  webfont({
    key: "lato",
    family: "Lato",
    group: "Popular",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      'Copyright (c) 2010-2014 by tyPoland Lukasz Dziedzic (team@latofonts.com) with Reserved Font Name "Lato"',
    note: "warm humanist sans",
  }),
  webfont({
    key: "poppins",
    family: "Poppins",
    group: "Popular",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright: "Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)",
    note: "geometric sans",
  }),
  webfont({
    key: "montserrat",
    family: "Montserrat",
    group: "Popular",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2024 The Montserrat.Git Project Authors (https://github.com/JulietaUla/Montserrat.git)",
    note: "wide geometric sans",
  }),

  webfont({
    key: "andika",
    family: "Andika",
    group: "Playful & Kids",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      'Copyright (c) 2004-2022 SIL International (http://www.sil.org/) with Reserved Font Names "Andika" and "SIL".',
    note: "SIL literacy face for early readers",
  }),
  webfont({
    key: "fredoka",
    family: "Fredoka",
    group: "Playful & Kids",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One)",
    note: "rounded and friendly",
  }),
  webfont({
    key: "baloo2",
    family: "Baloo 2",
    group: "Playful & Kids",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright: "Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2)",
    note: "chunky and playful",
  }),
  webfont({
    key: "comicneue",
    family: "Comic Neue",
    group: "Playful & Kids",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2014 The Comic Neue Project Authors (https://github.com/crozynski/comicneue)",
    note: "an open alternative to Comic Sans",
  }),
  webfont({
    key: "patrickhand",
    family: "Patrick Hand",
    group: "Playful & Kids",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright: "Copyright (c) 2010-2012 Patrick Wagesreiter (mail@patrickwagesreiter.at)",
    note: "casual handwriting",
  }),

  webfont({
    key: "merriweather",
    family: "Merriweather",
    group: "Traditional & Corporate",
    tail: SERIF_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      'Copyright 2020 The Merriweather Project Authors (https://github.com/EbenSorkin/Merriweather4) with Reserved Font Name "Merriweather".',
    note: "screen-first professional serif",
  }),
  webfont({
    key: "lora",
    family: "Lora",
    group: "Traditional & Corporate",
    tail: SERIF_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      'Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name "Lora".',
    note: "balanced contemporary serif",
  }),
  webfont({
    key: "ptserif",
    family: "PT Serif",
    group: "Traditional & Corporate",
    tail: SERIF_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      'Copyright (c) 2010, ParaType Ltd. (http://www.paratype.com/public), with Reserved Font Names "PT Sans", "PT Serif" and "ParaType".',
    note: "traditional public-sector serif",
  }),
  webfont({
    key: "librebaskerville",
    family: "Libre Baskerville",
    group: "Traditional & Corporate",
    tail: SERIF_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2012 The Libre Baskerville Project Authors (https://github.com/impallari/Libre-Baskerville) with Reserved Font Name Libre Baskerville.",
    note: "formal Baskerville revival",
  }),
  webfont({
    key: "ibmplexserif",
    family: "IBM Plex Serif",
    group: "Traditional & Corporate",
    tail: SERIF_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright: 'Copyright (c) 2017 IBM Corp. with Reserved Font Name "Plex"',
    note: "corporate serif of the IBM Plex family",
  }),
  webfont({
    key: "publicsans",
    family: "Public Sans",
    group: "Traditional & Corporate",
    tail: SANS_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans)",
    note: "neutral sans of the US Web Design System",
  }),

  webfont({
    key: "jetbrainsmono",
    family: "JetBrains Mono",
    group: "Monospace",
    tail: MONO_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)",
    note: "tall x-height monospace, unambiguous 0/O and 1/l",
  }),
  webfont({
    key: "geistmono",
    family: "Geist Mono",
    group: "Monospace",
    tail: MONO_TAIL,
    weights: [400],
    license: "OFL-1.1",
    copyright:
      "Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git)",
    note: "compact geometric monospace",
  }),
];

/** The registry entry for a key, or `undefined` when the key is not shipped. */
export function fontByKey(key: string): FontEntry | undefined {
  return FONT_REGISTRY.find((entry) => entry.key === key);
}

/**
 * The respondent-facing subset an operator has curated, in registry order.
 *
 * An empty or all-unknown selection means offer everything, never offer nothing, and an
 * unknown key is ignored rather than fatal, so a typo cannot take a deployment down.
 * System is always in the result: it is the only entry guaranteed to render with no
 * download.
 */
export function fontChoices(keys?: readonly string[]): readonly FontEntry[] {
  const wanted = new Set((keys ?? []).filter((key) => fontByKey(key) !== undefined));
  if (wanted.size === 0) return FONT_REGISTRY;
  wanted.add(SYSTEM_FONT_KEY);
  return FONT_REGISTRY.filter((entry) => wanted.has(entry.key));
}

/** The class that selects a font, matching the generated CSS. */
export function fontClass(key: string): string {
  return `font-${key}`;
}

/**
 * The scope carrier every generated block is anchored on (ADR-38). Never `:where()`,
 * whose specificity is 0: `:is()` keeps this anchor at exactly `:root`'s (0,1,0).
 */
const SCOPE_ANCHOR = ":is(:root, [data-qcms-theme-scope])";

const CSS_HEADER = `/*
 * GENERATED FILE - do not edit by hand.
 *
 * Source of truth: \`src/font-registry.ts\`. Regenerate with
 * \`pnpm --filter @roonga/qcms-ui fonts:generate\`; \`font-registry.test.ts\` fails if this
 * file and the manifest disagree, so a hand edit here cannot survive a gate.
 *
 * Every face is SELF-HOSTED from \`src/fonts/\` next to this file, so selecting a
 * font makes zero external requests (no CDN, nothing for the CSP to allow).
 * Import it after \`theme.css\`, whose base anchor block declares the System
 * stack that these classes override:
 *
 * Each block is anchored on \`:is(:root, [data-qcms-theme-scope])\`, the scope
 * carrier (ADR-38): a font selection applies to the document root OR to any
 * element carrying \`data-qcms-theme-scope\`, at exactly the specificity the bare
 * \`:root\` anchor had.
 *
 *   @import "@roonga/qcms-ui/theme.css";
 *   @import "@roonga/qcms-ui/theme-components.css";
 *   @import "@roonga/qcms-ui/fonts.css";
 *
 * A block below sets exactly one token, \`--font-portal\`. It must never set a
 * \`--type-*\` value: those carry the WCAG 1.4.12 floors, and no font selection may
 * lower one.
 *
 * Contract documentation: docs/theming.md.
 */
`;

/**
 * Render the CSS for a registry: one `@font-face` per self-hosted weight, and one
 * `:is(:root, [data-qcms-theme-scope]).font-<key>` block per entry that sets
 * `--font-portal` and nothing else.
 *
 * Exported so an adopter who extends the manifest can regenerate the stylesheet with
 * their own entries appended, rather than hand-writing `@font-face` rules.
 */
export function renderFontsCss(entries: readonly FontEntry[] = FONT_REGISTRY): string {
  const parts: string[] = [CSS_HEADER];
  for (const group of FONT_GROUPS) {
    const inGroup = entries.filter((entry) => entry.group === group);
    if (inGroup.length === 0) continue;
    parts.push(`\n/* ==========================================================================
   ${group}
   ========================================================================== */\n`);
    for (const entry of inGroup) parts.push(renderEntry(entry));
  }
  return parts.join("");
}

/** One entry: its license notice, its faces, then the selector block. */
function renderEntry(entry: FontEntry): string {
  const notice =
    entry.license === null
      ? `\n/* ${entry.label} - no webfont: ${entry.note}. */\n`
      : `\n/* ${entry.label} - ${entry.license}\n   ${entry.copyright ?? ""} */\n`;
  const faces = entry.faces
    .map(
      (face) => `@font-face {
  font-family: "${entry.family ?? ""}";
  font-style: normal;
  font-weight: ${face.weight};
  font-display: swap;
  src: url("./fonts/${face.file}") format("woff2");
}
`,
    )
    .join("");
  return `${notice}${faces}${SCOPE_ANCHOR}.${fontClass(entry.key)} {
  --font-portal: ${entry.stack};
}
`;
}
