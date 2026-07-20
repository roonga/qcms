/**
 * Admin-group authentication seam (task 021; SEC-1, SEC-4).
 *
 * The admin surface carries two independent gates. The internal service token
 * (SEC-4) authenticates the *channel* and is applied to every mounted group by
 * the composition root. This middleware is the second gate: it authenticates
 * the *admin user*. Every admin route sits behind it — an unauthenticated
 * request is rejected `401` before any handler (or database) is touched.
 *
 * **This is a real seam with a permissive stub today.** The middleware never
 * changes; only the {@link AdminSessionVerifier} it wraps does. At launch the
 * stub reads a session-marker header so slice tests can drive authenticated and
 * unauthenticated requests. Task 031 replaces {@link stubAdminSessionVerifier}
 * with real better-auth session (cookie) verification and 2FA policy (SEC-1) —
 * a one-line swap at {@link makeAdminAuth}, no handler or route touched. Auth
 * logic lives here, never inside a handler.
 *
 * The verifier resolves to an {@link AdminPrincipal} (or `undefined` when
 * unauthenticated). The principal is stashed on the request context for later
 * scope enforcement; its `scopes` are SEC-5 metadata, inert at launch.
 */

import type { Context, MiddlewareHandler } from "hono";

import type { SliceRegistrar } from "../app.js";
import { ApiError } from "../errors.js";
import type { AdminPrincipal, ApiEnv } from "../openapi.js";
import { SCOPES } from "../openapi.js";

/**
 * Header carrying the stubbed admin session marker (launch stub only). 031
 * removes this in favour of the better-auth session cookie; nothing in the
 * product depends on the header name.
 */
export const ADMIN_SESSION_HEADER = "x-qcms-admin-session";

/**
 * The seam 031 fills: verify the request's admin session and resolve the
 * principal, or `undefined` when the request is unauthenticated. Async because
 * the real implementation validates a better-auth session (a DB/session-store
 * lookup); the stub is synchronous under the same signature.
 */
export type AdminSessionVerifier = (c: Context<ApiEnv>) => Promise<AdminPrincipal | undefined>;

/**
 * Permissive launch stub: any non-empty session-marker header authenticates,
 * granting every scope (scopes are inert at launch). No marker → unauthenticated.
 * SECURITY: this is deliberately trivial *authentication logic*, not a real
 * check — it exists so the seam and its 401 behaviour are exercised now; 031
 * makes it real. It reads no secret and logs nothing.
 */
export const stubAdminSessionVerifier: AdminSessionVerifier = (c) => {
  const marker = c.req.header(ADMIN_SESSION_HEADER)?.trim();
  if (marker === undefined || marker === "") return Promise.resolve(undefined);
  return Promise.resolve({ userId: `admin_${marker}`, scopes: [...SCOPES] });
};

/**
 * Build the admin-auth middleware around a verifier (defaults to the stub).
 * Rejects an unverified request `401`; on success stashes the principal for
 * downstream scope checks. The `unauthorized` code and value-free message match
 * the internal-token gate — neither reveals *why* to the caller.
 */
export function adminAuth(
  verify: AdminSessionVerifier = stubAdminSessionVerifier,
): MiddlewareHandler<ApiEnv> {
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
 * The admin-group seam wired by the composition root: the first registrar in
 * the admin bucket installs the auth middleware so it runs before every admin
 * slice's routes. Today it wraps the stub; 031 builds the real better-auth
 * verifier from `deps` — `(group, deps) => group.use("*", adminAuth(betterAuthVerifier(deps)))`
 * — the one line that swaps stub for real, no route or handler touched.
 */
export const registerAdminAuth: SliceRegistrar = (group) => {
  group.use("*", adminAuth());
};
