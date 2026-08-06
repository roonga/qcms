import type { RouteHandler } from "@hono/zod-openapi";

import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { AdminAuth } from "./instance.js";
import type { recoveryCodesRoute } from "./route.js";

/**
 * Handler for `POST /admin/auth/recovery-codes` (task 056).
 *
 * The account is the **caller's own**, always: the user id comes from the principal
 * the admin-auth middleware verified, never from the request (there is no request
 * body). So no admin can read another account's codes, and the route needs no
 * authorization logic of its own beyond the gate it already sits behind.
 *
 * `viewBackupCodes` is `createAuthEndpoint.serverOnly` in better-auth 1.6.25 - no HTTP
 * path, no client method, deliberately, because it returns decrypted secrets. Calling
 * it from trusted server code with a session-derived `userId` is the vendor's stated
 * use for it, and this handler is the only place in QCMS that does.
 */
export function makeRecoveryCodesHandler(
  auth: () => AdminAuth,
): RouteHandler<typeof recoveryCodesRoute, ApiEnv> {
  return async (c) => {
    const principal = c.get("adminPrincipal");
    // Defensive: the middleware sets this before any admin handler runs, so an
    // absent principal is a composition bug rather than an unauthenticated caller.
    if (principal === undefined) throw new ApiError("unauthorized", 401, "Unauthorized");

    let backupCodes: readonly string[];
    try {
      ({ backupCodes } = await auth().api.viewBackupCodes({ body: { userId: principal.userId } }));
    } catch {
      // better-auth refuses when the account has no TOTP factor or no stored codes.
      // That is a state, not a fault, and its message is not repeated: it would tell
      // the caller about the account's 2FA state (SEC-1: no enumeration). Nothing is
      // logged either - the thrown error's message can quote a code (SEC-8).
      throw new ApiError("conflict", 409, "No recovery codes exist for this account");
    }
    return c.json({ codes: [...backupCodes] }, 200);
  };
}
