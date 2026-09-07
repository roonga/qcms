import { sql } from "drizzle-orm";

import type { Executor } from "./executor.js";

/**
 * What the connected Postgres role is, and whether it is the one that owns the
 * schema (SEC-10, issue #432).
 *
 * QCMS runs two least-privilege roles: `qcms_app`, which every API process
 * connects as and which holds DML and no DDL, and `qcms_migrate`, which owns
 * `public` and everything in it. The `qcms:reset-2fa` break-glass is defined to
 * run as the second one, so it needs to be able to tell them apart before it
 * touches an account.
 *
 * ## Why ownership rather than the role's name
 *
 * Matching `current_user = 'qcms_app'` would be a shorter check and a worse one.
 * It reads as a guard while asserting nothing: an adopter who names the roles
 * differently (nothing stops them - the names are a recipe in `docs/operations.md`,
 * not a constraint the code imposes) would pass a name test connected as the
 * application credential, which is precisely the case the guard exists for.
 *
 * Ownership is the property the role split is actually made of, and it is asserted
 * from the other side already: `apps/api/e2e/security/03-db-least-privilege.e2e.ts`
 * requires `qcms_app` to own nothing. So "the connected role owns the auth tables"
 * is false for the application credential by construction, true for the migration
 * role, and true for the single-role development database, where one role created
 * everything. `pg_has_role(..., 'USAGE')` rather than an equality on the owner oid,
 * so membership in the owning role counts too - that is how role grants are meant
 * to be read, and a superuser passes it.
 *
 * The catalog views this reads are world-readable in Postgres, so the check itself
 * never needs a privilege the application credential lacks: the refusal is a
 * refusal, never a permission error the operator has to decode.
 */

/** The two auth tables the reset writes. Both must exist and both must be owned. */
const AUTH_TABLES = ["user", "twoFactor", "two_factor_resets"] as const;

export interface ConnectedRole {
  /** `current_user`, for the refusal message and the audit row. */
  readonly role: string;
  /** How many of the tables the reset touches exist in the current schema. */
  readonly tablesPresent: number;
  /** How many of those the connected role owns (or is a member of the owner of). */
  readonly tablesOwned: number;
  /** Every table present and every one of them owned. */
  readonly ownsAuthTables: boolean;
}

/** Read `current_user` and its ownership of the tables the reset writes. */
export async function readConnectedRole(exec: Executor): Promise<ConnectedRole> {
  // `sql.join` rather than `= any(${array})`: drizzle expands a JS array into one
  // bind parameter per element, so the `any()` form reaches Postgres as
  // `any(($1, $2, $3))` and is rejected with "requires array on right side".
  const names = sql.join(
    AUTH_TABLES.map((name) => sql`${name}`),
    sql`, `,
  );
  const result = await exec.execute<{
    role: string;
    tables_present: number;
    tables_owned: number;
  }>(sql`
    select
      current_user::text as role,
      count(c.oid)::int as tables_present,
      (count(c.oid) filter (where pg_catalog.pg_has_role(c.relowner, 'USAGE')))::int as tables_owned
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema()
      and c.relkind = 'r'
      and c.relname in (${names})
  `);
  const row = result.rows[0];
  const tablesPresent = Number(row?.tables_present ?? 0);
  const tablesOwned = Number(row?.tables_owned ?? 0);
  return {
    role: row?.role ?? "unknown",
    tablesPresent,
    tablesOwned,
    ownsAuthTables: tablesPresent === AUTH_TABLES.length && tablesOwned === tablesPresent,
  };
}

/** How many tables {@link readConnectedRole} expects to find. Exported for messages. */
export const RESET_TABLE_COUNT = AUTH_TABLES.length;
