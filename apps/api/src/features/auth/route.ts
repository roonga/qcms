import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { accountStateRefusal, authEndpointRefused } from "./account-state.js";
import { AUTH_BASE_PATH, createAdminAuth, type AdminAuth } from "./instance.js";

/** Allowlist endpoints so sign-up and organization writes cannot become public through a vendor mount. */
export const ALLOWED_AUTH_ENDPOINTS: readonly string[] = [
  "POST /sign-in/email",
  "GET /get-session",
  "POST /sign-out",
  "POST /change-password",
  "POST /two-factor/enable",
  "POST /two-factor/verify-totp",
  "POST /two-factor/verify-backup-code",
  "POST /two-factor/generate-backup-codes",
];

const ALLOWED = new Set(ALLOWED_AUTH_ENDPOINTS);

/** Keyed on `Deps`, not module-level: one process composes several apps over different databases. */
const instances = new WeakMap<Deps, AdminAuth>();

/** Read throttle state from the mounted instance; a second instance could report a different configuration. */
export function adminAuthFor(deps: Deps): AdminAuth {
  const existing = instances.get(deps);
  if (existing !== undefined) return existing;
  const built = createAdminAuth({
    db: deps.databases.control,
    adminAuth: deps.config.adminAuth,
    // Operator-only channel: the variable that turns the breach check off never goes to
    // the client that provoked the warning.
    warn: (message) => {
      deps.logger.warn(message);
    },
  });
  instances.set(deps, built);
  return built;
}

export function authSubPath(url: string): string {
  const { pathname } = new URL(url);
  const rest = pathname.startsWith(AUTH_BASE_PATH) ? pathname.slice(AUTH_BASE_PATH.length) : "";
  return rest === "" ? "/" : rest;
}

/**
 * Mounted in the auth group with no admin-session gate, since these endpoints issue the session. The 404
 * carries no reason, so probing cannot distinguish "not allowlisted" from "not a better-auth endpoint" (no
 * enumeration).
 */
export const registerAdminAuthProxy: SliceRegistrar = (group, deps) => {
  group.on(["GET", "POST"], "/*", async (c) => {
    const request = c.req.raw;
    const endpoint = `${request.method} ${authSubPath(request.url)}`;
    if (!ALLOWED.has(endpoint)) {
      throw new ApiError("not_found", 404, "Not Found");
    }
    const auth = adminAuthFor(deps);
    // These endpoints change a credential and enrol a factor, so the account's state is read
    // here as well as on `/admin`, which is the only place it used to be read. Sign-in holds
    // no session yet and is refused where the session is minted instead.
    if (await authEndpointRefused(auth, request, endpoint)) throw accountStateRefusal();
    return auth.handler(request);
  });
};
