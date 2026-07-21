/**
 * Pure cookie-attribute builder for the session cookie (task 029), kept free of
 * `next/headers` so it is unit-testable in plain Vitest (cookie-security, exit
 * criterion 4). The session token lives ONLY in this httpOnly, SameSite cookie -
 * never in client JS (SEC); `secure` is on in production.
 */

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

/** Seconds a session cookie survives. Bounded by the API's own session TTL. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export function sessionCookieOptions(
  secure: boolean,
  maxAge: number = DEFAULT_SESSION_MAX_AGE_SECONDS,
): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge };
}
