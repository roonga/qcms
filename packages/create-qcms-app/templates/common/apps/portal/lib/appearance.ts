/**
 * The respondent's three runtime appearance choices (ADR-30), shared by the SSR resolver
 * and the browser controls so the class names, cookie names and parsers are one
 * definition.
 *
 * Not under `lib/server/`: it reads no environment, and the R2 import-surface test
 * forbids a client component from reaching into `lib/server/` at all.
 *
 * Cookies rather than `localStorage`, because the root class has to be correct in the
 * first byte of HTML or the respondent sees a flash, and `localStorage` is unreachable
 * during SSR. These are presentation chrome and never a credential: no `httpOnly`, since
 * the browser has to write them, and nothing about a respondent is inferable from them.
 */

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

// `docs/theming.md` documents this name as the manual door.
export const MODE_COOKIE = "qcms-theme";
export const FONT_COOKIE = "qcms-font";
export const DENSITY_COOKIE = "qcms-density";

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

export const DENSITY_CLASSES: readonly string[] = DENSITY_LEVELS.map((level) =>
  densityClass(level),
).filter((className) => className !== "");

/**
 * The `undefined` return is what separates this from the config-side `oneOf` helper: no
 * cookie and a nonsense cookie both have to fall through to the deployment default and
 * then to the OS signals, and substituting a default here would pin the deployment.
 */
export function parseMode(raw: string | undefined): AppearanceMode | undefined {
  return APPEARANCE_MODES.find((mode) => mode === raw);
}

export function parseDensity(raw: string | undefined): Density | undefined {
  return DENSITY_LEVELS.find((level) => level === raw);
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

/**
 * An absent axis means not chosen in this submission rather than reset to the default.
 * The form always posts all three, so the shape is partial only because
 * {@link appearanceCookiesFor} is also the answer for values that failed validation.
 */
export interface AppearanceChoice {
  readonly mode?: AppearanceMode | undefined;
  readonly font?: string | undefined;
  readonly density?: Density | undefined;
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
  if (choice.density !== undefined) {
    written.push(appearanceCookie(DENSITY_COOKIE, choice.density, secure));
  }
  return written;
}
