/**
 * Per-deployment theme and font selection (tasks 051 + 052, ADR-30).
 *
 * A theme is **mutable operator config, not form-grade immutable content**: it is
 * presentation chrome, so it carries none of the immutability or auditability
 * weight answers do. QCMS is single-tenant (ADR-20), so one deployment picks one
 * theme, one corner preset and one default font from the environment, and the root
 * layout stamps them onto `<html>` during SSR. There is no respondent-facing
 * selector in this slice (the mode / font / density controls are task 053) and no
 * admin editor (task 049); this module is the whole selection surface for now.
 *
 * Font CURATION also lives here. `QCMS_PORTAL_FONTS` names the subset of the
 * `@qcms/ui` registry a deployment offers respondents, which for launch is how an
 * operator curates the list; the admin UI over the same setting is Phase-4. The
 * curated list has no visible effect until 053 renders a control from it, with one
 * exception that is observable today: a configured default font outside the
 * curated subset is not offerable, so it falls back to System.
 *
 * Reading the environment stays on the server. Nothing here is a secret, but the
 * portal is a strict BFF (R2) and configuration resolution belongs in one place.
 *
 * An unrecognized value falls back to the default rather than throwing, matching
 * `challenge.ts`: a typo in presentation config must not take a deployment down,
 * and the fallback is the shipped brand-neutral default, which is always safe.
 */

import { fontChoices, fontClass, SYSTEM_FONT_KEY, type FontEntry } from "@qcms/ui/fonts";

/** The predefined themes (the theme-palette design deliverable). */
export const PORTAL_THEMES = ["slate", "harbor", "sand", "plum"] as const;
export type PortalTheme = (typeof PORTAL_THEMES)[number];

/** The corner presets of the radius token group. */
export const PORTAL_CORNERS = ["sharp", "subtle", "rounded", "pill"] as const;
export type PortalCorners = (typeof PORTAL_CORNERS)[number];

/**
 * The colour mode a deployment starts respondents in. `auto` follows the OS
 * `prefers-color-scheme` signal; the other three pin the mode, which is how a
 * deployment can ship High-contrast as its default.
 */
export const PORTAL_MODES = ["auto", "light", "dark", "hc"] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

/** Slate Teal: the shipped, brand-neutral default. */
export const DEFAULT_THEME: PortalTheme = "slate";
/** Subtle corners are the base of the radius group (no root class needed). */
export const DEFAULT_CORNERS: PortalCorners = "subtle";
/** Default to whatever the respondent's OS asks for. */
export const DEFAULT_MODE: PortalMode = "auto";
/**
 * System is the shipped default font and the one entry that can never be curated
 * away: it downloads nothing, so it is the only choice guaranteed to render.
 */
export const DEFAULT_FONT: string = SYSTEM_FONT_KEY;

// The casts here are the standard `readonly T[]` narrowing gap: `includes` is typed to
// accept only `T`, so an arbitrary string cannot be passed without one, and TypeScript
// does not narrow `raw` from the guard. They are safe precisely because they are
// guarded - the value is only returned as `T` on the branch where `allowed` contains it,
// and every other input falls back. `portalFont` below does the same thing against the
// curated font list, which is a runtime set rather than a literal union.
function oneOf<T extends string>(allowed: readonly T[], raw: string | undefined, fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** The configured theme, stamped on `<html data-theme>`. */
export function portalTheme(): PortalTheme {
  return oneOf(PORTAL_THEMES, process.env.QCMS_PORTAL_THEME, DEFAULT_THEME);
}

/** The configured corner preset. */
export function portalCorners(): PortalCorners {
  return oneOf(PORTAL_CORNERS, process.env.QCMS_PORTAL_CORNERS, DEFAULT_CORNERS);
}

/** The configured default colour mode. */
export function portalMode(): PortalMode {
  return oneOf(PORTAL_MODES, process.env.QCMS_PORTAL_MODE, DEFAULT_MODE);
}

/**
 * The respondent-facing font subset this deployment offers: the operator's
 * curation of the `@qcms/ui` registry, read from `QCMS_PORTAL_FONTS` as a list of
 * registry keys separated by commas and/or whitespace.
 *
 * Unset or empty means the whole registry, never an empty list. Unknown keys are
 * dropped rather than fatal (the same typo tolerance as the rest of this module),
 * and System is always present. Task 053's control renders exactly this list; the
 * admin UI over the same setting is Phase-4.
 */
export function portalFontChoices(): readonly FontEntry[] {
  const raw = process.env.QCMS_PORTAL_FONTS ?? "";
  return fontChoices(raw.split(/[\s,]+/u).filter((key) => key !== ""));
}

/**
 * The deployment's default font key, stamped on `<html>`. It must be one the
 * deployment actually offers, so a key that is unknown OR curated out falls back
 * to System rather than selecting a font no respondent could switch back to.
 */
export function portalFont(): string {
  const raw = process.env.QCMS_PORTAL_FONT;
  const offered = portalFontChoices();
  return offered.some((entry) => entry.key === raw) ? (raw as string) : DEFAULT_FONT;
}

/**
 * The root class for a corner preset. Subtle is the base `:root` block in
 * `theme.css`, so it needs no class at all.
 */
export function cornersClass(corners: PortalCorners): string {
  return corners === DEFAULT_CORNERS ? "" : `radius-${corners}`;
}

/**
 * The root class for the first paint. `auto` renders as `light` and the
 * pre-paint bootstrap script corrects it from the OS signal before the browser
 * paints, so a dark-mode respondent still never sees a light flash.
 */
export function modeClass(mode: PortalMode): string {
  return mode === "auto" ? "light" : mode;
}

/**
 * The `<html class>` value for the configured appearance: mode + corners + font.
 *
 * The font class is always emitted, System included: `:root.font-system` restates
 * the base System stack, so the class is a positive selection rather than an
 * absence, which is what lets 053 switch back to System by swapping one class.
 */
export function rootClassName(mode: PortalMode, corners: PortalCorners, font: string): string {
  return [modeClass(mode), cornersClass(corners), fontClass(font)].filter(Boolean).join(" ");
}
