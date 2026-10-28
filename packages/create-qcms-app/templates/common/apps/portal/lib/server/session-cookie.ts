import { cookies } from "next/headers";

import { SESSION_COOKIE, secureCookies } from "./config";
import { sessionCookieOptions } from "./cookie-options";

/**
 * The respondent session token lives only in an httpOnly cookie and never in client JS
 * (SEC). `sameSite: "lax"` lets the top-level navigation from a secure-link email carry
 * the cookie while blocking cross-site POST use.
 */

export async function readSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function writeSessionToken(token: string, maxAgeSeconds?: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(secureCookies(), maxAgeSeconds));
}

export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
