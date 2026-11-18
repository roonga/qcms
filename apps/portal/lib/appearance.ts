/**
 * Also the root class names, which is the token contract's selector convention. `auto` is
 * absent on purpose: it is a per-deployment config value meaning "consult the OS
 * signals", so a control offering it would offer a state the page can never be in.
 */
export const APPEARANCE_MODES = ["light", "dark", "hc"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

// Tightest to loosest. Comfortable is the base anchor spacing block, so it has no class.
export const DENSITY_LEVELS = ["compact", "comfortable", "spacious"] as const;
export type Density = (typeof DENSITY_LEVELS)[number];

export const DEFAULT_DENSITY: Density = "comfortable";

export const MODE_COOKIE = "qcms-theme";
export const FONT_COOKIE = "qcms-font";
export const TEXT_SIZE_COOKIE = "qcms-text-size";

/** The respondent's multiplier over the form's base size, in percent. */
export const TEXT_SCALES = ["100", "125", "150", "200"] as const;
export type TextScale = (typeof TEXT_SCALES)[number];
export const DEFAULT_TEXT_SCALE: TextScale = "100";

/** The admin base size bounds in px; a page with no form appearance uses the minimum. */
export const TEXT_BASE_MIN = 16;
export const TEXT_BASE_MAX = 24;
export const DEFAULT_TEXT_BASE = TEXT_BASE_MIN;
/** No base and scale pair may render body text larger than this. */
export const TEXT_SIZE_CAP_PX = 32;

/**
 * The rendered root size in px at the browser's default 16 px, which is what
 * `theme.css` computes from the base ratio and the scale class.
 */
export function textSizePx(base: number, scale: TextScale): number {
  return Math.min((base * Number(scale)) / 100, TEXT_SIZE_CAP_PX);
}

/** Always emitted, the default included: the class is what opts the root into the scale rule. */
export function textScaleClass(scale: TextScale): string {
  return `text-scale-${scale}`;
}

export const TEXT_SCALE_CLASSES: readonly string[] = TEXT_SCALES.map((scale) =>
  textScaleClass(scale),
);

/**
 * A year: an appearance choice is a preference and not a session, and a respondent who
 * needs High contrast or a legibility face needs it every visit. Nothing is stored that
 * expiry protects.
 */
export const APPEARANCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// The default level is an absence of class, so removing every density class restores it.
export function densityClass(density: Density): string {
  return density === DEFAULT_DENSITY ? "" : `density-${density}`;
}

/**
 * The `undefined` return is what separates this from the config-side `oneOf` helper: no
 * cookie and a nonsense cookie both have to fall through to the deployment default and
 * then to the OS signals, and substituting a default here would pin the deployment.
 */
export function parseMode(raw: string | undefined): AppearanceMode | undefined {
  return APPEARANCE_MODES.find((mode) => mode === raw);
}

export function parseTextScale(raw: string | undefined): TextScale | undefined {
  return TEXT_SCALES.find((scale) => scale === raw);
}

/**
 * Pure and separate from the DOM write so the attributes are unit-testable. The value is
 * never escaped, because every caller passes a validated keyword or a registry key;
 * `assertCookieSafe` makes a call site that does otherwise fail loudly.
 */
export function appearanceCookie(name: string, value: string, secure: boolean): string {
  assertCookieSafe(value);
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${APPEARANCE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/**
 * Never fires on correct input: it exists so a future call site passing
 * respondent-influenced text fails immediately rather than smuggling a `;` or a newline
 * into the cookie header.
 */
function assertCookieSafe(value: string): void {
  if (!/^[a-z0-9-]+$/u.test(value)) {
    throw new Error("appearance cookie values are bare keywords");
  }
}

/**
 * Shared by three sites that would otherwise repeat the literal: the control stamps the
 * `action` and the hidden field, the route reads the field back, and
 * `lib/server/appearance-form.ts` refuses a return target pointing at this route, since
 * redirecting to a POST-only path is a 405 rather than a page.
 */
export const APPEARANCE_ROUTE = "/appearance";

export const RETURN_FIELD = "returnTo";

/** The prefix of the hidden field carrying the value an axis was rendered with. */
export const BASELINE_PREFIX = "was-";

/** An absent axis means not changed in this submission rather than reset to the default. */
export interface AppearanceChoice {
  readonly mode?: AppearanceMode | undefined;
  readonly font?: string | undefined;
  readonly textSize?: TextScale | undefined;
}

/**
 * Decides which cookies a choice writes and adds no attribute of its own: every one
 * comes from {@link appearanceCookie}, so a cookie written without scripting is the same
 * bytes as one written with it.
 */
export function appearanceCookiesFor(choice: AppearanceChoice, secure: boolean): string[] {
  const written: string[] = [];
  if (choice.mode !== undefined) written.push(appearanceCookie(MODE_COOKIE, choice.mode, secure));
  if (choice.font !== undefined) written.push(appearanceCookie(FONT_COOKIE, choice.font, secure));
  if (choice.textSize !== undefined) {
    written.push(appearanceCookie(TEXT_SIZE_COOKIE, choice.textSize, secure));
  }
  return written;
}
