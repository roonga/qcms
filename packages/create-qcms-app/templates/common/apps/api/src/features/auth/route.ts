import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { errorResponses } from "../../openapi.js";
import { makeRecoveryCodesHandler } from "./handler.js";
import { AUTH_BASE_PATH, createAdminAuth, type AdminAuth } from "./instance.js";
import { RecoveryCodesResponse } from "./schema.js";

/**
 * The admin identity provider's HTTP surface (task 056; SEC-1, SEC-4).
 *
 * Two registrars live here, in two different groups, and the split is the design:
 *
 * 1. {@link registerAdminAuthProxy} mounts better-auth on `/api/auth/*` in the
 *    **auth** group, which carries the SEC-4 channel token but no admin-session
 *    gate. It cannot carry one: these are the endpoints that *issue* a session.
 * 2. {@link registerAdminRecoveryCodes} adds one QCMS-owned route to the **admin**
 *    group, behind the ordinary admin-session gate, for the one operation better-auth
 *    deliberately does not expose over HTTP.
 *
 * ## Why the mount is an allowlist (SEC-1)
 *
 * The vendor's Hono integration is one handler for the whole endpoint set:
 * `app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))`. That
 * shape is kept - it is the supported way to serve the library, so each endpoint's
 * request and response handling stays the library's rather than ours - but a bare
 * version of it publishes `POST /api/auth/sign-up/email`, which is a
 * self-registration path, and SEC-1 requires that "no self-registration path exists
 * in any composition".
 *
 * So the handler is preceded by {@link ALLOWED_AUTH_ENDPOINTS}: a request whose
 * method and path are not on the list never reaches `auth.handler` and answers `404`,
 * the same answer an unmounted route gives. The list is short because the admin's
 * flows are short, and it is the thing to read when asking "what of better-auth is
 * exposed here": seven operations, none of which creates an account.
 *
 * This is stricter than what it replaces. Before this task the admin mounted no
 * better-auth route at all and called `auth.api.*` in process, and the guarantee was
 * asserted structurally (no `[...all]` segment under `app/`). That structural test
 * still stands on the admin side; here it becomes a *request* property as well:
 * `auth-mount.test.ts` posts to the sign-up path and requires a 404.
 *
 * ## Why sign-up still exists as a function
 *
 * `signUpEmail` is called exactly once, from the first-run bootstrap
 * (`features/auth/bootstrap.ts`) behind a zero-admins guard, in process, from a CLI.
 * A CLI is not HTTP-reachable, which is the whole distinction SEC-1 draws.
 */

/**
 * The better-auth endpoints this deployment serves, as `METHOD <path>` under
 * {@link AUTH_BASE_PATH}. Nothing else is reachable.
 *
 * One line per admin flow:
 *
 * - `POST /sign-in/email` - the sign-in POST, which for an enrolled account answers
 *   `{ twoFactorRedirect: true }` and issues no session at all.
 * - `GET /get-session` - the session read every admin page and route handler makes.
 * - `POST /sign-out` - deletes the session row, not just the cookie (SEC-1).
 * - `POST /change-password` - with `revokeOtherSessions` (SEC-1).
 * - `POST /two-factor/enable` - provisions a TOTP factor without enabling it.
 * - `POST /two-factor/verify-totp` - completes enrollment, or answers a challenge.
 * - `POST /two-factor/verify-backup-code` - redeems a single-use recovery code.
 *
 * Absent on purpose: `sign-up/email` (SEC-1, above); `two-factor/disable` and
 * `two-factor/generate-backup-codes`, because no screen offers either and an
 * unreachable endpoint is one fewer thing to reason about; `two-factor/send-otp` and
 * `two-factor/verify-otp`, because OTP delivery is Phase 4; `two-factor/get-totp-uri`,
 * because the URI is handed to the enrollment screen by the sign-in POST that
 * provisioned it (the admin's `lib/server/enrollment.ts` explains why); and every
 * social, organization and passkey route, since no such plugin is configured.
 */
export const ALLOWED_AUTH_ENDPOINTS: readonly string[] = [
  "POST /sign-in/email",
  "GET /get-session",
  "POST /sign-out",
  "POST /change-password",
  "POST /two-factor/enable",
  "POST /two-factor/verify-totp",
  "POST /two-factor/verify-backup-code",
];

const ALLOWED = new Set(ALLOWED_AUTH_ENDPOINTS);

/**
 * One instance per `Deps`, built on first use.
 *
 * *Per `Deps`* rather than per module, because a test file composes several apps over
 * different databases in one process and a module-level singleton would capture the
 * first one forever. *On first use* rather than at registration, because `createApp`
 * also runs in the OpenAPI generator and in dozens of unit tests that never send an
 * auth request, and building the instance there would make them pay for a database
 * adapter they never touch.
 */
const instances = new WeakMap<Deps, AdminAuth>();

function authFor(deps: Deps): AdminAuth {
  const existing = instances.get(deps);
  if (existing !== undefined) return existing;
  const built = createAdminAuth({ db: deps.db, adminAuth: deps.config.adminAuth });
  instances.set(deps, built);
  return built;
}

/** The sub-path under {@link AUTH_BASE_PATH}, always leading-slashed. */
export function authSubPath(url: string): string {
  const { pathname } = new URL(url);
  const rest = pathname.startsWith(AUTH_BASE_PATH) ? pathname.slice(AUTH_BASE_PATH.length) : "";
  return rest === "" ? "/" : rest;
}

/**
 * Mount better-auth in the auth group: the vendor's handler shape, with the
 * allowlist in front of it.
 *
 * The 404 carries no reason and names no endpoint, so probing the surface cannot
 * distinguish "not on the allowlist" from "not a better-auth endpoint" (SEC-1: no
 * enumeration).
 */
export const registerAdminAuthProxy: SliceRegistrar = (group, deps) => {
  group.on(["GET", "POST"], "/*", async (c) => {
    const request = c.req.raw;
    if (!ALLOWED.has(`${request.method} ${authSubPath(request.url)}`)) {
      throw new ApiError("not_found", 404, "Not Found");
    }
    return authFor(deps).handler(request);
  });
};

/**
 * `POST /admin/auth/recovery-codes` - read back the signed-in admin's recovery codes.
 *
 * POST rather than GET even though it reads: a GET response is the kind of thing a
 * proxy, a prefetch or a browser history entry retains, and these are one-time
 * secrets. There is no request body for the same reason the handler takes the user id
 * from the principal.
 *
 * No `withScopes` annotation, deliberately. The SEC-5 taxonomy is about **domain
 * resources** (`forms:*`, `responses:*`, `webhooks:manage`); this route reads the
 * caller's own credential and fits none of them. Inventing an entry would be a SEC-5
 * amendment, which this task does not own, and a `/api/v1` machine token has no
 * business reaching an interactive enrollment step in any case.
 *
 * The admin's one-shot display marker (`RECOVERY_VIEW_COOKIE`) governs *when* the
 * screen may call this; that is a BFF concern and stays in the BFF.
 */
export const recoveryCodesRoute = createRoute({
  method: "post",
  path: "/auth/recovery-codes",
  tags: ["auth"],
  summary: "Read back the signed-in admin's TOTP recovery codes (admin)",
  responses: {
    200: {
      description: "The account's recovery codes",
      content: { "application/json": { schema: RecoveryCodesResponse } },
    },
    // 401: no valid admin session. 409: the account has no TOTP factor.
    ...errorResponses(401, 409),
  },
});

export const registerAdminRecoveryCodes: SliceRegistrar = (group, deps) => {
  group.openapi(
    recoveryCodesRoute,
    makeRecoveryCodesHandler(() => authFor(deps)),
  );
};
