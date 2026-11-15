import { ApiError } from "../../errors.js";
import type { AdminAuth } from "./instance.js";

/**
 * The allowlisted endpoints the mount does not judge by the request's session. Sign-in
 * carries its identity in the body rather than in the cookie, and the `session.create.before`
 * hook refuses the account it names; sign-out deletes only the session its own cookie names,
 * so every account can clear one. Judging either by the cookie refuses a person whose browser
 * still holds a stale session.
 */
export const SESSION_CHECK_EXEMPT_ENDPOINTS: readonly string[] = [
  "POST /sign-in/email",
  "POST /sign-out",
];

/**
 * The allowlisted endpoints an unclaimed account still reaches, because together they are
 * the claim: the single-use link lands on the forced password and factor screens, which
 * post here. A disabled account reaches none of them.
 */
export const CLAIM_AUTH_ENDPOINTS: readonly string[] = [
  "GET /get-session",
  "POST /change-password",
  "POST /two-factor/enable",
  "POST /two-factor/verify-totp",
];

const EXEMPT = new Set(SESSION_CHECK_EXEMPT_ENDPOINTS);
const CLAIM = new Set(CLAIM_AUTH_ENDPOINTS);

/** The same value-free answer the admin-session gate gives: neither says why. */
export function accountStateRefusal(): ApiError {
  return new ApiError("unauthorized", 401, "Admin authentication required");
}

/**
 * Whether the account behind this request's session is refused one allowlisted auth
 * endpoint. The row is read per request through the library's own session read, so a
 * disable takes effect at once; a request carrying no session, and an exempt endpoint, are
 * left to the handler.
 */
export async function authEndpointRefused(
  auth: AdminAuth,
  request: Request,
  endpoint: string,
): Promise<boolean> {
  if (EXEMPT.has(endpoint)) return false;
  const resolved = await auth.api.getSession({ headers: request.headers });
  if (resolved === null) return false;
  const { disabledAt, claimedAt } = resolved.user;
  if (disabledAt !== null && disabledAt !== undefined) return true;
  const unclaimed = claimedAt === null || claimedAt === undefined;
  return unclaimed && !CLAIM.has(endpoint);
}
