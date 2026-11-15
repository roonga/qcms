import { ApiError } from "../../errors.js";
import type { AdminAuth } from "./instance.js";

/**
 * The allowlisted endpoints an unclaimed account still reaches, because together they are
 * the claim: the single-use link lands on the forced password and factor screens, which
 * post here. A disabled account reaches none of them.
 */
export const CLAIM_AUTH_ENDPOINTS: readonly string[] = [
  "GET /get-session",
  "POST /sign-out",
  "POST /change-password",
  "POST /two-factor/enable",
  "POST /two-factor/verify-totp",
];

const CLAIM = new Set(CLAIM_AUTH_ENDPOINTS);

/** The same value-free answer the admin-session gate gives: neither says why. */
export function accountStateRefusal(): ApiError {
  return new ApiError("unauthorized", 401, "Admin authentication required");
}

/**
 * Whether the account behind this request's session is refused one allowlisted auth
 * endpoint. The row is read per request through the library's own session read, so a
 * disable takes effect at once; a request carrying no session is left to the handler.
 */
export async function authEndpointRefused(
  auth: AdminAuth,
  request: Request,
  endpoint: string,
): Promise<boolean> {
  const resolved = await auth.api.getSession({ headers: request.headers });
  if (resolved === null) return false;
  const { disabledAt, claimedAt } = resolved.user;
  if (disabledAt !== null && disabledAt !== undefined) return true;
  const unclaimed = claimedAt === null || claimedAt === undefined;
  return unclaimed && !CLAIM.has(endpoint);
}
