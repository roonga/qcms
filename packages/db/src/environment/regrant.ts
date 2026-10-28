/**
 * The step a restore needs: `pg_dump --no-privileges` carries no grant, while drizzle's journal rides in the
 * dump, so `migrate` re-applies nothing. Every database call runs inside {@link refuseWithoutStatement},
 * so no statement text reaches an operator's terminal (SEC-8).
 */

import { sql } from "drizzle-orm";

import type { Executor } from "../queries/executor.js";
import { CONTROL_SCHEMA } from "../schema/schemas.js";

import { listEnvironmentNames } from "../queries/grants.js";

import { type GrantPass, UNREAPPLIABLE_SOURCES, regrantPasses } from "./grants.js";
import { refuseWithoutStatement } from "./role.js";

/** What a re-grant did. */
export interface RegrantReport {
  /** In `control.environments.position` order. */
  readonly environments: readonly string[];
  /** In execution order. */
  readonly passes: readonly {
    readonly source: string;
    readonly environment?: string;
    readonly statements: number;
  }[];
  readonly statements: number;
  /**
   * The one part of the model a re-grant cannot re-apply, so it is measured instead.
   * `true` is a finding an operator has to act on with a superuser.
   */
  readonly publicCreateGrantedToPublic: boolean;
}

/** Names the pass and nothing of the statement (SEC-8). */
function passSubject(pass: GrantPass): string {
  const where = pass.environment === undefined ? "" : ` for environment ${pass.environment}`;
  return `${pass.source}${where}`;
}

/**
 * `aclexplode` rather than `has_schema_privilege`: `PUBLIC` is grantee oid `0` and not a
 * name that function accepts, and a per-role read cannot tell a grant to `PUBLIC` apart
 * from a grant to the role.
 */
async function publicCreateGrantedToPublic(exec: Executor): Promise<boolean> {
  const result = await exec.execute<{ granted: boolean }>(sql`
    select coalesce(bool_or(acl.privilege_type = 'CREATE' and acl.grantee = 0), false) as granted
      from pg_catalog.pg_namespace n,
           aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) as acl
     where n.nspname = 'public'
  `);
  return result.rows[0]?.granted ?? false;
}

/**
 * Re-apply every grant and revoke in the model, for every environment in the live set.
 *
 * One transaction, so a failure leaves the database exactly as it was and the command is
 * safe to retry. Idempotent, because a `GRANT` sets a privilege rather than adding one.
 */
/** Re-applies the whole grant model to the live set, in one transaction. Idempotent. */
export async function regrantEnvironments(exec: Executor): Promise<RegrantReport> {
  const environments = await refuseWithoutStatement(
    "read",
    `the live environment set from ${CONTROL_SCHEMA}.environments`,
    () => listEnvironmentNames(exec),
  );
  if (environments.length === 0) {
    throw new Error(
      `${CONTROL_SCHEMA}.environments is empty, so there is no environment to grant for. ` +
        "A restored database carries the live set inside the dump; an empty one means the " +
        "restore did not land the control plane",
    );
  }

  // Read before the transaction, so the transaction holds statements only.
  const passes = await refuseWithoutStatement(
    "read",
    `the grant model for ${environments.join(", ")}`,
    () => regrantPasses(exec, environments),
  );
  await exec.transaction(async (tx) => {
    for (const pass of passes) {
      for (const statement of pass.statements) {
        // Unparameterizable, and safe only because every statement is a generator's
        // output over names that passed `refuseEnvironmentName` and
        // `WORKSPACE_SLUG_PATTERN`. There is no other input.
        await refuseWithoutStatement("re-apply", passSubject(pass), () =>
          // check-security-hygiene: allow generated GRANT statements over names from control.environments
          tx.execute(sql.raw(statement)),
        );
      }
    }
  });

  return {
    environments,
    passes: passes.map((pass) => ({
      source: pass.source,
      ...(pass.environment === undefined ? {} : { environment: pass.environment }),
      statements: pass.statements.length,
    })),
    statements: passes.reduce((total, pass) => total + pass.statements.length, 0),
    publicCreateGrantedToPublic: await refuseWithoutStatement(
      "read",
      "whether PUBLIC still holds CREATE on the public schema",
      () => publicCreateGrantedToPublic(exec),
    ),
  };
}

/** The one-line note the command prints about what it deliberately did not re-apply. */
export function unreappliedNote(): string {
  return UNREAPPLIABLE_SOURCES.map((source) => `  not re-applied: ${source.name} - ${source.why}`)
    .join("\n")
    .concat("\n");
}
