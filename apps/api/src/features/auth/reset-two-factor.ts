import {
  authTwoFactor,
  clearAdminTwoFactor,
  findAdminsByEmail,
  readConnectedRole,
  recordTwoFactorReset,
  RESET_TABLE_COUNT,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { eq } from "drizzle-orm";

/**
 * The `qcms:reset-2fa` break-glass (issue #432, Code Owner decision 2026-09-07).
 *
 * ## What this recovers from
 *
 * An administrator who cannot present a second factor cannot sign in, and until
 * this existed there was no way back that did not involve hand-editing the
 * database. Two ways in: a lost or wiped authenticator, and a changed or lost
 * `QCMS_ADMIN_AUTH_SECRET`, which is the key better-auth encrypts both the stored
 * TOTP secret and the recovery codes under. The second one bit task 056 in
 * development.
 *
 * It used to be survivable by accident, because the recovery codes were stored as
 * plain JSON and an operator with a database connection could read them out.
 * Issue #319 adopted `storeBackupCodes: "encrypted"`, which was right and which
 * closed that door; this is what takes its place, on purpose and written down.
 *
 * ## What it leaves behind
 *
 * A password-only account that must enrol again. Both halves of the enrolment go
 * (`clearAdminTwoFactor`), because either one alone leaves an account nobody can
 * use: the row without the flag is an abandoned enrolment, and the flag without
 * the row is an account asked for a code no stored secret can produce, which is
 * the lockout itself. On the next sign-in better-auth issues a session with no
 * challenge, and the SEC-1 default (`QCMS_ADMIN_2FA=required`) then forces
 * enrolment before the account reaches a single API route.
 *
 * **Live sessions are deliberately not revoked.** Any session that exists passed
 * the second factor when it was issued, so revoking it protects nothing that the
 * reset itself does not already give away, and the operator running a recovery is
 * usually the person those sessions belong to. A break-glass run in response to a
 * suspected compromise is a different operation, and the answer there is a
 * password change, which better-auth already invalidates sessions on (SEC-1).
 *
 * ## What guards it
 *
 * Possession of the migration role's database credential, and nothing else. That
 * is the whole guard and it is stated as such rather than dressed up:
 *
 * - **No HTTP surface.** A recovery route is a route, reachable by whoever can
 *   reach the admin, and its authentication would be the thing that is broken.
 *   The distinction SEC-1 has always drawn is that a route is HTTP-reachable and
 *   a command line is not.
 * - **No environment flag.** A flag that enables the command is a second thing to
 *   get wrong, and a deployment that leaves it on is a deployment where the guard
 *   is the flag rather than the credential.
 * - **Refused as `qcms_app`** (SEC-10). The credential every API process runs as
 *   holds DML on every table, so it could delete the row; what it does not hold is
 *   ownership of the schema, and that is what {@link readConnectedRole} tests. So
 *   an attacker who reaches the application credential - the one that is on a
 *   running box, in a process serving traffic - does not thereby reach this.
 * - **Dry run unless confirmed.** A bare invocation resolves the account, reports
 *   exactly what it would clear, and writes nothing.
 * - **Refused on an ambiguous or absent match.** Zero or more than one, both
 *   refusals: guessing which of two accounts an operator meant is the one mistake
 *   that cannot be undone by re-running.
 *
 * Every run that is confirmed appends a `two_factor_resets` row, including one
 * that found nothing to clear, and emits one SEC-13 allowlisted log event.
 */

/** Why a reset was refused. Every case is actionable by the operator. */
export type ResetRefusal =
  /**
   * The connected role does not own the schema, so it is not the migration role
   * (SEC-10). Carries the role name because the fix is a different `DATABASE_URL`
   * and the operator needs to see which credential they used.
   */
  | { readonly kind: "insufficient-database-role"; readonly role: string }
  /** The auth tables are not all present: this database has not been migrated. */
  | { readonly kind: "schema-missing"; readonly role: string; readonly tablesPresent: number }
  /** No admin has that address. */
  | { readonly kind: "no-such-admin"; readonly email: string }
  /** More than one admin has that address, ignoring case. See `findAdminsByEmail`. */
  | { readonly kind: "ambiguous-email"; readonly email: string; readonly matches: number };

/** The account a reset resolved, and what it would clear or did clear. */
export interface ResetTarget {
  readonly userId: string;
  /** The **stored** address, so the operator sees the spelling of record. */
  readonly email: string;
  /** `twoFactor` rows: how many would be, or were, deleted. */
  readonly factorRows: number;
  /** `user.twoFactorEnabled` before the reset. */
  readonly wasEnrolled: boolean;
}

export type ResetOutcome =
  /** A dry run: resolved and reported, nothing written. */
  | { readonly ok: true; readonly applied: false; readonly target: ResetTarget }
  /** Confirmed and applied, with the id of the audit row it appended. */
  | {
      readonly ok: true;
      readonly applied: true;
      readonly target: ResetTarget;
      readonly auditId: string;
      readonly databaseRole: string;
    }
  | { readonly ok: false; readonly refusal: ResetRefusal };

export interface ResetInput {
  /** The address an operator typed. Matched ignoring case. */
  readonly email: string;
  /** False (the default shape of a bare invocation) reports and writes nothing. */
  readonly confirm: boolean;
}

/**
 * Resolve an admin by email and, when confirmed, clear its second factor.
 *
 * Takes the executor so the caller owns the connection, exactly as
 * `createInitialAdmin` does: the CLI and the integration test drive the same
 * function against the same database the guard read `current_user` from.
 *
 * The order matters and is the order of the guards above: role first, so an
 * unauthorized connection never reads an account; then resolution, so an
 * ambiguous argument refuses before anything is written; then, only on `confirm`,
 * one transaction that deletes the factor and appends the audit row together. A
 * reset that happened without a record of it, or a record of one that did not,
 * are both worse than either failing.
 */
export async function resetAdminTwoFactor(
  exec: Executor,
  input: ResetInput,
): Promise<ResetOutcome> {
  const role = await readConnectedRole(exec);
  if (role.tablesPresent < RESET_TABLE_COUNT) {
    return {
      ok: false,
      refusal: { kind: "schema-missing", role: role.role, tablesPresent: role.tablesPresent },
    };
  }
  if (!role.ownsAuthTables) {
    return { ok: false, refusal: { kind: "insufficient-database-role", role: role.role } };
  }

  const matches = await findAdminsByEmail(exec, input.email);
  if (matches.length === 0) {
    return { ok: false, refusal: { kind: "no-such-admin", email: input.email } };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      refusal: { kind: "ambiguous-email", email: input.email, matches: matches.length },
    };
  }

  const [admin] = matches;
  if (admin === undefined) {
    return { ok: false, refusal: { kind: "no-such-admin", email: input.email } };
  }

  if (!input.confirm) {
    // A dry run counts the rows without deleting them, so the report is a
    // measurement rather than a prediction.
    const factorRows = await countFactorRows(exec, admin.userId);
    return {
      ok: true,
      applied: false,
      target: {
        userId: admin.userId,
        email: admin.email,
        factorRows,
        wasEnrolled: admin.twoFactorEnabled,
      },
    };
  }

  return exec.transaction(async (tx) => {
    const factorRows = await clearAdminTwoFactor(tx, admin.userId);
    const auditId = await recordTwoFactorReset(tx, {
      userId: admin.userId,
      email: admin.email,
      databaseRole: role.role,
      clearedFactors: factorRows,
      wasEnrolled: admin.twoFactorEnabled,
    });
    return {
      ok: true,
      applied: true,
      target: {
        userId: admin.userId,
        email: admin.email,
        factorRows,
        wasEnrolled: admin.twoFactorEnabled,
      },
      auditId,
      databaseRole: role.role,
    };
  });
}

/**
 * How many second-factor rows the account holds, for the dry run's report.
 *
 * A separate count rather than a shared read with the delete path: the delete
 * reports what it removed, which is the only number that can be asserted after
 * the fact, and a dry run reports what is there now. Conflating them would make
 * the dry run's number a guess at what a later run would do.
 */
async function countFactorRows(exec: Executor, userId: string): Promise<number> {
  const rows = await exec
    .select({ id: authTwoFactor.id })
    .from(authTwoFactor)
    .where(eq(authTwoFactor.userId, userId));
  return rows.length;
}

/**
 * The line an operator reads on a refusal. Value-free in the SEC-8 sense: it
 * names an address the operator typed and a role name, never a credential.
 */
export function describeResetRefusal(refusal: ResetRefusal): string {
  switch (refusal.kind) {
    case "insufficient-database-role":
      return (
        `Refusing: connected as database role "${refusal.role}", which does not own the schema. ` +
        "This command runs as the migration role (qcms_migrate in the shipped recipe) and " +
        "refuses the application credential, because possession of that credential is what " +
        "every API process already has (SEC-10). Point DATABASE_URL at the migration role."
      );
    case "schema-missing":
      return (
        `Refusing: connected as database role "${refusal.role}", and only ${refusal.tablesPresent} ` +
        `of the ${RESET_TABLE_COUNT} tables this command needs exist. ` +
        "Run the migrations first (qcms-db-migrate)."
      );
    case "no-such-admin":
      return `Refusing: no admin account has the address ${refusal.email}.`;
    case "ambiguous-email":
      return (
        `Refusing: ${refusal.matches} admin accounts have the address ${refusal.email}, ignoring case. ` +
        "Addresses are stored as typed and compared case-sensitively by Postgres, so these are " +
        "distinct accounts. Resolve the duplicate before clearing a second factor: guessing which " +
        "one was meant is the mistake a re-run cannot undo."
      );
  }
}

/** The lines an operator reads on success, dry run or applied. */
export function describeResetOutcome(
  outcome: Extract<ResetOutcome, { readonly ok: true }>,
): string {
  const { target } = outcome;
  const enrolment = target.wasEnrolled ? "enrolled" : "not enrolled";
  const rows = `${target.factorRows} second-factor row(s)`;
  if (!outcome.applied) {
    return (
      `Would clear the second factor and recovery codes for ${target.email} (${enrolment}, ${rows}).\n` +
      "Nothing has changed. Re-run with --yes to apply.\n"
    );
  }
  return (
    `Cleared the second factor and recovery codes for ${target.email} (was ${enrolment}, ${rows} removed).\n` +
    `Recorded as two_factor_resets ${outcome.auditId}, performed by database role ${outcome.databaseRole}.\n` +
    "That account now signs in with its password alone and is asked to enrol a new second\n" +
    "factor before it can reach anything else. Existing sessions are left alone.\n"
  );
}
