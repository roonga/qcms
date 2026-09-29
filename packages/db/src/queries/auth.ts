import { count, eq, sql } from "drizzle-orm";

import { authSession, authTwoFactor, authUser, twoFactorResets } from "../schema/index.js";
import type { Executor } from "./executor.js";

/**
 * Admin identity reads (task 031, SEC-1/SEC-3), plus the two sanctioned writes
 * (issue #432, task 061).
 *
 * better-auth owns **almost** every write to the auth tables: the admin shell
 * configures it with the Drizzle adapter over this package's schema, so users,
 * sessions, accounts and TOTP secrets are created, refreshed and deleted by the
 * library. This paragraph used to say "every", and the two exceptions are recorded
 * where they live rather than as a quiet relaxation of it. The break-glass reset at
 * the bottom of this file removes a second factor, and it exists because the state
 * it recovers from is one the library cannot act in at all.
 * {@link clearMustChangePassword} clears one boolean of ours, and it exists because
 * the field is ours: better-auth is told about it as a `user.additionalFields` entry,
 * so it returns it on the session user, but it has no concept that would ever write
 * it.
 *
 * The reads are the ones the rest of the system needs, and they are here rather
 * than in an app because their callers are outside the shell:
 *
 * - {@link getAdminSessionByToken} is what the API's admin-auth middleware uses
 *   to verify a forwarded admin session. The API stays fetch-pure (R4) and never
 *   links better-auth: verifying a session is a row lookup, not a library call.
 * - {@link countAdminUsers} is the first-run bootstrap guard: `qcms:create-admin`
 *   refuses to create an account once any admin user exists, which is what makes
 *   "no self-registration path exists in any composition" (SEC-1) true of the CLI
 *   as well as of the HTTP surface.
 *
 * No helper in this file reads or returns a credential: no password hash, no TOTP
 * secret, no backup codes. `token` is an input here, never an output, and the
 * reset **deletes** the row holding the secret and the codes without ever
 * selecting their contents.
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
  /**
   * Whether the account still holds the provisional credential `qcms:create-admin`
   * set (task 061, SEC-1). True means the admin app sends this session to the forced
   * change screen and the API refuses it on every admin route.
   */
  readonly mustChangePassword: boolean;
}

/**
 * Resolve a better-auth session token to its session + user, or `undefined` when
 * no such session exists. Expiry, 2FA policy and the provisional-credential gate
 * are the **caller's** decision (the API middleware applies all three, so the policy
 * lives with authorization rather than with the read); this helper only reports what
 * is stored.
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
    // The column is nullable in better-auth's own schema (absent means "never
    // enrolled"), so normalize here rather than leaking a tri-state to policy.
    twoFactorEnabled: row.twoFactorEnabled === true,
    mustChangePassword: row.mustChangePassword,
  };
}

/**
 * Clear the provisional-credential flag on one account (task 061, SEC-1).
 *
 * The second sanctioned write to the auth tables, and it is narrower than the
 * break-glass below it: one boolean, from `true` to `false`, on one row. It exists
 * because better-auth has no "must change password" concept at 1.7.6 - no core
 * option, no first-party plugin, nothing in `databaseHooks` that consumes a user
 * field - so the whole control is QCMS's, and the clearing half has to be a write
 * somebody makes.
 *
 * **Who calls it is the load-bearing part.** Exactly one caller: the
 * `account.update.after` database hook the API installs on better-auth, which fires
 * when the library writes a new password hash to a credential account. That is the
 * only event that means "this password was successfully changed", which is what SEC-1
 * says clears the flag. It is not called from a route handler, so no request can ask
 * for it; it is not called on sign-in, sign-out or session refresh, so none of those
 * clears it. `apps/api/src/features/auth/instance.ts` holds the hook and the
 * reasoning.
 *
 * `updatedAt` moves with it, matching {@link clearAdminTwoFactor}: a row this package
 * writes without touching that column would report a modification time that predates
 * its own contents.
 */
export async function clearMustChangePassword(exec: Executor, userId: string): Promise<void> {
  await exec
    .update(authUser)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(authUser.id, userId));
}

/** How many admin accounts exist. `0` is the only state `create-admin` accepts. */
export async function countAdminUsers(exec: Executor): Promise<number> {
  const [row] = await exec.select({ total: count() }).from(authUser);
  return row?.total ?? 0;
}

/**
 * The one exception to "better-auth owns every write to the auth tables"
 * (issue #432).
 *
 * The three helpers below are the storage half of the `qcms:reset-2fa`
 * break-glass. They exist because the situation the command recovers from is one
 * better-auth cannot act in: the stored TOTP secret and the recovery codes are
 * ciphertext under `QCMS_ADMIN_AUTH_SECRET`, so when that key is gone the library
 * can neither verify a factor nor disable one on the account's behalf, and its
 * `disableTwoFactor` endpoint needs a signed-in session the locked-out operator
 * cannot produce. Deleting the row is the only operation that still means
 * something, and it is plain SQL rather than a library call for exactly that
 * reason.
 *
 * They are still shape-preserving writes with no policy in them: who may run
 * them, whether the connected role is allowed to, and whether an operator
 * confirmed are all decided in `apps/api/src/features/auth/reset-two-factor.ts`.
 */

/** An admin account, as the reset resolves it from the email an operator typed. */
export interface AdminIdentityRow {
  readonly userId: string;
  /** The **stored** address, which may differ from the argument in case. */
  readonly email: string;
  readonly twoFactorEnabled: boolean;
}

/**
 * Every admin whose address matches `email` ignoring case.
 *
 * Case-insensitive on purpose, and it is what makes the ambiguity real rather
 * than theoretical. `user.email` is unique, so an exact match can never return
 * two rows and a "more than one match" refusal would be dead code. Postgres
 * compares text case-sensitively, so `Ada@example.test` and `ada@example.test`
 * are two distinct rows under that unique index and one address to the operator
 * typing it. Resolving the way a human reads the argument is therefore the only
 * resolution that can be wrong, and the caller refuses rather than guessing which
 * account was meant.
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

/**
 * Delete every second factor on one account and clear its enrolment flag.
 *
 * Both halves, always, because either one alone leaves an account nobody can use.
 * A `twoFactor` row without `twoFactorEnabled` is an abandoned enrolment the
 * plugin ignores; `twoFactorEnabled` without a `twoFactor` row is an account that
 * is asked for a code no stored secret can produce, which is the shape the
 * lockout this command exists for already has. The recovery codes need no
 * separate statement: better-auth keeps them in `twoFactor.backupCodes`, so they
 * go with the row.
 *
 * Returns how many factor rows were deleted. Zero is not an error - see
 * `two_factor_resets` for why a no-op run is still recorded.
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

/** Append the audit row, returning its id so the command can print it. */
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
