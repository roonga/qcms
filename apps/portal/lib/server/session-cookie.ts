import { cookies } from "next/headers";

import { SESSION_COOKIE, isProduction } from "./config";
import { sessionCookieOptions } from "./cookie-options";

/**
 * The respondent session token lives ONLY in an httpOnly, SameSite cookie -
 * never in client JS (SEC). The BFF reads it here and attaches it as the bearer
 * to internal API calls; the browser never sees it. `secure` is on in production
 * (see cookie-security test). `sameSite: "lax"` lets the top-level navigation
 * from a secure-link email carry the cookie while blocking cross-site POST use.
 * The pure attribute builder lives in `./cookie-options` (unit-tested there).
 */

/** Read the session bearer token from the request cookies (server-side only). */
export async function readSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/** Persist the session bearer token (route handler / server action context only). */
export async function writeSessionToken(token: string, maxAgeSeconds?: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(isProduction(), maxAgeSeconds));
}

/** Drop the session cookie (e.g. after submit or on an unrecoverable session). */
export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
