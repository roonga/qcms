import { count, eq } from "drizzle-orm";

import { authSession, authUser } from "../schema/index.js";
import type { Executor } from "./executor.js";

/**
 * Admin identity reads (task 031, SEC-1/SEC-3).
 *
 * better-auth owns every *write* to the auth tables: the admin shell configures
 * it with the Drizzle adapter over this package's schema, so users, sessions,
 * accounts and TOTP secrets are created, refreshed and deleted by the library.
 * These helpers are the two **reads** the rest of the system needs, and they are
 * here rather than in an app because both callers are outside the shell:
 *
 * - {@link getAdminSessionByToken} is what the API's admin-auth middleware uses
 *   to verify a forwarded admin session. The API stays fetch-pure (R4) and never
 *   links better-auth: verifying a session is a row lookup, not a library call.
 * - {@link countAdminUsers} is the first-run bootstrap guard: `qcms:create-admin`
 *   refuses to create an account once any admin user exists, which is what makes
 *   "no self-registration path exists in any composition" (SEC-1) true of the CLI
 *   as well as of the HTTP surface.
 *
 * Neither helper reads or returns a credential: no password hash, no TOTP secret,
 * no backup codes. `token` is an input here, never an output.
 */

/** The verified admin session joined to the identity fields authorization needs. */
export interface AdminSessionRow {
  /** `session.id` (better-auth's own row id), for correlation only. */
  readonly sessionId: string;
  /** Idle expiry better-auth maintains on the row; past it the session is dead. */
  readonly expiresAt: Date;
  /** When the session was first issued - the absolute-lifetime anchor (SEC-1). */
  readonly createdAt: Date;
  readonly userId: string;
  readonly email: string;
  /** SEC-3 role claim; `admin` for every account at launch. */
  readonly role: string;
  /** Whether the account has completed TOTP enrollment (SEC-1 2FA policy). */
  readonly twoFactorEnabled: boolean;
}

/**
 * Resolve a better-auth session token to its session + user, or `undefined` when
 * no such session exists. Expiry and 2FA policy are the **caller's** decision
 * (the API middleware applies both, so the policy lives with authorization
 * rather than with the read); this helper only reports what is stored.
 */
export async function getAdminSessionByToken(
  exec: Executor,
  token: string,
): Promise<AdminSessionRow | undefined> {
  const [row] = await exec
    .select({
      sessionId: authSession.id,
      expiresAt: authSession.expiresAt,
      createdAt: authSession.createdAt,
      userId: authUser.id,
      email: authUser.email,
      role: authUser.role,
      twoFactorEnabled: authUser.twoFactorEnabled,
    })
    .from(authSession)
    .innerJoin(authUser, eq(authUser.id, authSession.userId))
    .where(eq(authSession.token, token))
    .limit(1);
  if (row === undefined) return undefined;
  return {
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    userId: row.userId,
    email: row.email,
    role: row.role,
    // The column is nullable in better-auth's own schema (absent means "never
    // enrolled"), so normalize here rather than leaking a tri-state to policy.
    twoFactorEnabled: row.twoFactorEnabled === true,
  };
}

/** How many admin accounts exist. `0` is the only state `create-admin` accepts. */
export async function countAdminUsers(exec: Executor): Promise<number> {
  const [row] = await exec.select({ total: count() }).from(authUser);
  return row?.total ?? 0;
}
