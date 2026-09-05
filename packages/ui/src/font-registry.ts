/**
 * The declarative font registry (task 052, ADR-30 group 2).
 *
 * THIS FILE IS THE MANIFEST. Adding or removing a font is a one-entry change
 * here plus (for an addition) the `woff2` next to it in `src/fonts/`; everything
 * else is derived:
 *
 *   - `src/fonts.css` is GENERATED from this array by `renderFontsCss()`
 *     (`pnpm --filter @roonga/qcms-ui fonts:generate` writes it), and
 *     `font-registry.test.ts` fails if the committed CSS and this manifest
 *     disagree, so the two can never drift;
 *   - the portal's curation config (`QCMS_PORTAL_FONTS` / `QCMS_PORTAL_FONT` in
 *     `apps/portal/lib/server/theme.ts`) validates against these keys;
 *   - task 053's respondent font control renders `fontChoices()`.
 *
 * EVERY FONT IS SELF-HOSTED. The `woff2` binaries are committed under
 * `src/fonts/`, so a portal makes ZERO external requests for a typeface: no CDN,
 * no build-time fetch, nothing for a CSP to allow (SEC-9) and nothing that can
 * make CI depend on a third-party host. `apps/portal/e2e/fonts.pw.ts` proves the
 * request count in a real browser.
 *
 * LICENSING. Every family is open-licensed and MIT-redistributable. Each entry
 * carries its upstream copyright notice verbatim, and the license texts the
 * notices refer to ship beside the binaries (`src/fonts/LICENSE-OFL-1.1.txt`,
 * `src/fonts/LICENSE-Apache-2.0.txt`), which is what OFL-1.1 and Apache-2.0 each
 * require of a redistribution. `src/fonts/NOTICE.md` is the human-readable roll-up.
 *
 * WHAT A FONT MAY AND MAY NOT CHANGE. A registry entry sets exactly one token,
 * `--font-portal`. It may not touch a `--type-*` value, because those carry the
 * WCAG 1.4.12 floors (body >= 16px, line-height >= 1.5, letter-spacing >= 0.12em,
 * word-spacing >= 0.16em, paragraph spacing >= 2em) and no font selection is
 * allowed to lower one. The generated CSS is asserted to declare nothing but
 * `--font-portal` per block, and the browser suite re-measures every floor under
 * every shipped font.
 *
 * SCRIPT COVERAGE. The shipped `woff2` files are the Latin subsets, so text
 * outside Latin falls back glyph-by-glyph through the entry's fallback stack -
 * correct, but not yet a designed baseline. A deliberate multi-script fallback
 * baseline is issue #27 and is NOT owned here.
 *
 * Contract documentation: docs/theming.md.
 */

/** Display order of the groups (also the order the generated CSS is emitted in). */
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
 * The license of a shipped family, as an SPDX identifier or expression. Both
 * OFL-1.1 and Apache-2.0 are permissive and compatible with QCMS's MIT
 * redistribution; nothing else may be added without the CONTRIBUTING license
 * check, and `font-registry.test.ts` enforces the allow-list.
 */
export type FontLicense = "OFL-1.1" | "Apache-2.0" | "OFL-1.1 OR Apache-2.0";

/** One self-hosted static weight: the file sits at `src/fonts/<file>`. */
export interface FontFace {
  readonly weight: number;
  readonly file: string;
}

/** One registry entry. This is the whole unit of add/remove. */
export interface FontEntry {
  /** CSS-class-safe token: the class is `font-<key>`, and 053's select value. */
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
 * The three fallback tails. A tail always ends in a CSS generic family, so a
 * respondent whose browser refuses the webfont still gets the right *kind* of
 * face rather than the UA default. `SANS_TAIL` is byte-identical to the
 * `--font-portal` value the base anchor block of `theme.css` declares, which is
 * what makes System a no-download entry rather than a special case.
 */
const SANS_TAIL = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF_TAIL = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
const MONO_TAIL = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

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
   * Set for a VARIABLE font, where upstream serves one file that covers every
   * weight: all the declared weights then point at this single file, exactly as
   * Google Fonts' own css2 output does (two `@font-face` rules, one `src`). The
   * browser downloads it once and instantiates the `wght` axis per rule. Without
   * this, each weight gets its own `<key>-<weight>.woff2`.
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
 * Families, keys, weights, groups and licenses come from the font design
 * deliverable (`plan/theme-palettes/fonts_config.py`), and the binaries are the
 * Latin `woff2` subsets that deliverable retrieved. Two things the deliverable
 * does not carry are authored here: the Monospace group, and the fallback stack
 * on every entry.
 *
 * Weights follow the deliverable's rule: the Accessibility faces ship 400 and
 * 700 because weight itself carries legibility for low-vision and dyslexic
 * readers, and every other family ships 400 only to keep the self-hosted payload
 * small. Bold text in the other families is synthesised by the browser.
 */
export const FONT_REGISTRY: readonly FontEntry[] = [
  SYSTEM_ENTRY,

  // --- Accessibility: 400 + 700, because weight carries legibility here. ---
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
    // Lexend is a VARIABLE font upstream: one file carries the whole wght axis,
    // and Google's css2 returns the same URL for 400 and 700. Shipping it once and
    // pointing both faces at it is upstream's own arrangement, and it is why this
    // is the only entry with an explicit file name.
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

  // --- Popular ---
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
    // The deliverable records Apache-2.0; upstream has since relicensed Roboto
    // under OFL-1.1 (google/fonts now ships `ofl/roboto/OFL.txt`). Both grants
    // are permissive and MIT-compatible and BOTH license texts ship beside the
    // binaries, so the redistribution is covered whichever one applies to these
    // bytes. This is the only entry that is not a single identifier.
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

  // --- Playful & Kids ---
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

  // --- Traditional & Corporate ---
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

  // --- Monospace: authored here; the design deliverable has no Monospace group. ---
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
 * The respondent-facing subset an operator has curated, in registry order, with
 * System guaranteed present.
 *
 * The curation contract, which the portal's `QCMS_PORTAL_FONTS` reads and task
 * 053's control renders:
 *
 *   - an empty or all-unknown selection means "offer everything" (the shipped
 *     default), never "offer nothing";
 *   - an unknown key is ignored rather than fatal, matching the rest of the
 *     presentation config: a typo must not take a deployment down;
 *   - System is ALWAYS in the result and cannot be curated away, because it is
 *     the only entry guaranteed to render without a download.
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
 * The scope carrier every generated block is anchored on (ADR-38). `:root` and
 * `[data-qcms-theme-scope]` are both specificity (0,1,0) and `:is()` takes its
 * most specific argument, so this anchor is exactly as specific as the bare
 * `:root` it replaced. Never `:where()`, which is specificity 0.
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
 * Exported so an adopter who extends the manifest can regenerate the stylesheet
 * with their own entries appended, rather than hand-writing `@font-face` rules.
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
