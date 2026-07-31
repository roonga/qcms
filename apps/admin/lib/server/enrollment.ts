import { cookies } from "next/headers";

import { isProduction } from "./config.ts";

/**
 * The two short-lived cookies that carry an in-progress 2FA enrollment (task 031).
 *
 * ## Why the TOTP URI travels in a cookie
 *
 * The signed wireframe puts the QR code and the manual setup key on the enrollment
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
 * ## Why the recovery-code view needs a marker
 *
 * The recovery codes are shown exactly once (the wireframe: "codes never shown
 * again"). They are fetched server-side at display time rather than carried in a
 * cookie, so what has to be one-shot is the *permission to see them*:
 * {@link RECOVERY_VIEW_COOKIE} is set by the enrollment verify step and cleared by
 * the "I have saved these" confirm, so revisiting the URL afterwards redirects
 * instead of re-displaying. It holds no code, only the fact that a display is owed.
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
/** Cookie granting the one-time recovery-code display. */
export const RECOVERY_VIEW_COOKIE = "qcms_admin.recovery_view";

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
  if (isProduction()) attributes.push("Secure");
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

/** `Set-Cookie` opening the one-time recovery-code display. */
export function recoveryViewCookie(): string {
  return serialize(RECOVERY_VIEW_COOKIE, "1", ENROLLMENT_TTL_SECONDS);
}

/** `Set-Cookie` spending the one-time recovery-code display. */
export function clearRecoveryViewCookie(): string {
  return serialize(RECOVERY_VIEW_COOKIE, "", 0);
}

/** The pending enrollment's TOTP URI, or `undefined` when there is none. */
export async function pendingEnrollment(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(ENROLLMENT_COOKIE)?.value;
}

/** Whether a one-time recovery-code display is owed. */
export async function recoveryDisplayOwed(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(RECOVERY_VIEW_COOKIE)?.value === "1";
}
