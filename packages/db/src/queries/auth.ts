import { count, eq, sql } from "drizzle-orm";

import { authSession, authTwoFactor, authUser, twoFactorResets } from "../schema/index.js";
import type { Executor } from "./executor.js";

// No helper here may read or return a credential: no password hash, no TOTP secret, no
// backup codes. better-auth owns every write to these tables except the two below.

/** A verified admin session joined to the identity fields authorization needs. */
export interface AdminSessionRow {
  readonly sessionId: string;
  /** Idle expiry better-auth maintains on the row; past it the session is dead. */
  readonly expiresAt: Date;
  /** The SEC-1 absolute-lifetime anchor. */
  readonly createdAt: Date;
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly twoFactorEnabled: boolean;
  /** The API must refuse a session holding a provisional credential (SEC-1). */
  readonly mustChangePassword: boolean;
}

/**
 * Resolve a better-auth session token to its session and user, or `undefined`. Reports
 * only what is stored: enforcing expiry, 2FA policy and the provisional-credential gate
 * is the caller's obligation.
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
      mustChangePassword: authUser.mustChangePassword,
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
    // Nullable in better-auth's own schema, so normalize rather than leak a tri-state
    // to policy.
    twoFactorEnabled: row.twoFactorEnabled === true,
    mustChangePassword: row.mustChangePassword,
  };
}

/**
 * Clear the provisional-credential flag on one account.
 *
 * Call only from the `account.update.after` better-auth hook in
 * `apps/api/src/features/auth/instance.ts`: a successful password change is the only event
 * SEC-1 lets clear the flag, so no route handler, sign-in or session refresh may call it.
 */
export async function clearMustChangePassword(exec: Executor, userId: string): Promise<void> {
  await exec
    .update(authUser)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(authUser.id, userId));
}

/**
 * How many admin accounts exist. `0` is the only state `create-admin` accepts, which is
 * what closes self-registration.
 */
export async function countAdminUsers(exec: Executor): Promise<number> {
  const [row] = await exec.select({ total: count() }).from(authUser);
  return row?.total ?? 0;
}

// The `qcms:reset-2fa` break-glass, in plain SQL because the TOTP secret and recovery codes are ciphertext
// under `QCMS_ADMIN_AUTH_SECRET`. Who may run it is decided in
// `apps/api/src/features/auth/reset-two-factor.ts`.

/** An admin account, as the reset resolves it from the email an operator typed. */
export interface AdminIdentityRow {
  readonly userId: string;
  /** The stored address, which may differ from the argument in case. */
  readonly email: string;
  readonly twoFactorEnabled: boolean;
}

/**
 * Every admin whose address matches `email` ignoring case. Postgres compares text
 * case-sensitively, so the unique index on `user.email` admits two rows that are one
 * address to an operator; the caller must refuse rather than guess between them.
 */
export async function findAdminsByEmail(
  exec: Executor,
  email: string,
): Promise<AdminIdentityRow[]> {
  const rows = await exec
    .select({
      userId: authUser.id,
      email: authUser.email,
      twoFactorEnabled: authUser.twoFactorEnabled,
    })
    .from(authUser)
    .where(sql`lower(${authUser.email}) = lower(${email})`);
  return rows.map((row) => ({
    userId: row.userId,
    email: row.email,
    twoFactorEnabled: row.twoFactorEnabled === true,
  }));
}

/** One admin's own account row, for a caller reading their own account. */
export async function findAdminById(
  exec: Executor,
  userId: string,
): Promise<(AdminIdentityRow & { readonly name: string }) | undefined> {
  const [row] = await exec
    .select({
      userId: authUser.id,
      email: authUser.email,
      name: authUser.name,
      twoFactorEnabled: authUser.twoFactorEnabled,
    })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  if (row === undefined) return undefined;
  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    twoFactorEnabled: row.twoFactorEnabled === true,
  };
}

/**
 * Delete every second factor on one account and clear its enrolment flag. Both halves
 * always: either alone leaves an account nobody can sign in to. Zero deleted rows is not
 * an error.
 */
export async function clearAdminTwoFactor(exec: Executor, userId: string): Promise<number> {
  const deleted = await exec
    .delete(authTwoFactor)
    .where(eq(authTwoFactor.userId, userId))
    .returning({ id: authTwoFactor.id });
  await exec
    .update(authUser)
    .set({ twoFactorEnabled: false, updatedAt: new Date() })
    .where(eq(authUser.id, userId));
  return deleted.length;
}

/** What a break-glass run records about itself. */
export interface TwoFactorResetRecord {
  readonly userId: string;
  readonly email: string;
  readonly databaseRole: string;
  readonly clearedFactors: number;
  readonly wasEnrolled: boolean;
}

/** Append the break-glass audit row, returning its id. */
export async function recordTwoFactorReset(
  exec: Executor,
  record: TwoFactorResetRecord,
): Promise<string> {
  const [row] = await exec.insert(twoFactorResets).values(record).returning({
    id: twoFactorResets.id,
  });
  if (row === undefined) throw new Error("two_factor_resets insert returned no row");
  return row.id;
}
