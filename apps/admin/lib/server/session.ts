import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, twoFactorOptional } from "./auth.ts";
import { sessionPolicy } from "./config.ts";

/**
 * The one place an admin page or route handler asks "who is signed in, and may
 * they be here" (task 031, exit criterion 1).
 *
 * ## Why the check lives here and not in `proxy.ts`
 *
 * Next's proxy (middleware) runs before every request and would be the cheapest
 * place to bounce an anonymous visitor, but it is the wrong **authority**: it can
 * see a cookie, not whether the session behind it exists, is expired, or has
 * completed 2FA. Answering that needs a database read. So the proxy sets security
 * headers only, and the authenticated route group's layout calls
 * {@link requireAdminSession}, which every page under it inherits. A page added to
 * that group in tasks 032-035 is gated by construction rather than by remembering
 * to add a guard.
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
 */
export async function currentAdminSession(): Promise<AdminSession | undefined> {
  const requestHeaders = await headers();
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (result === null) return undefined;

  const issuedAt = new Date(result.session.createdAt).getTime();
  if (Date.now() - issuedAt >= sessionPolicy().maxAgeMs) return undefined;

  return {
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role: result.user.role ?? "admin",
    twoFactorEnabled: result.user.twoFactorEnabled === true,
    token: result.session.token,
  };
}

/**
 * The authenticated-shell guard: return the session or redirect. Applies all three
 * gates. `redirect()` throws, so the return type is honest - callers get a session
 * or never continue.
 */
export async function requireAdminSession(): Promise<AdminSession> {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);
  if (!session.twoFactorEnabled && !twoFactorOptional()) redirect(ENROLL_PATH);
  return session;
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
