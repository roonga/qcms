/**
 * The operator's runtime appearance choice: polarity crossed with contrast.
 *
 * Pure, client-safe and shared. The root layout resolves the choice during SSR and the
 * topbar control re-applies it in the browser, so the class names, the cookie name
 * and the parser have to be one definition rather than two that agree by inspection.
 *
 * Deliberately NOT under `lib/server/`: it reads no environment and holds no secret,
 * and the R2 import-surface test forbids a client component from reaching into
 * `lib/server/` at all.
 *
 * WHY A COOKIE RATHER THAN localStorage
 * The choice has to be readable on the SERVER, because the root classes must be right
 * in the first byte of HTML or the operator watches the app repaint. `localStorage`
 * is unreachable during SSR, so a localStorage-backed control can only correct the
 * page after it loads, which is the flash. A cookie rides the navigation, so
 * `app/layout.tsx` stamps the classes before anything is painted.
 *
 * And there is no pre-paint script here, unlike the portal's. The one input the
 * server cannot see - the machine's `prefers-color-scheme` - is handled inside the
 * token sheet by media blocks that apply when no polarity class is present
 * (`app/theme.css`), at both contrast levels. So Auto follows the OS with no script,
 * which keeps the app's CSP free of any inline-script allowance of its own
 * (`lib/server/csp.ts`).
 *
 * This cookie is presentation chrome, never a credential: no `httpOnly` (the browser
 * has to write it), `SameSite=Lax`, and `Secure` in production. Nothing about an
 * operator's identity or session is inferable from it.
 */

/**
 * Polarity, which is also the root class name except for `auto`.
 *
 * `auto` carries no class, which is what lets the sheet's `prefers-color-scheme`
 * blocks apply. `light` is a real selection rather than an absence even though Light
 * is the sheet's bare `:root` block: the class carries no values and exists only so an
 * operator who picks Light on a dark-preferring machine opts out of those blocks.
 */
export const POLARITIES = ["auto", "light", "dark"] as const;
export type Polarity = (typeof POLARITIES)[number];

/**
 * Contrast, the second axis. `high` is only ever reached by choosing it: nothing
 * infers it from a media query, which is the point of listing it here rather than
 * deriving it, and the sheet has no `prefers-contrast` block to derive it with.
 */
export const CONTRASTS = ["normal", "high"] as const;
export type Contrast = (typeof CONTRASTS)[number];

export interface Appearance {
  readonly polarity: Polarity;
  readonly contrast: Contrast;
}

/** The high-contrast root class, orthogonal to polarity. */
export const HIGH_CONTRAST_CLASS = "hc";

/** Every class this module can stamp, so a client swap clears exactly the set it owns. */
export const APPEARANCE_CLASSES: readonly string[] = ["light", "dark", HIGH_CONTRAST_CLASS];

/**
 * Distinct from the portal's `qcms-theme` on purpose. In development and in the e2e
 * harness both apps are served from `localhost` on different ports, and cookies do
 * not distinguish ports - one shared name would mean changing the operator's app
 * appearance every time a respondent screen changed a respondent's.
 */
export const MODE_COOKIE = "qcms-app-mode";

/** A year: a choice is a preference, not a session, and nothing it holds expiry protects. */
export const MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The value a cookie written before the second axis existed holds. It means Light plus
 * high contrast, because Light was the only field high contrast had, so a saved choice
 * does not change meaning on deploy.
 */
const LEGACY_HIGH_CONTRAST = "hc";

/** `<polarity>` or `<polarity>-hc`: bare keywords, so the cookie needs no escaping. */
export function appearanceValue(appearance: Appearance): string {
  return appearance.contrast === "high"
    ? `${appearance.polarity}-${HIGH_CONTRAST_CLASS}`
    : appearance.polarity;
}

/**
 * An explicit choice, or `undefined` when there is none.
 *
 * The `undefined` return is the point: "no cookie" and "a cookie holding nonsense"
 * must both fall through to the sheet's OS-following blocks, and a parser that
 * substituted Light here would silently pin every new operator to Light on a
 * dark-preferring machine.
 */
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

/** The root classes for a choice. Auto plus normal contrast is no class at all. */
export function appearanceClasses(appearance: Appearance): readonly string[] {
  const classes: string[] = [];
  if (appearance.polarity !== "auto") classes.push(appearance.polarity);
  if (appearance.contrast === "high") classes.push(HIGH_CONTRAST_CLASS);
  return classes;
}

/** The `<html>` className: `undefined` rather than `""`, so no empty attribute ships. */
export function appearanceClassName(appearance: Appearance | undefined): string | undefined {
  if (appearance === undefined) return undefined;
  const classes = appearanceClasses(appearance);
  return classes.length === 0 ? undefined : classes.join(" ");
}

/** The `document.cookie` assignment string for a choice. */
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
