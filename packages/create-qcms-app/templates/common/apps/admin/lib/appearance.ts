/** Use a browser-writable preference cookie for correct SSR classes without a repaint. OS auto mode is CSS-driven so no inline bootstrap weakens CSP. */

/** Auto has no class so OS media rules apply; explicit light suppresses those rules even though its palette is the base style. */
export const POLARITIES = ["auto", "light", "dark"] as const;
export type Polarity = (typeof POLARITIES)[number];

export const CONTRASTS = ["normal", "high"] as const;
export type Contrast = (typeof CONTRASTS)[number];

export interface Appearance {
  readonly polarity: Polarity;
  readonly contrast: Contrast;
}

export const HIGH_CONTRAST_CLASS = "hc";

export const APPEARANCE_CLASSES: readonly string[] = ["light", "dark", HIGH_CONTRAST_CLASS];

/** Cookies ignore ports, so a distinct admin name prevents localhost portal preferences changing authoring appearance. */
export const MODE_COOKIE = "qcms-app-mode";

export const MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The legacy high-contrast value means light high contrast; keep that saved preference stable. */
const LEGACY_HIGH_CONTRAST = "hc";

export function appearanceValue(appearance: Appearance): string {
  return appearance.contrast === "high"
    ? `${appearance.polarity}-${HIGH_CONTRAST_CLASS}`
    : appearance.polarity;
}

/** Missing or malformed values must fall through to OS media rules, never pin new users to light. */
export function parseAppearance(raw: string | undefined): Appearance | undefined {
  if (raw === undefined) return undefined;
  if (raw === LEGACY_HIGH_CONTRAST) return { polarity: "light", contrast: "high" };
  const suffix = `-${HIGH_CONTRAST_CLASS}`;
  const high = raw.endsWith(suffix);
  const head = high ? raw.slice(0, -suffix.length) : raw;
  const polarity = POLARITIES.find((candidate) => candidate === head);
  if (polarity === undefined) return undefined;
  return { polarity, contrast: high ? "high" : "normal" };
}

export function appearanceClasses(appearance: Appearance): readonly string[] {
  const classes: string[] = [];
  if (appearance.polarity !== "auto") classes.push(appearance.polarity);
  if (appearance.contrast === "high") classes.push(HIGH_CONTRAST_CLASS);
  return classes;
}

export function appearanceClassName(appearance: Appearance | undefined): string | undefined {
  if (appearance === undefined) return undefined;
  const classes = appearanceClasses(appearance);
  return classes.length === 0 ? undefined : classes.join(" ");
}

export function modeCookie(appearance: Appearance, secure: boolean): string {
  const attributes = [
    `${MODE_COOKIE}=${appearanceValue(appearance)}`,
    "Path=/",
    `Max-Age=${MODE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
