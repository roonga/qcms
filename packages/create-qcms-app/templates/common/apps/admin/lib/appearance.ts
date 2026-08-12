/**
 * The operator's one runtime appearance choice: colour MODE (task 055).
 *
 * Pure, client-safe and shared. The root layout resolves the mode during SSR and the
 * topbar control re-applies it in the browser, so the class names, the cookie name
 * and the parser have to be one definition rather than two that agree by inspection.
 *
 * Deliberately NOT under `lib/server/`: it reads no environment and holds no secret,
 * and the R2 import-surface test forbids a client component from reaching into
 * `lib/server/` at all.
 *
 * WHY A COOKIE RATHER THAN localStorage
 * The choice has to be readable on the SERVER, because the root class must be right
 * in the first byte of HTML or the operator watches the app repaint. `localStorage`
 * is unreachable during SSR, so a localStorage-backed control can only correct the
 * page after it loads, which is the flash. A cookie rides the navigation, so
 * `app/layout.tsx` stamps the class before anything is painted.
 *
 * And there is no pre-paint script here, unlike the portal's. The one input the
 * server cannot see - the machine's `prefers-color-scheme` - is handled inside the
 * token sheet by a media block that applies when no mode class is present at all
 * (`app/theme.css`). So the default follows the OS with no script, which keeps the
 * app's CSP free of any inline-script allowance of its own (`lib/server/csp.ts`).
 *
 * This cookie is presentation chrome, never a credential: no `httpOnly` (the browser
 * has to write it), `SameSite=Lax`, and `Secure` in production. Nothing about an
 * operator's identity or session is inferable from it.
 */

/**
 * The three modes, which are also the root class names.
 *
 * `light` is a real selection rather than an absence even though Light is the token
 * sheet's bare `:root` block: the class carries no values and exists only so an
 * operator who picks Light on a dark-preferring machine opts out of the sheet's
 * `prefers-color-scheme` block. `hc` is only ever reached by choosing it - nothing
 * infers high-contrast from a media query, which is the whole point of listing it
 * here rather than deriving it.
 */
export const MODES = ["light", "dark", "hc"] as const;
export type Mode = (typeof MODES)[number];

/**
 * Distinct from the portal's `qcms-theme` on purpose. In development and in the e2e
 * harness both apps are served from `localhost` on different ports, and cookies do
 * not distinguish ports - one shared name would mean changing the operator's app
 * mode every time a respondent screen changed a respondent's.
 */
export const MODE_COOKIE = "qcms-app-mode";

/** A year: a mode choice is a preference, not a session, and nothing it holds expiry protects. */
export const MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * An explicit choice, or `undefined` when there is none.
 *
 * The `undefined` return is the point: "no cookie" and "a cookie holding nonsense"
 * must both fall through to the sheet's OS-following default, and a parser that
 * substituted Light here would silently pin every new operator to Light on a
 * dark-preferring machine.
 */
export function parseMode(raw: string | undefined): Mode | undefined {
  return MODES.find((mode) => mode === raw);
}

/** The `document.cookie` assignment string for a mode choice. */
export function modeCookie(mode: Mode, secure: boolean): string {
  const attributes = [
    `${MODE_COOKIE}=${mode}`,
    "Path=/",
    `Max-Age=${MODE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
