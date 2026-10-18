/**
 * Creating a login role, which is the one statement in this package that carries a
 * credential (SEC-8, SEC-10).
 *
 * # Why this is two statements and not one `DO` block
 *
 * `CREATE ROLE` takes an identifier and a literal and **neither can be a bind parameter**:
 * Postgres has no placeholder for an identifier, and a password in `CREATE ROLE ... PASSWORD
 * $1` is refused too. The obvious way round it is a `DO` block calling
 * `format('CREATE ROLE %I LOGIN PASSWORD %L', $1, $2)`, which reads safely and **does not
 * work**: a `DO` statement's body is a dollar-quoted string literal, so the `$1` inside it
 * is text rather than a placeholder, and the driver's bind fails with "bind message
 * supplies 2 parameters, but prepared statement requires 0". Task 067's reconciliation met
 * it on its first run against a real Postgres; task 064's environment command carried the
 * same shape and had never been exercised with a `--password`, so the defect was latent
 * there and is fixed here with it.
 *
 * The other way round it is to build the statement in JavaScript and escape the password by
 * hand. That is the one thing this module exists to avoid. So the quoting is **Postgres's
 * own**: `format` is called as an ordinary parameterised `SELECT`, where `%I` and `%L` are
 * the server's identifier and literal quoting applied to real bind parameters, and the
 * statement it returns is then executed. Two round trips, no hand-written escaping, and no
 * concatenation of a credential into SQL.
 *
 * # What this does not do
 *
 * It does not log, echo or return the password, and it must never be given one from a
 * database row: every caller takes it from an operator's command line or environment, where
 * the credential belongs (ADR-24, SEC-8).
 */

import { sql } from "drizzle-orm";

import type { Executor } from "../queries/executor.js";

/**
 * `CREATE ROLE <role> LOGIN PASSWORD <password>`, unless the role already exists.
 *
 * Idempotent, because both callers are commands an operator may run twice: the environment
 * command after a failure, and the reporting reconciliation after every workspace they
 * create. An existing role is left exactly as it is - **its password is not reset** - since
 * silently rotating a credential other systems are connecting with would be a side effect
 * nobody asked for.
 */
export async function createLoginRole(
  exec: Executor,
  role: string,
  password: string,
): Promise<void> {
  const existing = await exec.execute<{ found: boolean }>(
    sql`select exists (select 1 from pg_roles where rolname = ${role}) as found`,
  );
  if (existing.rows[0]?.found === true) return;

  // The server's own quoting, over bind parameters. `%I` for the identifier and `%L` for
  // the credential, so nothing here has to be correct about Postgres's escaping rules.
  //
  // Both are cast to `text` explicitly: `format` is variadic over `any`, so Postgres cannot
  // infer a placeholder's type from it and refuses the statement with "could not determine
  // data type of parameter" without the cast.
  const built = await exec.execute<{ statement: string }>(
    sql`select format('CREATE ROLE %I LOGIN PASSWORD %L', ${role}::text, ${password}::text) as statement`,
  );
  const statement = built.rows[0]?.statement;
  if (statement === undefined) {
    throw new Error(`could not build the CREATE ROLE statement for ${role}`);
  }
  // check-security-hygiene: allow server-built DDL whose identifier and literal were quoted by Postgres
  await exec.execute(sql.raw(statement));
}
