import { z } from "zod";

import type { Result } from "./errors.js";
import { parseWithCode } from "./internal/parse.js";

/** WCAG 2.2 minimum contrast ratios. */
export const CONTRAST_THRESHOLDS = {
  text: 4.5,
  largeText: 3,
  nonText: 3,
  highContrastText: 7,
} as const;

export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/iu);
export type HexColor = z.infer<typeof HexColor>;

/** Each name is the `--color-<name>` token of `@roonga/qcms-ui`'s theme.css; ghost and overlay are fixed there. */
export const APPEARANCE_COLOR_TOKENS = [
  "primary",
  "primary-hover",
  "primary-active",
  "primary-foreground",
  "secondary",
  "secondary-hover",
  "secondary-active",
  "secondary-foreground",
  "danger",
  "danger-hover",
  "danger-active",
  "danger-foreground",
  "danger-subtle",
  "danger-fg",
  "ghost-hover",
  "ghost-active",
  "info",
  "info-subtle",
  "info-fg",
  "success",
  "success-subtle",
  "success-fg",
  "warning",
  "warning-subtle",
  "warning-fg",
  "text",
  "text-muted",
  "border",
  "border-strong",
  "background",
  "background-muted",
  "surface",
  "surface-hover",
  "focus-ring",
] as const;
export type AppearanceColorToken = (typeof APPEARANCE_COLOR_TOKENS)[number];

export const AppearancePalette = z.strictObject(
  Object.fromEntries(APPEARANCE_COLOR_TOKENS.map((token) => [token, HexColor])) as Record<
    AppearanceColorToken,
    typeof HexColor
  >,
);
export type AppearancePalette = z.infer<typeof AppearancePalette>;

export const PALETTE_KINDS = ["light", "dark", "lightHighContrast", "darkHighContrast"] as const;
export type PaletteKind = (typeof PALETTE_KINDS)[number];

export const AppearancePalettes = z.strictObject({
  light: AppearancePalette,
  dark: AppearancePalette,
  lightHighContrast: AppearancePalette,
  darkHighContrast: AppearancePalette,
});
export type AppearancePalettes = z.infer<typeof AppearancePalettes>;

/** Mirrors `FONT_REGISTRY` in `@roonga/qcms-ui`, whose test asserts the two agree. */
export const APPEARANCE_FACES = [
  { key: "system", family: null },
  { key: "atkinson", family: "Atkinson Hyperlegible" },
  { key: "lexend", family: "Lexend" },
  { key: "opendyslexic", family: "OpenDyslexic" },
  { key: "inter", family: "Inter" },
  { key: "roboto", family: "Roboto" },
  { key: "opensans", family: "Open Sans" },
  { key: "lato", family: "Lato" },
  { key: "poppins", family: "Poppins" },
  { key: "montserrat", family: "Montserrat" },
  { key: "andika", family: "Andika" },
  { key: "fredoka", family: "Fredoka" },
  { key: "baloo2", family: "Baloo 2" },
  { key: "comicneue", family: "Comic Neue" },
  { key: "patrickhand", family: "Patrick Hand" },
  { key: "merriweather", family: "Merriweather" },
  { key: "lora", family: "Lora" },
  { key: "ptserif", family: "PT Serif" },
  { key: "librebaskerville", family: "Libre Baskerville" },
  { key: "ibmplexserif", family: "IBM Plex Serif" },
  { key: "publicsans", family: "Public Sans" },
  { key: "jetbrainsmono", family: "JetBrains Mono" },
  { key: "geistmono", family: "Geist Mono" },
] as const;

export const SYSTEM_FACE = "system";

const FACE_KEYS = APPEARANCE_FACES.map((face) => face.key) as [
  (typeof APPEARANCE_FACES)[number]["key"],
  ...(typeof APPEARANCE_FACES)[number]["key"][],
];
export const AppearanceFace = z.enum(FACE_KEYS);
export type AppearanceFace = z.infer<typeof AppearanceFace>;

export const APPEARANCE_CORNERS = ["sharp", "subtle", "rounded", "pill"] as const;
export const APPEARANCE_DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const PROGRESS_MODES = ["side-rail", "top-indicator", "none"] as const;
export const TEXT_SIZE_MIN = 16;
export const TEXT_SIZE_MAX = 24;

/** The content-addressed key of an immutable stored logo. */
export const LogoKey = z.string().regex(/^[0-9a-f]{64}$/u);

/** A form's appearance, held by value: colour tokens inline, never a theme reference. */
export const Appearance = z.strictObject({
  palettes: AppearancePalettes,
  logo: LogoKey.nullable(),
  face: AppearanceFace,
  corners: z.enum(APPEARANCE_CORNERS),
  density: z.enum(APPEARANCE_DENSITIES),
  /** The author's base size in px, before the respondent's scale. */
  textSize: z.number().int().min(TEXT_SIZE_MIN).max(TEXT_SIZE_MAX),
  progress: z.enum(PROGRESS_MODES),
  pageTint: z.boolean(),
});
export type Appearance = z.infer<typeof Appearance>;

export function parseAppearance(value: unknown): Result<Appearance> {
  return parseWithCode(Appearance, "INVALID_APPEARANCE", "Appearance", value);
}

type Rgb = readonly [number, number, number];

function rgbOf(color: string): Rgb {
  if (!HexColor.safeParse(color).success) {
    throw new TypeError(`${color} is not a 6-digit hex colour`);
  }
  return [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16)) as unknown as Rgb;
}

function hexOf(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.2 relative luminance of a 6-digit hex colour, 0 to 1. */
export function relativeLuminance(color: string): number {
  const [r, g, b] = rgbOf(color).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.040_45 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1 to 21, unrounded. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(foreground: string, background: string, minimum: number): boolean {
  return contrastRatio(foreground, background) >= minimum;
}

type Pair = readonly [AppearanceColorToken, AppearanceColorToken];

const TEXT_PAIRS: readonly Pair[] = [
  ["text", "background"],
  ["text", "background-muted"],
  ["text", "surface"],
  ["text", "surface-hover"],
  ["text-muted", "background"],
  ["text-muted", "surface"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-hover"],
  ["primary-foreground", "primary-active"],
  ["secondary-foreground", "secondary"],
  ["secondary-foreground", "secondary-hover"],
  ["secondary-foreground", "secondary-active"],
  ["danger-foreground", "danger"],
  ["danger-foreground", "danger-hover"],
  ["danger-foreground", "danger-active"],
  ["danger-fg", "danger-subtle"],
  ["info-fg", "info-subtle"],
  ["success-fg", "success-subtle"],
  ["warning-fg", "warning-subtle"],
];

const NON_TEXT_PAIRS: readonly Pair[] = [
  ["border-strong", "surface"],
  ["border-strong", "background"],
  ["focus-ring", "background"],
  ["focus-ring", "surface"],
  ["primary", "surface"],
  ["primary", "background"],
];

export interface ContrastPair {
  readonly foreground: AppearanceColorToken;
  readonly background: AppearanceColorToken;
  readonly kind: "text" | "non-text";
}

/** Every pair the check measures. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...TEXT_PAIRS.map(([foreground, background]) => ({
    foreground,
    background,
    kind: "text" as const,
  })),
  ...NON_TEXT_PAIRS.map(([foreground, background]) => ({
    foreground,
    background,
    kind: "non-text" as const,
  })),
];

function isHighContrast(kind: PaletteKind): boolean {
  return kind === "lightHighContrast" || kind === "darkHighContrast";
}

function isDark(kind: PaletteKind): boolean {
  return kind === "dark" || kind === "darkHighContrast";
}

export function requiredRatio(kind: PaletteKind, pair: ContrastPair): number {
  if (pair.kind === "non-text") return CONTRAST_THRESHOLDS.nonText;
  return isHighContrast(kind) ? CONTRAST_THRESHOLDS.highContrastText : CONTRAST_THRESHOLDS.text;
}

export interface ContrastFailure extends ContrastPair {
  readonly palette: PaletteKind;
  readonly ratio: number;
  readonly required: number;
}

/** Every measured pair below its minimum: 4.5 text and 3 non-text, 7 text in high contrast. */
export function checkPalette(palette: AppearancePalette, kind: PaletteKind): ContrastFailure[] {
  return CONTRAST_PAIRS.flatMap((pair) => {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    const required = requiredRatio(kind, pair);
    return ratio >= required ? [] : [{ ...pair, palette: kind, ratio, required }];
  });
}

export function checkPalettes(palettes: AppearancePalettes): ContrastFailure[] {
  return PALETTE_KINDS.flatMap((kind) => checkPalette(palettes[kind], kind));
}

function normalizeFamily(family: string): string {
  return family.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

const FACE_BY_NAME = new Map<string, AppearanceFace>(
  APPEARANCE_FACES.flatMap((face): [string, AppearanceFace][] =>
    face.family === null
      ? [[face.key, face.key]]
      : [
          [face.key, face.key],
          [normalizeFamily(face.family), face.key],
        ],
  ),
);

/** The first family of a CSS font-family list found in the registry, else System. */
export function mapFace(fontFamily: string | null | undefined): AppearanceFace {
  for (const family of (fontFamily ?? "").split(",")) {
    const match = FACE_BY_NAME.get(normalizeFamily(family));
    if (match !== undefined) return match;
  }
  return SYSTEM_FACE;
}

export const AppearanceSeed = z.strictObject({
  primary: HexColor,
  secondary: HexColor.optional(),
  text: HexColor.optional(),
  background: HexColor.optional(),
  fontFamily: z.string().max(500).optional(),
  pageTint: z.boolean().optional(),
});
export type AppearanceSeed = z.infer<typeof AppearanceSeed>;

export interface AppearanceCorrection {
  readonly palette: PaletteKind;
  readonly token: AppearanceColorToken;
  readonly from: string;
  readonly to: string;
}

export interface DerivationReport {
  readonly corrections: readonly AppearanceCorrection[];
  /** Palettes where the tint would have lowered a measured pair, so it was left off. */
  readonly tintDropped: readonly PaletteKind[];
  readonly face: {
    readonly requested: string | null;
    readonly mapped: AppearanceFace;
  };
}

export interface DerivedAppearance {
  readonly palettes: AppearancePalettes;
  readonly face: AppearanceFace;
  readonly pageTint: boolean;
  readonly report: DerivationReport;
}

const WHITE = "#ffffff";
const BLACK = "#000000";
const GREY = "#6b7280";

function mix(from: string, to: string, amount: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);
  return hexOf(
    a.map((channel, index) =>
      Math.round(channel + ((b[index] ?? 0) - channel) * amount),
    ) as unknown as Rgb,
  );
}

/**
 * The colour nearest `start` on the line towards `extreme` that satisfies `passes`. `extreme`
 * itself must pass, which the page anchors guarantee, so the result always passes.
 */
function towards(start: string, extreme: string, passes: (color: string) => boolean): string {
  if (passes(start)) return start;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (passes(mix(start, extreme, middle))) high = middle;
    else low = middle;
  }
  const found = mix(start, extreme, high);
  return passes(found) ? found : extreme;
}

/** Semantic lanes stay conventional in every theme, so these come from the shipped default. */
type StatusToken = Extract<
  AppearanceColorToken,
  `${"danger" | "info" | "success" | "warning"}${"" | "-subtle" | "-fg"}`
>;

const STATUS: Readonly<Record<PaletteKind, Readonly<Record<StatusToken, string>>>> = {
  light: {
    danger: "#c0271f",
    "danger-subtle": "#f9e7e5",
    "danger-fg": "#8f1d18",
    info: "#2456c6",
    "info-subtle": "#e9effb",
    "info-fg": "#1b44a0",
    success: "#1e7a46",
    "success-subtle": "#e4f1ea",
    "success-fg": "#16603a",
    warning: "#8a5a00",
    "warning-subtle": "#f6eeda",
    "warning-fg": "#6e4700",
  },
  dark: {
    danger: "#ff7b80",
    "danger-subtle": "#2b1615",
    "danger-fg": "#ffb3b5",
    info: "#7aa2ff",
    "info-subtle": "#16233a",
    "info-fg": "#a9c4ff",
    success: "#46c08a",
    "success-subtle": "#132a20",
    "success-fg": "#8fe0bd",
    warning: "#e0a93b",
    "warning-subtle": "#2a2110",
    "warning-fg": "#f0cd85",
  },
  lightHighContrast: {
    danger: "#8a0f0a",
    "danger-subtle": "#ffecea",
    "danger-fg": "#6b0b07",
    info: "#0a3ea8",
    "info-subtle": "#e6efff",
    "info-fg": "#08337d",
    success: "#0a5c30",
    "success-subtle": "#e2f4e9",
    "success-fg": "#064023",
    warning: "#5a3b00",
    "warning-subtle": "#fbf0d6",
    "warning-fg": "#4a3000",
  },
  darkHighContrast: {
    danger: "#ff9ea2",
    "danger-subtle": "#1f0a0a",
    "danger-fg": "#ffc2c4",
    info: "#8ab4ff",
    "info-subtle": "#0a1024",
    "info-fg": "#b9ccff",
    success: "#5ee39f",
    "success-subtle": "#04160c",
    "success-fg": "#9ceabf",
    warning: "#ffcc66",
    "warning-subtle": "#171003",
    "warning-fg": "#ffd98a",
  },
};

/** Light pages keep black text at 7:1 even on their hover shades, dark pages keep white at 7:1. */
const LIGHT_PAGE_MIN_LUMINANCE = 0.4;
const DARK_PAGE_MAX_LUMINANCE = 0.05;
const TINT = { light: 0.08, dark: 0.12 } as const;

/** Whether a seed colour reads as dark, so belongs to the light palettes as ink. */
function isDarkColor(color: string): boolean {
  return contrastRatio(color, WHITE) >= contrastRatio(color, BLACK);
}

interface Draft {
  readonly kind: PaletteKind;
  readonly palette: Record<AppearanceColorToken, string>;
  readonly corrections: AppearanceCorrection[];
}

function settle(
  draft: Draft,
  token: AppearanceColorToken,
  proposal: string,
  settled: string,
): void {
  draft.palette[token] = settled;
  if (settled !== proposal.toLowerCase()) {
    draft.corrections.push({
      palette: draft.kind,
      token,
      from: proposal.toLowerCase(),
      to: settled,
    });
  }
}

function pairsPass(
  palette: Readonly<Record<AppearanceColorToken, string>>,
  kind: PaletteKind,
  involving: (pair: ContrastPair) => boolean,
): boolean {
  return CONTRAST_PAIRS.filter(involving).every(
    (pair) =>
      contrastRatio(palette[pair.foreground], palette[pair.background]) >=
      requiredRatio(kind, pair),
  );
}

/** Moves a foreground token until every pair it is the foreground of passes. */
function fixForeground(
  draft: Draft,
  token: AppearanceColorToken,
  proposal: string,
  extreme: string,
): void {
  const passes = (color: string): boolean =>
    pairsPass(
      { ...draft.palette, [token]: color },
      draft.kind,
      (pair) => pair.foreground === token,
    );
  settle(draft, token, proposal, towards(proposal.toLowerCase(), extreme, passes));
}

/** A filled control: its own non-text pairs, then its foreground on it and on its hover and active shades. */
function fixFill(
  draft: Draft,
  name: "primary" | "secondary" | "danger",
  proposal: string,
  extreme: string,
): void {
  const foregroundToken = `${name}-foreground` as const;
  const shades = (fill: string, foreground: string): readonly [string, string] => {
    const away = foreground === WHITE ? BLACK : WHITE;
    return [mix(fill, away, 0.1), mix(fill, away, 0.2)];
  };
  const passesWith =
    (foreground: string) =>
    (fill: string): boolean => {
      const [hover, active] = shades(fill, foreground);
      const candidate = {
        ...draft.palette,
        [name]: fill,
        [`${name}-hover`]: hover,
        [`${name}-active`]: active,
        [foregroundToken]: foreground,
      };
      return pairsPass(
        candidate,
        draft.kind,
        (pair) => pair.foreground === name || pair.foreground === foregroundToken,
      );
    };
  const start = proposal.toLowerCase();
  const best = contrastRatio(WHITE, start) >= contrastRatio(BLACK, start) ? WHITE : BLACK;
  const opposite = extreme === BLACK ? WHITE : BLACK;
  const foreground = best === extreme && !passesWith(best)(start) ? opposite : best;
  const fill = towards(start, extreme, passesWith(foreground));
  const [hover, active] = shades(fill, foreground);
  settle(draft, name, start, fill);
  draft.palette[`${name}-hover`] = hover;
  draft.palette[`${name}-active`] = active;
  draft.palette[foregroundToken] = foreground;
}

interface Proposals {
  readonly primary: string;
  readonly secondary: string;
  readonly text: string | undefined;
  readonly background: string | undefined;
}

function derivePalette(
  kind: PaletteKind,
  seed: Proposals,
  tint: boolean,
): { palette: AppearancePalette; corrections: AppearanceCorrection[]; tintDropped: boolean } {
  const dark = isDark(kind);
  const high = isHighContrast(kind);
  const extreme = dark ? BLACK : WHITE;
  const ink = dark ? WHITE : BLACK;
  const draft: Draft = {
    kind,
    palette: {} as Record<AppearanceColorToken, string>,
    corrections: [],
  };

  const defaultPage = dark ? mix(BLACK, seed.primary, 0.06) : mix(WHITE, seed.primary, 0.02);
  const pageProposal = high ? extreme : (seed.background ?? defaultPage);
  const pageFits = (color: string): boolean =>
    dark
      ? relativeLuminance(color) <= DARK_PAGE_MAX_LUMINANCE
      : relativeLuminance(color) >= LIGHT_PAGE_MIN_LUMINANCE;
  settle(draft, "background", pageProposal, towards(pageProposal.toLowerCase(), extreme, pageFits));

  const surfaces = (page: string): void => {
    draft.palette.background = page;
    const plainSurface = dark ? mix(page, WHITE, 0.05) : WHITE;
    draft.palette.surface = high ? extreme : plainSurface;
    draft.palette["background-muted"] = mix(page, ink, dark ? 0.03 : 0.05);
    draft.palette["surface-hover"] = mix(draft.palette.surface, ink, dark ? 0.09 : 0.04);
    draft.palette["ghost-hover"] = mix(draft.palette.surface, ink, dark ? 0.09 : 0.05);
    draft.palette["ghost-active"] = mix(draft.palette.surface, ink, dark ? 0.13 : 0.09);
  };
  surfaces(draft.palette.background);

  for (const [token, value] of Object.entries(STATUS[kind])) {
    draft.palette[token as AppearanceColorToken] = value;
  }

  const defaultText = dark ? mix(WHITE, seed.primary, 0.08) : mix(BLACK, seed.primary, 0.15);
  const textProposal = high ? ink : (seed.text ?? defaultText);
  fixForeground(draft, "text", textProposal, ink);
  fixForeground(
    draft,
    "text-muted",
    mix(draft.palette.text, draft.palette.background, high ? 0.15 : 0.35),
    ink,
  );
  for (const lane of ["danger-fg", "info-fg", "success-fg", "warning-fg"] as const) {
    fixForeground(draft, lane, STATUS[kind][lane], ink);
  }

  fixFill(draft, "primary", seed.primary, ink);
  fixFill(draft, "secondary", seed.secondary, ink);
  fixFill(draft, "danger", STATUS[kind].danger, ink);

  draft.palette.border = mix(draft.palette.surface, ink, high ? 0.4 : 0.15);
  fixForeground(draft, "border-strong", high ? ink : mix(draft.palette.surface, ink, 0.55), ink);
  fixForeground(draft, "focus-ring", draft.palette.primary, ink);

  let tintDropped = false;
  if (tint) {
    const untinted = { ...draft.palette };
    surfaces(mix(untinted.background, seed.primary, dark ? TINT.dark : TINT.light));
    if (!pairsPass(draft.palette, kind, () => true)) {
      Object.assign(draft.palette, untinted);
      tintDropped = true;
    }
  }

  const palette = AppearancePalette.parse(draft.palette);
  const corrections = draft.corrections
    .map((entry) => ({ ...entry, to: palette[entry.token] }))
    .filter((entry) => entry.to !== entry.from);
  return { palette, corrections, tintDropped };
}

/** Light, dark and both high-contrast palettes from a seed, each passing `checkPalette`, with what moved. */
export function deriveAppearance(seed: AppearanceSeed): DerivedAppearance {
  const parsed = AppearanceSeed.parse(seed);
  const primary = parsed.primary.toLowerCase();
  const secondary = (parsed.secondary ?? mix(primary, GREY, 0.75)).toLowerCase();
  const tint = parsed.pageTint ?? false;
  const corrections: AppearanceCorrection[] = [];
  const tintDropped: PaletteKind[] = [];
  const palettes = {} as Record<PaletteKind, AppearancePalette>;
  for (const kind of PALETTE_KINDS) {
    const dark = isDark(kind);
    const proposals: Proposals = {
      primary,
      secondary,
      text:
        parsed.text !== undefined && isDarkColor(parsed.text) !== dark ? parsed.text : undefined,
      background:
        parsed.background !== undefined && isDarkColor(parsed.background) === dark
          ? parsed.background
          : undefined,
    };
    const derived = derivePalette(kind, proposals, tint);
    palettes[kind] = derived.palette;
    corrections.push(...derived.corrections);
    if (derived.tintDropped) tintDropped.push(kind);
  }
  const face = mapFace(parsed.fontFamily);
  return {
    palettes,
    face,
    pageTint: tint,
    report: {
      corrections,
      tintDropped,
      face: { requested: parsed.fontFamily ?? null, mapped: face },
    },
  };
}
