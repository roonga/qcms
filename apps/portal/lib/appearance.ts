/**
 * The respondent's three runtime appearance choices (task 053, ADR-30): colour
 * MODE, FONT and DENSITY. Pure, client-safe, and shared - the server resolves
 * these during SSR (`lib/server/theme.ts`) and the header controls re-apply them
 * in the browser (`components/appearance-controls.tsx`), so the class names, the
 * cookie names and the parsers have to be one definition rather than two that
 * agree by inspection.
 *
 * This module is deliberately NOT under `lib/server/`: it reads no environment and
 * holds no secret, and the R2 import-surface test forbids a client component from
 * reaching into `lib/server/` at all. Which font list a deployment OFFERS, which
 * mode it starts in, and the brand mark are config, and those stay in
 * `lib/server/theme.ts`.
 *
 * WHY COOKIES RATHER THAN localStorage
 * The choice has to be readable on the SERVER, because the root class must be
 * correct in the first byte of HTML or the respondent sees a flash. `localStorage`
 * is unreachable during SSR, so a localStorage-backed control can only correct the
 * page after it loads, which is the flash. A cookie is sent with the navigation,
 * so `app/layout.tsx` stamps the right classes before anything is painted, and
 * font and density then need no pre-paint script at all. Mode keeps one, only
 * because `prefers-color-scheme` / `prefers-contrast` are signals the server
 * cannot see.
 *
 * These cookies are presentation chrome, never a credential: no `httpOnly` (the
 * browser has to write them), `SameSite=Lax`, and `Secure` in production. Nothing
 * about a respondent's answers, session or identity is inferable from them.
 */

/**
 * The colour modes a respondent can pick. These strings are ALSO the root class
 * names, which is the token contract's selector convention (`docs/theming.md`):
 * Light is the base `:root` block, so `light` is a positive selection rather than
 * an absence, and `dark` / `hc` are the two override layers.
 *
 * `auto` is deliberately absent. It is a per-deployment CONFIG value meaning
 * "consult the OS signals" (`PORTAL_MODES` in `lib/server/theme.ts`), and it never
 * names a rendered mode: the pre-paint script resolves it to one of these three
 * before the first paint, so a control offering it would be offering a state the
 * page can never be in.
 */
export const APPEARANCE_MODES = ["light", "dark", "hc"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

/**
 * The three density levels, in order from tightest to loosest. Comfortable is the
 * base `:root` spacing block in `theme.css`, so it carries no class; the other two
 * are `density-compact` / `density-spacious`.
 */
export const DENSITY_LEVELS = ["compact", "comfortable", "spacious"] as const;
export type Density = (typeof DENSITY_LEVELS)[number];

/** The shipped default: the values the spacing group declares in its base block. */
export const DEFAULT_DENSITY: Density = "comfortable";

/**
 * The mode cookie, named by task 051 and kept: the pre-paint bootstrap has read
 * `qcms-theme` since then, and `docs/theming.md` documents it as the manual door.
 */
export const MODE_COOKIE = "qcms-theme";
/** The selected font registry key. */
export const FONT_COOKIE = "qcms-font";
/** The selected density level. */
export const DENSITY_COOKIE = "qcms-density";

/**
 * A year. An appearance choice is a preference, not a session: a respondent who
 * needs High-contrast or a dyslexia-friendly face needs it every visit, and
 * re-picking it on each one would be the accessibility failure the control exists
 * to prevent. Nothing is stored that expiry protects.
 */
export const APPEARANCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The root class for a density level, or `""` for Comfortable (the base block).
 * Mirrors `cornersClass` in `lib/server/theme.ts`: the default level is an absence
 * of class, so removing every density class restores it.
 */
export function densityClass(density: Density): string {
  return density === DEFAULT_DENSITY ? "" : `density-${density}`;
}

/** Every density root class that may be present, for a remove-then-add swap. */
export const DENSITY_CLASSES: readonly string[] = DENSITY_LEVELS.map((level) =>
  densityClass(level),
).filter((className) => className !== "");

/**
 * An explicit mode choice, or `undefined` when there is none.
 *
 * The `undefined` return is the whole point and is what separates this from the
 * config-side `oneOf` helper: "no cookie" and "a cookie holding nonsense" both
 * have to fall through to the deployment default and then to the OS signals, and a
 * parser that substituted a default here would silently pin the deployment to
 * Light instead.
 */
export function parseMode(raw: string | undefined): AppearanceMode | undefined {
  return APPEARANCE_MODES.find((mode) => mode === raw);
}

/** An explicit density choice, or `undefined` when there is none. */
export function parseDensity(raw: string | undefined): Density | undefined {
  return DENSITY_LEVELS.find((level) => level === raw);
}

/**
 * The `document.cookie` assignment string for one appearance choice.
 *
 * Pure and separate from the DOM write so the attributes are unit-testable
 * (`appearance.test.ts`) rather than only observable through a browser. The value
 * is never escaped here because every caller passes a validated keyword from the
 * lists above or a registry key, all of which are `[a-z0-9-]`; passing arbitrary
 * text would be a bug at the call site, and `assertCookieSafe` makes it a loud one.
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
 * Reject anything that is not a bare keyword before it reaches a `Set-Cookie`-shaped
 * string. Every legitimate value is a mode keyword, a density keyword or a font
 * registry key, so this can never fire on correct input - it exists so that a future
 * call site passing respondent-influenced text fails immediately instead of
 * smuggling `;` or a newline into the cookie header.
 */
function assertCookieSafe(value: string): void {
  if (!/^[a-z0-9-]+$/u.test(value)) {
    throw new Error("appearance cookie values are bare keywords");
  }
}
