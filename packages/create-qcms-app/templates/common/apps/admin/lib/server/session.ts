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
 * Four gates, in order, each a redirect rather than an error page because the
 * visitor can act on all four:
 *
 * 1. **No live session** (no cookie, unknown token, or past its idle expiry) goes
 *    to sign-in.
 * 2. **Past the absolute 12h lifetime** (SEC-1) also goes to sign-in, flagged so
 *    the page can say the session expired rather than looking like a random
 *    logout. better-auth's own expiry is the idle window and a warm session keeps
 *    renewing it, so this cap is measured from `session.createdAt`, which a
 *    refresh does not touch. The API's admin-auth middleware applies the same rule
 *    to every proxied call, so the two sides cannot disagree about a stale session.
 * 3. **The bootstrap credential is still in place** goes to the forced
 *    change-password screen (task 061, SEC-1). `qcms:create-admin` sets a password
 *    that came from a shell command, a provisioning script or a CI variable, and
 *    `user.mustChangePassword` says so durably - a session claim or a cookie would
 *    not survive a restart, a sign-out, or a second browser, which is exactly what
 *    this has to survive. The API applies the same rule to every proxied call.
 * 4. **2FA enrollment not complete** goes to enrollment, unless
 *    `QCMS_ADMIN_2FA=optional` (the documented development escape hatch). An
 *    account in this state can reach the enrollment screens and nothing else: the
 *    API rejects its session outright.
 *
 * ## Why the password change comes before the enrollment (task 061, exit criterion 5)
 *
 * Enrolling TOTP binds a second factor to an account, and the value of a second
 * factor is that the pair is stronger than either half. Binding it while the first
 * half is a credential that has sat in a CI variable and an operator's shell history
 * makes the pair only as good as its oldest member, and it asks for the fiddlier of
 * the two tasks - find a phone, scan a code, store ten recovery codes - at the moment
 * the account is weakest. Changing the password first costs one extra screen on
 * exactly one sign-in, ever.
 *
 * It also falls out of what each screen needs: enrollment needs an authenticator app
 * in someone's hand and a fifteen-minute cookie, a password change needs neither. The
 * always-possible step going first means nobody is parked on a screen they cannot
 * finish while still holding a credential they should not have.
 *
 * The order is a property of {@link sessionOutcome}'s gate list rather than of any
 * screen, so it is stated once and every caller inherits it.
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
   * Whether the account still holds the provisional credential `qcms:create-admin`
   * set (task 061, SEC-1). True for exactly one sign-in, and cleared by the change.
   */
  readonly mustChangePassword: boolean;
  /**
   * better-auth's session token. This is the credential the BFF forwards to the
   * API on the admin-session header (SEC-4: end-user authorization always comes
   * from the user's own credential). It never reaches the client bundle.
   */
  readonly token: string;
}

/** Where an unauthenticated visitor is sent. */
export const SIGN_IN_PATH = "/sign-in";
/**
 * Where an admin still holding the bootstrap credential is sent (task 061, SEC-1).
 *
 * A top-level route rather than one under `(shell)`, for the same reason sign-in and
 * the two-factor screens are: the shell's layout gate would redirect it to itself.
 */
export const CHANGE_PASSWORD_PATH = "/change-password";
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
      // Absent reads as false: see `auth-api.ts`'s note on the field. An account the
      // API never marked is not sent round a change it has no reason to make, and
      // the fail-closed half of this control is the API's own gate on the column.
      mustChangePassword: result.user.mustChangePassword === true,
      token: result.session.token,
    };
  },
);

/** Where the four gates land: a session, or the path the visitor is sent to. */
type SessionOutcome =
  | { readonly session: AdminSession; readonly redirectTo?: undefined }
  | {
      readonly session?: undefined;
      readonly redirectTo: typeof SIGN_IN_PATH | typeof CHANGE_PASSWORD_PATH | typeof ENROLL_PATH;
    };

/**
 * The four gates, decided but not yet acted on.
 *
 * Deciding and answering are separated because the two callers below have to answer
 * differently (a thrown `redirect()` for a page, a 303 `Response` for a request
 * handler) while agreeing exactly on the policy. Every gate is added here, so both
 * inherit it.
 *
 * **This function is the whole of exit criterion 3 for task 061** ("the gate survives
 * a new route being added"). The mechanism is inheritance, not a checklist: a page
 * added under `app/(shell)/` is rendered by a layout that calls
 * {@link requireAdminSession}, and a route handler or server action added there is
 * held to naming one of the two guards by `shell-route-guards.test.ts`, which reads
 * the route tree off disk. Both guards land here, so a gate added to this list
 * reaches every one of them without any of them being edited.
 *
 * What would defeat it, stated plainly rather than left to be discovered: a route
 * placed OUTSIDE `app/(shell)/`, where neither the layout nor the structural test
 * applies. That is not an oversight - it is where the auth screens have to live, and
 * this screen is one of them - but it is the seam, and a new top-level route is the
 * change that has to be thought about. The three existing top-level route families
 * each name their own guard for that reason: sign-in needs no session,
 * {@link requireEnrollingSession} deliberately skips gate 4, and
 * {@link requirePasswordChangeSession} deliberately skips gate 3. All three are in
 * this file, so the list of exceptions is one screenful and not a search.
 */
async function sessionOutcome(): Promise<SessionOutcome> {
  const session = await currentAdminSession();
  if (session === undefined) return { redirectTo: SIGN_IN_PATH };
  // Before the 2FA gate, deliberately: see "Why the password change comes before the
  // enrollment" in the file header.
  if (session.mustChangePassword) return { redirectTo: CHANGE_PASSWORD_PATH };
  if (!session.twoFactorEnabled && !twoFactorOptional()) return { redirectTo: ENROLL_PATH };
  return { session };
}

/**
 * The authenticated-shell guard for **pages and server actions**: return the session
 * or redirect. Applies all four gates. `redirect()` throws, so the return type is
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
 * whole point of being here, so gate 4 is not applied. An admin who has already
 * enrolled is sent back to the shell rather than allowed to re-provision a secret
 * by visiting the URL (re-enrollment is a deliberate action from Settings).
 *
 * Gate 3 **is** applied, and it has to be for the ordering in the file header to
 * mean anything: without it the enrollment screens would be the one place a
 * provisional credential could still act, reachable by typing the URL, and the
 * second factor bound there would be bound to an account whose password is still
 * the one from the provisioning script (task 061).
 */
export async function requireEnrollingSession(): Promise<AdminSession> {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);
  if (session.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
  if (session.twoFactorEnabled) redirect(SHELL_HOME_PATH);
  return session;
}

/**
 * The same guard for the enrollment flow's **route handlers**, answered as a 303
 * (Code Owner ruling, 2026-10-01).
 *
 * The screens had this and the handlers behind them did not, which made SEC-1's "can
 * reach the forced change screen and nothing else" true of what a browser is shown and
 * false of what the origin accepts: a provisional admin holding the enrollment cookie
 * could post a TOTP code straight at `/two-factor/enroll/verify` and bind a second
 * factor to an account whose password is still the one out of the provisioning script.
 * The API refused that account every admin route regardless, so nothing was reachable
 * with the factor - but "the order is enforced" was a claim about the screens, and the
 * sentence in SEC-1 is about the account.
 *
 * Gate 4 is skipped for the same reason {@link requireEnrollingSession} skips it:
 * incomplete 2FA is the whole point of being here. An already-enrolled admin is sent to
 * the shell rather than allowed to re-provision a factor by posting at the URL.
 */
export async function requireEnrollingSessionForRequest(): Promise<AdminSession | Response> {
  const session = await currentAdminSession();
  if (session === undefined) return redirectAfterPost(SIGN_IN_PATH);
  if (session.mustChangePassword) return redirectAfterPost(CHANGE_PASSWORD_PATH);
  if (session.twoFactorEnabled) return redirectAfterPost(SHELL_HOME_PATH);
  return session;
}

/**
 * The forced change-password screen's guard (task 061): a session is required, and a
 * flag that is still set is the whole point of being here, so gate 3 is not applied.
 *
 * The inverse of it is, though: an admin whose flag has been cleared is sent on
 * rather than shown the screen. That is what stops the screen becoming a second,
 * unguarded change-password surface for an ordinary signed-in admin, and it is what
 * makes exit criterion 4 ("an admin who has already changed their password is
 * unaffected") true of the URL as well as of the redirect.
 *
 * It is sent on to {@link ENROLL_PATH} or to the shell by the same rule
 * {@link sessionOutcome} applies, rather than always to the shell, because an
 * unenrolled account arriving here after its change has gate 4 still ahead of it and
 * `SHELL_HOME_PATH` would only bounce it there through one extra round trip.
 */
export async function requirePasswordChangeSession(): Promise<AdminSession> {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);
  if (!session.mustChangePassword) {
    redirect(!session.twoFactorEnabled && !twoFactorOptional() ? ENROLL_PATH : SHELL_HOME_PATH);
  }
  return session;
}

/**
 * The same guard for the forced screen's **route handler**, answered as a 303.
 *
 * Its own function rather than a `Response`-shaped variant of every guard above,
 * because exactly one handler needs it and the reason it cannot use
 * {@link requireAdminSessionForRequest} is the point of the screen: that guard
 * redirects a flagged session to this very path, so the handler that clears the flag
 * would refuse itself in a loop. See `route-helpers.ts` for why a form POST is
 * refused with a 303 and never with `redirect()`'s 307.
 */
export async function requirePasswordChangeSessionForRequest(): Promise<AdminSession | Response> {
  const session = await currentAdminSession();
  if (session === undefined) return redirectAfterPost(SIGN_IN_PATH);
  if (!session.mustChangePassword) {
    return redirectAfterPost(
      !session.twoFactorEnabled && !twoFactorOptional() ? ENROLL_PATH : SHELL_HOME_PATH,
    );
  }
  return session;
}
