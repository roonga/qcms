import type { RouteHandler } from "@hono/zod-openapi";
import { APIError } from "better-auth/api";

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
    } catch (error) {
      // ONLY better-auth's own refusal becomes a 409, and the narrowness is the point.
      //
      // A bare `catch` here reported a database outage, a dead connection pool and a
      // library bug as "no recovery codes exist for this account" - a 409 an operator
      // would read as their own account state while the deployment was on fire. The two
      // refusals this endpoint can legitimately raise are `BACKUP_CODES_NOT_ENABLED` and
      // `INVALID_BACKUP_CODE`, both thrown as `APIError.from("BAD_REQUEST", ...)`
      // (better-auth 1.6.25, `dist/plugins/two-factor/backup-codes/index.mjs:329` and
      // `:331`), so an `APIError` at `BAD_REQUEST` is exactly the "state, not fault" set.
      // A driver throw is not an `APIError` at all and now surfaces as the opaque 500 it
      // is (`middleware/error-envelope.ts`).
      //
      // The 409's message is fixed and value-free either way: repeating the library's
      // would tell the caller about the account's 2FA state (SEC-1: no enumeration), and
      // the rethrown error's message never reaches a body - the envelope logs it with a
      // correlation id and answers with internals stripped, which is the API-side form of
      // the discipline `apps/admin/lib/ops/unexpected.ts` applies to a screen (SEC-8).
      if (error instanceof APIError && error.status === "BAD_REQUEST") {
        throw new ApiError("conflict", 409, "No recovery codes exist for this account");
      }
      throw error;
    }
    return c.json({ codes: [...backupCodes] }, 200);
  };
}
