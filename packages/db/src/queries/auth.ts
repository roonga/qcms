import { count, eq, sql } from "drizzle-orm";

import { authSession, authTwoFactor, authUser, twoFactorResets } from "../schema/index.js";
import type { Executor } from "./executor.js";

/**
 * Admin identity reads (task 031, SEC-1/SEC-3), plus the one sanctioned write
 * (issue #432).
 *
 * better-auth owns **almost** every write to the auth tables: the admin shell
 * configures it with the Drizzle adapter over this package's schema, so users,
 * sessions, accounts and TOTP secrets are created, refreshed and deleted by the
 * library. This paragraph used to say "every", and the break-glass reset is the
 * deliberate exception recorded at the bottom of this file rather than a quiet
 * relaxation of it: there is exactly one write here, it removes a second factor,
 * and it exists because the state it recovers from is one the library cannot act
 * in at all.
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
