import type { Executor } from "@roonga/qcms-db";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { claimAfterFactorVerified } from "../accounts/claim.js";
import { accountStateRefusal, authEndpointRefused } from "./account-state.js";
import { AUTH_BASE_PATH, createAdminAuth, type AdminAuth } from "./instance.js";
import { spendTotpCode } from "./totp.js";

/** The one endpoint that can turn an unclaimed account's enrolment into a claim. */
const TOTP_VERIFY_ENDPOINT = "POST /two-factor/verify-totp";

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

/**
 * An uncached instance whose writes run on `db`, for a caller that must write through the
 * library inside its own transaction.
 */
export function adminAuthOn(deps: Deps, db: Executor): AdminAuth {
  return createAdminAuth({
    db,
    adminAuth: deps.config.adminAuth,
    // Operator-only channel: the variable that turns the breach check off never goes to
    // the client that provoked the warning.
    warn: (message) => {
      deps.logger.warn(message);
    },
  });
}

/** Read throttle state from the mounted instance; a second instance could report a different configuration. */
export function adminAuthFor(deps: Deps): AdminAuth {
  const existing = instances.get(deps);
  if (existing !== undefined) return existing;
  const built = adminAuthOn(deps, deps.databases.control);
  instances.set(deps, built);
  return built;
}

/**
 * The account the vendor's verify response names, never a session read before it ran: the
 * vendor falls back to the pending-second-factor cookie when that session no longer resolves.
 * The session kept is the one the response issues, else the one it verified on.
 */
async function verifiedAccount(
  auth: AdminAuth,
  response: Response,
): Promise<{ readonly userId: string; readonly keepToken: string | undefined } | undefined> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { token?: unknown; user?: { id?: unknown } } | null;
  const userId = body?.user?.id;
  if (typeof userId !== "string") return undefined;
  const issued = await issuedSession(auth, response);
  if (issued !== undefined) {
    return issued.userId === userId ? { userId, keepToken: issued.token } : undefined;
  }
  return { userId, keepToken: typeof body?.token === "string" ? body.token : undefined };
}

/** The session a response issues, read back off its `Set-Cookie` headers. */
async function issuedSession(
  auth: AdminAuth,
  response: Response,
): Promise<{ readonly userId: string; readonly token: string } | undefined> {
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter((value): value is string => value !== undefined && value !== "")
    .join("; ");
  if (cookie === "") return undefined;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  return session === null ? undefined : { userId: session.user.id, token: session.session.token };
}

/**
 * Spend the code of a factor check made on a session before the vendor sees it, so it cannot
 * be spent again at sign-in or step-up. A sign-in, which holds no session, is judged by the
 * session-create hook instead. `false` means refused.
 */
async function sessionCodeSpent(auth: AdminAuth, deps: Deps, request: Request): Promise<boolean> {
  const resolved = await auth.api.getSession({ headers: request.headers });
  if (resolved === null) return true;
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown } | null;
  if (typeof body?.code !== "string") return true;
  const { secretConfig } = await auth.$context;
  return spendTotpCode(deps.databases.control, secretConfig, {
    userId: resolved.user.id,
    code: body.code,
    verifiedOnly: false,
  });
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
    // here as well as on `/admin`. Sign-in and sign-out are exempt: neither is the stale
    // cookie's to decide, and the session-create hook refuses the sign-in instead.
    if (await authEndpointRefused(auth, request, endpoint)) throw accountStateRefusal();
    if (endpoint === TOTP_VERIFY_ENDPOINT && !(await sessionCodeSpent(auth, deps, request))) {
      return Response.json({ code: "INVALID_CODE", message: "Invalid code" }, { status: 401 });
    }
    const response = await auth.handler(request);
    // The claim is finished by the act, not by the screen that posted it: the account
    // holds nothing until a password and a verified second factor both exist.
    if (endpoint === TOTP_VERIFY_ENDPOINT && response.ok) {
      const verified = await verifiedAccount(auth, response);
      if (verified !== undefined) {
        await claimAfterFactorVerified(deps, verified.userId, verified.keepToken);
      }
    }
    return response;
  });
};
