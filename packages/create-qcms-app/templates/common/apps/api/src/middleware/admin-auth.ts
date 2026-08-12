/**
 * Admin-group authentication (task 021's seam, made real in task 031; SEC-1,
 * SEC-3, SEC-4).
 *
 * The admin surface carries two independent gates. The internal service token
 * (SEC-4) authenticates the *channel* and is applied to every mounted group by
 * the composition root. This middleware is the second gate: it authenticates
 * the *admin user*. Every admin route sits behind it - an unauthenticated
 * request is rejected `401` before any handler (or database) is touched.
 *
 * **What crosses the wire.** The admin app owns better-auth (it is the shell,
 * where Node APIs and a session cookie both exist); the API never links the
 * library. The admin BFF forwards the signed-in user's better-auth **session
 * token** on {@link ADMIN_SESSION_HEADER}, and this middleware verifies it by
 * looking the session up in the deployment's own Postgres. That keeps the SEC-4
 * rule intact - end-user authorization comes from the user's own credential,
 * never from the channel token - and keeps handlers fetch-pure (R4): verifying a
 * session is one row read, not a library call, so no `node:*` API is involved.
 *
 * **What the verifier enforces (SEC-1).** The session must exist, must be inside
 * better-auth's own idle expiry (`session.expiresAt`, refreshed on activity),
 * must be inside the absolute lifetime cap measured from `session.createdAt`
 * (`QCMS_ADMIN_SESSION_MAX_AGE_MS`, default 12h - so a session kept warm forever
 * still dies), and - unless `QCMS_ADMIN_2FA=optional`, the documented development
 * escape hatch - must belong to an account that has completed TOTP enrollment. A
 * signed-in-but-not-yet-enrolled admin therefore reaches the enrollment screens
 * (which talk to better-auth in the shell, not to this API) and nothing else.
 *
 * The verifier resolves to an {@link AdminPrincipal} (or `undefined` when
 * unauthenticated). The principal is stashed on the request context: its `role`
 * is the SEC-3 claim (single `admin` value at launch, carried so Phase 4 RBAC is
 * additive) and its `scopes` are SEC-5 metadata, inert at launch.
 *
 * Nothing here logs the token, the email, or any part of a credential (SEC-8).
 */

import { getAdminSessionByToken } from "@qcms/db";
import type { Context, MiddlewareHandler } from "hono";

import type { SliceRegistrar } from "../app.js";
import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { AdminPrincipal, ApiEnv } from "../openapi.js";
import { SCOPES } from "../openapi.js";

/**
 * Header carrying the admin's better-auth session token, forwarded by the admin
 * BFF (R2: the BFF does sessions, credentials, proxying). The name is a private
 * contract between the admin app and the API; the channel it travels on is
 * already gated by the SEC-4 internal token, and no browser ever sends it.
 */
export const ADMIN_SESSION_HEADER = "x-qcms-admin-session";

/**
 * The verifier seam: verify the request's admin session and resolve the
 * principal, or `undefined` when the request is unauthenticated. Async because
 * verification is a database read. Keeping it a seam is what lets the
 * external-IdP swap recipe (`docs/auth-swap.md`) replace better-auth without
 * touching a route or a handler.
 */
export type AdminSessionVerifier = (c: Context<ApiEnv>) => Promise<AdminPrincipal | undefined>;

/**
 * The real verifier: resolve {@link ADMIN_SESSION_HEADER} to a live, in-policy
 * better-auth session (see the file header for the four conditions).
 *
 * Every rejection returns the same `undefined`, so the caller cannot tell an
 * unknown token from an expired one from a not-yet-enrolled account, and the 401
 * the middleware raises carries no reason (SEC-1: no enumeration).
 */
export function betterAuthSessionVerifier(deps: Deps): AdminSessionVerifier {
  return async (c) => {
    const token = c.req.header(ADMIN_SESSION_HEADER)?.trim();
    // No credential presented: reject before any database work.
    if (token === undefined || token === "") return undefined;

    const session = await getAdminSessionByToken(deps.db, token);
    if (session === undefined) return undefined;

    const now = deps.clock.now().getTime();
    // Idle expiry, maintained by better-auth on every refresh.
    if (session.expiresAt.getTime() <= now) return undefined;
    // Absolute lifetime, measured from issue: activity cannot extend it (SEC-1).
    if (now - session.createdAt.getTime() >= deps.config.adminSession.maxAgeMs) return undefined;
    // 2FA policy (SEC-1). `optional` is the development escape hatch only.
    if (deps.flags.adminTwoFactor === "required" && !session.twoFactorEnabled) return undefined;

    return { userId: session.userId, role: session.role, scopes: [...SCOPES] };
  };
}

/**
 * Build the admin-auth middleware around a verifier. Rejects an unverified
 * request `401`; on success stashes the principal for downstream scope checks.
 * The `unauthorized` code and value-free message match the internal-token gate -
 * neither reveals *why* to the caller.
 */
export function adminAuth(verify: AdminSessionVerifier): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const principal = await verify(c);
    if (principal === undefined) {
      throw new ApiError("unauthorized", 401, "Admin authentication required");
    }
    c.set("adminPrincipal", principal);
    await next();
  };
}

/**
 * The admin-group registrar wired by the composition root: the first registrar
 * in the admin bucket installs the auth middleware so it runs before every admin
 * slice's routes. Auth logic lives here, never inside a handler.
 */
export const registerAdminAuth: SliceRegistrar = (group, deps) => {
  group.use("*", adminAuth(betterAuthSessionVerifier(deps)));
};
