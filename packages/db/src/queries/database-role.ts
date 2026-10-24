import { sql } from "drizzle-orm";

import { CONTROL_SCHEMA } from "../schema/schemas.js";
import type { Executor } from "./executor.js";

// Ownership rather than a name match on `current_user` (SEC-10): role names are only a
// recipe, so a name test would pass for an adopter connected as the application
// credential. `pg_has_role(..., 'USAGE')` so membership in the owning role counts too.

/**
 * `two_factor_resets` is included because a role that could clear a factor but not record
 * it would leave the reset unaudited.
 */
const RESET_TABLES = ["user", "twoFactor", "two_factor_resets"] as const;

/** The connected role and its ownership of the tables the break-glass writes. */
export interface ConnectedRole {
  readonly role: string;
  readonly tablesPresent: number;
  /** How many of those the connected role owns, or is a member of the owner of. */
  readonly tablesOwned: number;
  /** Every table present and every one of them owned. */
  readonly ownsResetTables: boolean;
}

/**
 * Read `current_user` and its ownership of the tables the reset writes.
 *
 * Names the `control` schema rather than using `current_schema()`: a connection that set
 * no `search_path` resolves to `public`, where none of these tables live, and the guard
 * would then refuse the migration credential itself.
 */
export async function readConnectedRole(exec: Executor): Promise<ConnectedRole> {
  // `sql.join` rather than `= any(${array})`: drizzle expands a JS array into one bind
  // parameter per element, which Postgres rejects as "requires array on right side".
  const names = sql.join(
    RESET_TABLES.map((name) => sql`${name}`),
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
    where n.nspname = ${CONTROL_SCHEMA}
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
    ownsResetTables: tablesPresent === RESET_TABLES.length && tablesOwned === tablesPresent,
  };
}

/** How many tables {@link readConnectedRole} expects to find. */
export const RESET_TABLE_COUNT = RESET_TABLES.length;
