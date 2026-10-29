import { getAdminSessionByToken } from "@roonga/qcms-db";
import type { Context, MiddlewareHandler } from "hono";

import type { SliceRegistrar } from "../app.js";
import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { AdminPrincipal, ApiEnv } from "../openapi.js";
import { SCOPES } from "../openapi.js";

/**
 * Private contract with the admin BFF: no browser ever sends it, and the channel
 * it travels on is already gated by the SEC-4 internal token.
 */
export const ADMIN_SESSION_HEADER = "x-qcms-admin-session";

/** A seam so the external-IdP swap (`docs/auth-swap.md`) touches no route or handler. */
export type AdminSessionVerifier = (c: Context<ApiEnv>) => Promise<AdminPrincipal | undefined>;

/**
 * Every rejection returns the same `undefined`, so a caller cannot tell an unknown
 * token from an expired one from a not-yet-enrolled account (SEC-1: no enumeration).
 */
export function betterAuthSessionVerifier(deps: Deps): AdminSessionVerifier {
  return async (c) => {
    const token = c.req.header(ADMIN_SESSION_HEADER)?.trim();
    if (token === undefined || token === "") return undefined;

    const session = await getAdminSessionByToken(deps.databases.control, token);
    if (session === undefined) return undefined;

    const now = deps.clock.now().getTime();
    if (session.expiresAt.getTime() <= now) return undefined;
    // Absolute lifetime, measured from issue: activity cannot extend it (SEC-1).
    if (now - session.createdAt.getTime() >= deps.config.adminSession.maxAgeMs) return undefined;
    // `optional` is a development escape hatch only (SEC-1).
    if (deps.flags.adminTwoFactor === "required" && !session.twoFactorEnabled) return undefined;
    // The bootstrap credential is provisional and has no escape hatch (SEC-1).
    if (session.mustChangePassword) return undefined;

    return { userId: session.userId, role: session.role, scopes: [...SCOPES] };
  };
}

/** The value-free message matches the internal-token gate: neither reveals why. */
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

/** First registrar in the admin bucket, so it runs before every admin slice's routes. */
export const registerAdminAuth: SliceRegistrar = (group, deps) => {
  group.use("*", adminAuth(betterAuthSessionVerifier(deps)));
};
