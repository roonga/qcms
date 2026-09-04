import { cookies } from "next/headers";

import { secureCookies } from "./config.ts";

/**
 * The two short-lived cookies that carry an in-progress 2FA enrollment (task 031).
 *
 * ## Why the TOTP URI travels in a cookie
 *
 * The signed screen contract puts the QR code and the manual setup key on the enrollment
 * screen, with no password field: the admin has just signed in, so asking again
 * would be a screen the design does not have. But better-auth's `getTOTPURI`
 * requires the password (correctly - re-authentication before revealing a factor),
 * and the only moment the password exists is the sign-in POST. So the sign-in
 * handler provisions enrollment there (`enableTwoFactor`) and hands the resulting
 * `otpauth://` URI forward in {@link ENROLLMENT_COOKIE}.
 *
 * That is a secret in a cookie, so it is worth being explicit about why it is an
 * acceptable one. The URI contains the TOTP secret, and the enrollment screen
 * **displays that same secret on the page** - it must, because the manual key is
 * the accessible alternative to the QR image. So the cookie exposes nothing the
 * response body does not, to the same audience, for a shorter time: it is
 * `httpOnly` (no script can read it), `SameSite=Strict` (no cross-site request
 * carries it), `Secure` outside development, scoped to `/two-factor`, capped at
 * fifteen minutes, and deleted the moment enrollment completes. The alternative
 * designs are worse: keeping the password to re-derive the URI would put a
 * long-lived credential where a single-use secret is now, and a server-side staging
 * table would add a schema for a value that already lives in `twoFactor.secret`.
 *
 * ## Why the recovery codes travel the same way (issue #319)
 *
 * The recovery codes are shown exactly once (the screen contract: "codes never shown
 * again"), and until #319 that display was fed by a QCMS route that read them back out
 * of the database on demand. Reading them back is the thing that made "shown once"
 * untrue, so the route is gone and there is no path anywhere that returns the codes on
 * record. What is left are the two moments better-auth **hands them out**: enrollment
 * (`two-factor/enable`) and regeneration (`two-factor/generate-backup-codes`).
 *
 * Both of those moments are a POST that ends in a redirect, so the codes have to cross
 * one hop to reach the screen that prints them. {@link RECOVERY_CODES_COOKIE} is that
 * hop, and it replaces the old permission marker: holding the codes *is* the permission,
 * so a revisit after the "I have saved these" confirm has nothing to print and
 * redirects, exactly as before.
 *
 * The same reasoning as {@link ENROLLMENT_COOKIE} applies, and more comfortably. The
 * cookie carries what the very next response body prints, to the same audience, for a
 * shorter time, with the same hardening (`httpOnly`, `SameSite=Strict`, `Secure`
 * outside development, scoped to `/two-factor`, fifteen minutes, deleted on confirm).
 * And what it carries is weaker than what the enrollment cookie already carries: ten
 * single-use codes rather than the permanent TOTP secret.
 *
 * ## Writers return strings, readers use `cookies()`
 *
 * Reading is done through `next/headers`. Writing is not: these cookies are always
 * set alongside a redirect that the route handler constructs itself, and a
 * hand-built `Response` does not pick up `cookies().set()` mutations. So the writers
 * here return a `Set-Cookie` value the handler appends to its own redirect, which
 * keeps the cookie and the redirect atomically the same response.
 */

/** Cookie carrying the pending enrollment's `otpauth://` URI. */
export const ENROLLMENT_COOKIE = "qcms_admin.enrollment";
/** Cookie carrying the codes owed to the one-time recovery-code display. */
export const RECOVERY_CODES_COOKIE = "qcms_admin.recovery_codes";

/** Fifteen minutes: long enough to install an authenticator app, not longer. */
const ENROLLMENT_TTL_SECONDS = 15 * 60;

/** The path both cookies are scoped to; nothing outside enrollment sees them. */
const COOKIE_PATH = "/two-factor";

/** Serialize one enrollment cookie with the shared hardening attributes. */
function serialize(name: string, value: string, maxAgeSeconds: number): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secureCookies()) attributes.push("Secure");
  return attributes.join("; ");
}

/** `Set-Cookie` stashing the pending enrollment's TOTP URI. */
export function pendingEnrollmentCookie(totpUri: string): string {
  return serialize(ENROLLMENT_COOKIE, totpUri, ENROLLMENT_TTL_SECONDS);
}

/** `Set-Cookie` clearing the enrollment cookie. */
export function clearEnrollmentCookie(): string {
  return serialize(ENROLLMENT_COOKIE, "", 0);
}

/** `Set-Cookie` handing a freshly issued set of codes to the one-time display. */
export function recoveryCodesCookie(codes: readonly string[]): string {
  return serialize(RECOVERY_CODES_COOKIE, JSON.stringify(codes), ENROLLMENT_TTL_SECONDS);
}

/** `Set-Cookie` spending the one-time recovery-code display. */
export function clearRecoveryCodesCookie(): string {
  return serialize(RECOVERY_CODES_COOKIE, "", 0);
}

/** The pending enrollment's TOTP URI, or `undefined` when there is none. */
export async function pendingEnrollment(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(ENROLLMENT_COOKIE)?.value;
}

/**
 * The codes owed to the one-time display, or `undefined` when none are.
 *
 * Anything that is not a non-empty array of strings reads as "nothing owed" rather
 * than as an error: the only writer is {@link recoveryCodesCookie}, so a malformed
 * value is a tampered or truncated cookie, and the right answer to that is the same
 * redirect a missing cookie gets. Nothing about the value is logged (SEC-8).
 */
export async function owedRecoveryCodes(): Promise<string[] | undefined> {
  const jar = await cookies();
  const raw = jar.get(RECOVERY_CODES_COOKIE)?.value;
  if (raw === undefined || raw === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  return parsed.every((code) => typeof code === "string") ? parsed : undefined;
}
