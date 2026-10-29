/**
 * Kept free of `next/headers` so the cookie's security attributes are unit-testable in
 * plain Vitest. The session token lives only in this httpOnly cookie and never in client
 * JS (SEC).
 */

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

// Bounded by the API's own session TTL.
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export function sessionCookieOptions(
  secure: boolean,
  maxAge: number = DEFAULT_SESSION_MAX_AGE_SECONDS,
): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge };
}
