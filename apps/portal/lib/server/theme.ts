import { fontChoices, fontClass, SYSTEM_FONT_KEY, type FontEntry } from "@roonga/qcms-ui/fonts";

// Relative, not the `@/` alias: Vitest resolves no Next path aliases.
import { t } from "../i18n/en";

import {
  DEFAULT_DENSITY,
  DENSITY_LEVELS,
  densityClass,
  parseDensity,
  parseMode,
  type AppearanceMode,
  type Density,
} from "../appearance";

export const PORTAL_THEMES = ["slate", "harbor", "sand", "plum"] as const;
export type PortalTheme = (typeof PORTAL_THEMES)[number];

export const PORTAL_CORNERS = ["sharp", "subtle", "rounded", "pill"] as const;
export type PortalCorners = (typeof PORTAL_CORNERS)[number];

/** `auto` follows the OS signal; the other three pin the mode. */
export const PORTAL_MODES = ["auto", "light", "dark", "hc"] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

/**
 * `lib/appearance.ts`'s levels rather than a second list, because config and the
 * respondent control have to offer exactly the same three. There is no `auto`, since no
 * media query reports a preferred spacing.
 */
export const PORTAL_DENSITIES = DENSITY_LEVELS;

export const DEFAULT_THEME: PortalTheme = "slate";
/** Subtle corners are the base of the radius group, so they need no root class. */
export const DEFAULT_CORNERS: PortalCorners = "subtle";
export const DEFAULT_MODE: PortalMode = "auto";
/**
 * The one entry that can never be curated away: it downloads nothing, so it is the only
 * choice guaranteed to render.
 */
export const DEFAULT_FONT: string = SYSTEM_FONT_KEY;

// The casts are the `readonly T[]` narrowing gap: `includes` accepts only `T`, and the
// guard does not narrow `raw`. They are safe because the value is returned as `T` only on
// the branch where `allowed` contains it.
function oneOf<T extends string>(allowed: readonly T[], raw: string | undefined, fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function portalTheme(): PortalTheme {
  return oneOf(PORTAL_THEMES, process.env.QCMS_PORTAL_THEME, DEFAULT_THEME);
}

export function portalCorners(): PortalCorners {
  return oneOf(PORTAL_CORNERS, process.env.QCMS_PORTAL_CORNERS, DEFAULT_CORNERS);
}

export function portalMode(): PortalMode {
  return oneOf(PORTAL_MODES, process.env.QCMS_PORTAL_MODE, DEFAULT_MODE);
}

export function portalDensity(): Density {
  return oneOf(PORTAL_DENSITIES, process.env.QCMS_PORTAL_DENSITY, DEFAULT_DENSITY);
}

/**
 * The operator's curation of the font registry. Unset means the whole registry, never an
 * empty list; unknown keys are dropped rather than fatal, and System is always present.
 */
export function portalFontChoices(): readonly FontEntry[] {
  const raw = process.env.QCMS_PORTAL_FONTS ?? "";
  return fontChoices(raw.split(/[\s,]+/u).filter((key) => key !== ""));
}

/**
 * A key that is unknown or curated out falls back to System, rather than selecting a
 * font no respondent could switch back to.
 */
export function portalFont(): string {
  const raw = process.env.QCMS_PORTAL_FONT;
  const offered = portalFontChoices();
  return offered.some((entry) => entry.key === raw) ? (raw as string) : DEFAULT_FONT;
}

export interface PortalBrand {
  /** Header text and document title. Never empty. */
  readonly name: string;
  /** A same-origin path or a `data:` image, or `undefined` for text only. */
  readonly logoSrc: string | undefined;
}

/** Anything that must never reach an HTML attribute value. */
const UNSAFE_IN_ATTRIBUTE = /[\s"'<>\\]/u;

const DATA_IMAGE = /^data:image\/[\w.+-]+[,;]/u;

// Accepts exactly what the shipped `img-src 'self' data:` policy permits (SEC-9), so a configured logo cannot render as a broken image or put pressure on the CSP to widen.
function isLoadableLogo(value: string): boolean {
  if (value === "" || UNSAFE_IN_ATTRIBUTE.test(value)) return false;
  if (value.startsWith("//")) return false;
  return value.startsWith("/") || DATA_IMAGE.test(value);
}

/**
 * A blank name falls back to the catalogue's generic default and an unloadable logo is
 * dropped, for this module's usual reason: presentation config must not be able to take
 * a deployment down or deface it.
 */
export function portalBrand(): PortalBrand {
  const name = (process.env.QCMS_PORTAL_BRAND_NAME ?? "").trim();
  const logo = (process.env.QCMS_PORTAL_BRAND_LOGO ?? "").trim();
  return {
    name: name === "" ? t("brand.defaultName") : name,
    logoSrc: isLoadableLogo(logo) ? logo : undefined,
  };
}

/**
 * `mode` can still be `auto` on the way out, which means no server-side answer exists
 * and only the pre-paint script can ask the OS. `modeChosen` is what tells that script
 * not to second-guess a real choice.
 */
export interface ResolvedAppearance {
  readonly mode: PortalMode;
  /** True when `mode` came from the respondent's cookie rather than from config. */
  readonly modeChosen: boolean;
  readonly font: string;
  readonly density: Density;
}

export interface AppearanceCookies {
  readonly mode: string | undefined;
  readonly font: string | undefined;
  readonly density: string | undefined;
}

/**
 * Precedence per axis is the respondent's cookie, then config. A nonsense cookie is no
 * choice at all, which is why a font cookie is checked against the offered list rather
 * than the whole registry: a face a deployment stopped offering must not keep being
 * served, since the control could no longer switch back.
 */
export function resolveAppearance(cookies: AppearanceCookies): ResolvedAppearance {
  const chosenMode = parseMode(cookies.mode);
  const offered = portalFontChoices();
  const chosenFont = offered.some((entry) => entry.key === cookies.font)
    ? (cookies.font as string)
    : undefined;
  return {
    mode: chosenMode ?? portalMode(),
    modeChosen: chosenMode !== undefined,
    font: chosenFont ?? portalFont(),
    density: parseDensity(cookies.density) ?? portalDensity(),
  };
}

/** Subtle is the base anchor block, so it needs no class at all. */
export function cornersClass(corners: PortalCorners): string {
  return corners === DEFAULT_CORNERS ? "" : `radius-${corners}`;
}

/**
 * `auto` renders as `light` and the pre-paint script corrects it from the OS signals, so
 * a dark-mode respondent still never sees a light flash. The narrowed return type is what
 * lets the layout hand the value to the controls without a cast.
 */
export function modeClass(mode: PortalMode): AppearanceMode {
  return mode === "auto" ? "light" : mode;
}

/**
 * The font class is always emitted, System included, because the System block restates
 * the base stack: a positive selection is what lets the control switch back by swapping
 * one class. Density takes the opposite convention, because the base spacing block is
 * Comfortable and a class restating it would be a second place to edit.
 */
export function rootClassName(appearance: ResolvedAppearance, corners: PortalCorners): string {
  return [
    modeClass(appearance.mode),
    cornersClass(corners),
    fontClass(appearance.font),
    densityClass(appearance.density),
  ]
    .filter(Boolean)
    .join(" ");
}
