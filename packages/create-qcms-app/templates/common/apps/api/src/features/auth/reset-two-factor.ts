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
 * Break-glass with no HTTP surface and no enabling flag: its only guard is possession of
 * the schema-owning migration role, refused as `qcms_app` (SEC-1, SEC-10). Live sessions
 * are left alone, each having passed a second factor when it was issued.
 */

export type ResetRefusal =
  | { readonly kind: "insufficient-database-role"; readonly role: string }
  | { readonly kind: "schema-missing"; readonly role: string; readonly tablesPresent: number }
  | { readonly kind: "no-such-admin"; readonly email: string }
  | { readonly kind: "ambiguous-email"; readonly email: string; readonly matches: number };

export interface ResetTarget {
  readonly userId: string;
  readonly email: string;
  readonly factorRows: number;
  readonly wasEnrolled: boolean;
}

export type ResetOutcome =
  | { readonly ok: true; readonly applied: false; readonly target: ResetTarget }
  | {
      readonly ok: true;
      readonly applied: true;
      readonly target: ResetTarget;
      readonly auditId: string;
      readonly databaseRole: string;
    }
  | { readonly ok: false; readonly refusal: ResetRefusal };

export interface ResetInput {
  readonly email: string;
  readonly confirm: boolean;
}

/**
 * Guard order is load-bearing: the role check first, so an unauthorized connection never
 * reads an account, and the clear plus its audit row in one transaction.
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
  if (!role.ownsResetTables) {
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

async function countFactorRows(exec: Executor, userId: string): Promise<number> {
  const rows = await exec
    .select({ id: authTwoFactor.id })
    .from(authTwoFactor)
    .where(eq(authTwoFactor.userId, userId));
  return rows.length;
}

/** Must stay value-free: an address and a role name, never a credential (SEC-8). */
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
