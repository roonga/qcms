/**
 * Per-deployment theme selection (task 051, ADR-30).
 *
 * A theme is **mutable operator config, not form-grade immutable content**: it is
 * presentation chrome, so it carries none of the immutability or auditability
 * weight answers do. QCMS is single-tenant (ADR-20), so one deployment picks one
 * theme and one corner preset from the environment, and the root layout stamps
 * them onto `<html>` during SSR. There is no respondent-facing selector in this
 * slice (the mode / font / density controls are task 053) and no admin editor
 * (task 049); this module is the whole selection surface for now.
 *
 * Reading the environment stays on the server. Nothing here is a secret, but the
 * portal is a strict BFF (R2) and configuration resolution belongs in one place.
 *
 * An unrecognized value falls back to the default rather than throwing, matching
 * `challenge.ts`: a typo in presentation config must not take a deployment down,
 * and the fallback is the shipped brand-neutral default, which is always safe.
 */

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

/** The `<html class>` value for the configured theme (mode + corners). */
export function rootClassName(mode: PortalMode, corners: PortalCorners): string {
  return [modeClass(mode), cornersClass(corners)].filter(Boolean).join(" ");
}
