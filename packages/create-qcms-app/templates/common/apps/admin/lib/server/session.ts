import { cache } from "react";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { proxiedSession } from "./auth-api.ts";
import { sessionMaxAgeMs, twoFactorOptional } from "./config.ts";
import { redirectAfterPost } from "./route-helpers.ts";

/**
 * The one place an admin page or route handler asks "who is signed in, and may
 * they be here" (task 031, exit criterion 1).
 *
 * ## Why the check lives here and not in `proxy.ts`
 *
 * Next's proxy (middleware) runs before every request and would be the cheapest
 * place to bounce an anonymous visitor, but it is the wrong **authority**: it can
 * see a cookie, not whether the session behind it exists, is expired, or has
 * completed 2FA. Answering that needs a database read, which since task 056 means a
 * call to the API's session endpoint - the admin holds no database handle at all. So
 * the proxy sets security headers only, and the authenticated route group's layout
 * calls {@link requireAdminSession}, which every page under it inherits. A page added
 * to that group in tasks 032-035 is gated by construction rather than by remembering
 * to add a guard.
 *
 * Nothing here validates a cookie signature. The session is resolved by asking the
 * API, which reads the row (task 056; before it, the same read happened in process
 * through better-auth's adapter). A signature would prove the cookie was minted by
 * this deployment and nothing about whether the session behind it still exists, which
 * is the property all three gates below actually depend on.
 *
 * ## Why a layout gate is not the whole story (issue #177)
 *
 * A Next layout wraps the **page** tree. It never runs for a `route.ts` or for a
 * `"use server"` action in the same segment: both are request handlers the browser
 * reaches directly. So "it is inside `(shell)`" is not evidence that anything
 * authenticated it, and each handler applies the policy itself - a server action via
 * {@link requireAdminSession}, a route handler via
 * {@link requireAdminSessionForRequest}, which is the same three gates answered as a
 * redirect response rather than a thrown `redirect()`.
 *
 * Both are one policy, not two copies: they share {@link sessionOutcome} below. A
 * handler that open-coded `currentAdminSession()` plus its own enrollment check would
 * enforce today's gates and silently miss tomorrow's fourth one, which is the failure
 * this module exists to prevent. `shell-route-guards.test.ts` is the structural
 * tripwire that keeps every handler under `app/(shell)/` naming one of the two.
 *
 * ## What "may they be here" means at launch
 *
 * Three gates, in order, each a redirect rather than an error page because the
 * visitor can act on all three:
 *
 * 1. **No live session** (no cookie, unknown token, or past its idle expiry) goes
 *    to sign-in.
 * 2. **Past the absolute 12h lifetime** (SEC-1) also goes to sign-in, flagged so
 *    the page can say the session expired rather than looking like a random
 *    logout. better-auth's own expiry is the idle window and a warm session keeps
 *    renewing it, so this cap is measured from `session.createdAt`, which a
 *    refresh does not touch. The API's admin-auth middleware applies the same rule
 *    to every proxied call, so the two sides cannot disagree about a stale session.
 * 3. **2FA enrollment not complete** goes to enrollment, unless
 *    `QCMS_ADMIN_2FA=optional` (the documented development escape hatch). An
 *    account in this state can reach the enrollment screens and nothing else: the
 *    API rejects its session outright.
 *
 * Authorization beyond "is an authenticated admin" is deliberately absent. Launch
 * ships one role (SEC-3) and enforcement lives in the API layer, never in the BFF
 * (R2) and never only in the UI.
 */

/** The signed-in admin, as the shell needs it. Carries no credential. */
export interface AdminSession {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  /** The SEC-3 role claim; a single `admin` value at launch. */
  readonly role: string;
  /** Whether TOTP enrollment is complete. */
  readonly twoFactorEnabled: boolean;
  /**
   * better-auth's session token. This is the credential the BFF forwards to the
   * API on the admin-session header (SEC-4: end-user authorization always comes
   * from the user's own credential). It never reaches the client bundle.
   */
  readonly token: string;
}

/** Where an unauthenticated visitor is sent. */
export const SIGN_IN_PATH = "/sign-in";
/** Where a signed-in-but-unenrolled admin is sent (SEC-1 2FA policy). */
export const ENROLL_PATH = "/two-factor/enroll";
/** The default landing area of the authenticated shell. */
export const SHELL_HOME_PATH = "/questions";

/**
 * Resolve the current session, or `undefined` when there is none the shell would
 * accept. Applies gates 1 and 2 above (existence, idle expiry, absolute lifetime)
 * but not the 2FA gate, because the enrollment screens need a session that has not
 * passed it yet.
 *
 * ## Once per request, not once per caller (issue #626)
 *
 * `cache()` is React's per-request memo: the wrapped function runs at most once for a
 * given argument list within one request, and every later caller gets that result
 * back. The reason it is needed here is structural rather than a matter of taste. A
 * Next layout, the page it wraps and a `@rail` parallel slot are three separate React
 * trees rendered for one request, and none of them can hand a value to another, so
 * each one asks this question for itself: rendering a single form-scoped screen made
 * three `GET /auth/get-session` calls, all with the same answer. The duplication
 * predates the rail - the shell layout and every page have both called
 * `requireAdminSession()` since task 031 - and it was the rail landing on eight routes
 * that made it worth counting.
 *
 * **The memo is per request, so it is not a cache in the sense that matters for
 * security.** Nothing is retained across requests, nothing is shared between visitors,
 * and no session outlives the render that read it: two requests carrying the same
 * cookie still read the session row twice, so a session revoked between them is
 * refused by the second. What is removed is only the app asking the same question
 * three times inside one render.
 *
 * .NET mapping: a scoped (per-request) service resolving once per request, except
 * that the scope is the framework's and no container is involved.
 *
 * The memo wraps this reader rather than {@link requireAdminSession}, because the
 * gates above it are pure decisions over the result: memoizing the read deduplicates
 * every caller, including {@link requireAdminSessionForRequest} and
 * {@link requireEnrollingSession}, without any of them caching a *redirect*.
 */
export const currentAdminSession: () => Promise<AdminSession | undefined> = cache(
  async (): Promise<AdminSession | undefined> => {
    const requestHeaders = await headers();
    const result = await proxiedSession(requestHeaders);
    if (result === undefined) return undefined;

    const issuedAt = new Date(result.session.createdAt).getTime();
    if (Date.now() - issuedAt >= sessionMaxAgeMs()) return undefined;

    return {
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role ?? "admin",
      twoFactorEnabled: result.user.twoFactorEnabled === true,
      token: result.session.token,
    };
  },
);

/** Where the three gates land: a session, or the path the visitor is sent to. */
type SessionOutcome =
  | { readonly session: AdminSession; readonly redirectTo?: undefined }
  | { readonly session?: undefined; readonly redirectTo: typeof SIGN_IN_PATH | typeof ENROLL_PATH };

/**
 * The three gates, decided but not yet acted on.
 *
 * Deciding and answering are separated because the two callers below have to answer
 * differently (a thrown `redirect()` for a page, a 303 `Response` for a request
 * handler) while agreeing exactly on the policy. Every gate is added here, so both
 * inherit it.
 */
async function sessionOutcome(): Promise<SessionOutcome> {
  const session = await currentAdminSession();
  if (session === undefined) return { redirectTo: SIGN_IN_PATH };
  if (!session.twoFactorEnabled && !twoFactorOptional()) return { redirectTo: ENROLL_PATH };
  return { session };
}

/**
 * The authenticated-shell guard for **pages and server actions**: return the session
 * or redirect. Applies all three gates. `redirect()` throws, so the return type is
 * honest - callers get a session or never continue.
 */
export async function requireAdminSession(): Promise<AdminSession> {
  const outcome = await sessionOutcome();
  if (outcome.session === undefined) redirect(outcome.redirectTo);
  return outcome.session;
}

/**
 * The same guard for a **route handler**: the session, or the `Response` to return.
 *
 * A route handler cannot call {@link requireAdminSession}. `redirect()` signals with a
 * `NEXT_REDIRECT` throw that Next answers with **307**, and a 307 asks the browser to
 * repeat the request - so refusing a form POST that way re-posts the credential at the
 * sign-in screen. `redirectAfterPost` answers 303 instead, which the browser follows
 * with a GET.
 *
 * The call site narrows on the type rather than on a flag:
 *
 * ```ts
 * const session = await requireAdminSessionForRequest();
 * if (session instanceof Response) return session;
 * ```
 */
export async function requireAdminSessionForRequest(): Promise<AdminSession | Response> {
  const outcome = await sessionOutcome();
  return outcome.session ?? redirectAfterPost(outcome.redirectTo);
}

/**
 * The enrollment-screen guard: a session is required, but incomplete 2FA is the
 * whole point of being here, so gate 3 is not applied. An admin who has already
 * enrolled is sent back to the shell rather than allowed to re-provision a secret
 * by visiting the URL (re-enrollment is a deliberate action from Settings).
 */
export async function requireEnrollingSession(): Promise<AdminSession> {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);
  if (session.twoFactorEnabled) redirect(SHELL_HOME_PATH);
  return session;
}
