import { cookies } from "next/headers";

import { authApiFetch } from "./api.ts";

/**
 * The admin's auth operations, each one call to the API's better-auth mount (task 056;
 * ADR-35 as amended 2026-07-31).
 *
 * ## What moved, and what deliberately did not
 *
 * Before this task the admin app owned the better-auth instance and its route handlers
 * called `auth.api.*` in process. The instance now lives in `apps/api` and the handlers
 * call the functions below instead. **The handlers themselves did not move**, and that
 * is a design decision rather than an omission:
 *
 * The auth screens are plain `<form method="post">` posting to named admin routes, so
 * the whole sign-in and 2FA loop works before (or entirely without) hydration and the
 * credential never passes through client JavaScript (`route-helpers.ts` records why).
 * A blind browser-facing `/api/auth/*` proxy would move that orchestration into the
 * browser - three fetches, a client-side better-auth client, and a flow that needs
 * JavaScript - and it would also republish the endpoint set the admin's SEC-1
 * structural test exists to keep absent. So the admin still forwards **one named
 * operation per handler**, and "the admin proxies `/api/auth/*`" means exactly that:
 * these eight calls, over the internal channel, with cookies carried back out.
 *
 * ## Why every function returns a `Response`
 *
 * The in-process calls these replace were made with `asResponse: true`, so the callers
 * already branch on a status and lift `Set-Cookie` headers off a `Response`
 * (`authRefused`, `cookiesFrom`). Keeping that shape means the handlers' logic is
 * unchanged by the move, which is what makes "byte-for-byte the same behaviour" a
 * reviewable claim rather than a hope. It also drops the `catch (APIError)` blocks the
 * in-process calls needed: over HTTP a refusal is always a status, never a throw, and
 * every call site already checked the status because `asResponse: true` made refusals
 * arrive that way too.
 *
 * A genuine transport failure (the API is down) still throws, and still surfaces as a
 * 500 from the route handler. That is the same outcome an unexpected library throw had
 * before, and it is the right one: an admin told "wrong password" because the API was
 * unreachable would be a worse answer than an error page.
 *
 * ## Cookies
 *
 * better-auth sets cookies on the API's response; each handler moves them onto its own
 * 303 with `getSetCookie()`. Because the browser only ever sees the admin origin, the
 * cookies land first-party to the admin with their `HttpOnly`, `SameSite=Lax` and
 * (outside development) `Secure` attributes exactly as better-auth wrote them - the hop
 * copies the header, it does not re-serialize it.
 */

/**
 * better-auth's cookie names, as this app reads them.
 *
 * Duplicated from the API's `COOKIE_PREFIX` rather than imported, for the same reason
 * `ADMIN_SESSION_HEADER` is: the two apps are separate deployables with no shared
 * package, and a wire contract between them is written down on both sides and kept in
 * lockstep. The admin never *writes* these - better-auth does, and the handlers copy its
 * `Set-Cookie` headers verbatim - it only reads the two-factor cookie to answer "is a
 * challenge pending" on the challenge and recovery screens. A drift would break the
 * admin Playwright suite's 2FA specs immediately, which is where it would be caught.
 */
const COOKIE_PREFIX = "qcms_admin";

/** The session cookie better-auth issues, without its security prefix. */
export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;

/** The short-lived cookie carrying a pending 2FA challenge, without its security prefix. */
export const TWO_FACTOR_COOKIE = `${COOKIE_PREFIX}.two_factor`;

/**
 * Read one of better-auth's cookies by its **unprefixed** name (issue #317).
 *
 * better-auth renames its own cookies when it is issuing secure ones:
 * `createCookieGetter` builds the name as `${secureCookiePrefix}${prefix}.${cookieName}`
 * and sets `secureCookiePrefix` to `__Secure-` whenever `advanced.useSecureCookies` is
 * true (better-auth 1.6.25, `dist/cookies/index.mjs:20-21` and `:28-31`). So the cookie
 * this app has to find is `qcms_admin.two_factor` in development and
 * `__Secure-qcms_admin.two_factor` in any deployment with secure cookies on - which is
 * the default compose shape, since `docker/admin.Dockerfile` bakes `NODE_ENV=production`.
 *
 * A bare `cookies().get(TWO_FACTOR_COOKIE)` therefore finds nothing in production and the
 * challenge screen bounces to sign-in forever. The library solves this for itself by
 * trying both names (`dist/cookies/index.mjs:216`:
 * `parsedCookie.get(\`__Secure-${name}\`) ?? parsedCookie.get(name)`), and this is that
 * fallback on our side of the hop.
 *
 * It matches by **suffix** rather than by trying the two literal spellings, for the same
 * reason `auth.integration.test.ts` does: `__Host-` is the other prefix the spec defines
 * and better-auth already has a constant for it, so an upstream switch to it stays
 * covered. The suffix is anchored with a leading `.` from `COOKIE_PREFIX`, so
 * `qcms_admin.session_token` can never satisfy a lookup for `qcms_admin.two_factor`.
 *
 * Not caught by any gate we have, which is why it shipped in 031 and survived 056's green
 * runs: the browser suite runs over http on localhost with secure cookies off, so the
 * prefixed form never appears in CI.
 */
export async function readAuthCookie(unprefixedName: string): Promise<string | undefined> {
  const jar = await cookies();
  const exact = jar.get(unprefixedName)?.value;
  if (exact !== undefined) return exact;
  return jar.getAll().find((cookie) => cookie.name.endsWith(`-${unprefixedName}`))?.value;
}

/** The session shape better-auth's `get-session` returns, as the admin reads it. */
export interface ProxiedSession {
  readonly session: {
    readonly token: string;
    /** ISO instant; the 12h absolute cap (SEC-1) is measured from it. */
    readonly createdAt: string;
  };
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    /** The SEC-3 role claim; a single `admin` value at launch. */
    readonly role?: string;
    readonly twoFactorEnabled?: boolean;
  };
}

/**
 * Read the current session, or `undefined` when the cookies name none.
 *
 * This is the one auth call whose body the admin parses rather than forwarding, because
 * the three gates in `session.ts` are decisions about its contents. better-auth answers
 * `null` (a 200 with a `null` body) for "no session", which is not an error and must not
 * be treated as one.
 */
export async function proxiedSession(requestHeaders: Headers): Promise<ProxiedSession | undefined> {
  const response = await authApiFetch("/get-session", { from: requestHeaders });
  if (!response.ok) return undefined;
  const body = (await response.json()) as ProxiedSession | null;
  if (body === null) return undefined;
  return body;
}

/** Sign in with email and password. A 4xx is a refusal the caller reports generically. */
export function signInEmail(
  requestHeaders: Headers,
  credentials: { readonly email: string; readonly password: string },
): Promise<Response> {
  return authApiFetch("/sign-in/email", {
    method: "POST",
    body: credentials,
    from: requestHeaders,
  });
}

/** Sign out: better-auth deletes the session row, not merely the cookie (SEC-1). */
export function signOut(requestHeaders: Headers): Promise<Response> {
  return authApiFetch("/sign-out", { method: "POST", body: {}, from: requestHeaders });
}

/**
 * Provision a TOTP factor. Returns the response so the caller can distinguish a
 * refusal; the body carries the `otpauth://` URI and the recovery codes.
 */
export function enableTwoFactor(
  requestHeaders: Headers,
  password: string,
  cookie: string,
): Promise<Response> {
  const headers = new Headers(requestHeaders);
  headers.set("cookie", cookie);
  return authApiFetch("/two-factor/enable", { method: "POST", body: { password }, from: headers });
}

/** Verify a TOTP code: completes enrollment, or answers a pending challenge. */
export function verifyTotp(requestHeaders: Headers, code: string): Promise<Response> {
  return authApiFetch("/two-factor/verify-totp", {
    method: "POST",
    body: { code },
    from: requestHeaders,
  });
}

/** Redeem a single-use recovery code as the second factor. */
export function verifyBackupCode(requestHeaders: Headers, code: string): Promise<Response> {
  return authApiFetch("/two-factor/verify-backup-code", {
    method: "POST",
    body: { code },
    from: requestHeaders,
  });
}

/**
 * Issue a fresh set of recovery codes, replacing the set on record (issue #319).
 *
 * better-auth requires the account password here
 * (`dist/plugins/two-factor/backup-codes/index.mjs:279-281`), which is the whole
 * reason this replaced the route that read the stored codes back: re-authentication
 * arrives with the operation instead of needing a freshness rule of our own, and
 * whatever set was on record stops working the moment the new one is written.
 */
export function generateBackupCodes(requestHeaders: Headers, password: string): Promise<Response> {
  return authApiFetch("/two-factor/generate-backup-codes", {
    method: "POST",
    body: { password },
    from: requestHeaders,
  });
}

/** Change the signed-in admin's password, revoking every other session (SEC-1). */
export function changePassword(
  requestHeaders: Headers,
  passwords: { readonly currentPassword: string; readonly newPassword: string },
): Promise<Response> {
  return authApiFetch("/change-password", {
    method: "POST",
    body: { ...passwords, revokeOtherSessions: true },
    from: requestHeaders,
  });
}
