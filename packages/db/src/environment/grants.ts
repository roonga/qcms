/**
 * The grant model as an ordered list of **sources** (ADR-40, SEC-10, issue #1094).
 *
 * # Why a registry, when the generators already existed
 *
 * Every `GRANT` and `REVOKE` QCMS makes was already a generator's output rather than
 * prose SQL: `grantEnvironmentStatements` emits one environment's, `controlRoleGrantStatements`
 * the control role's, `grantControlTableStatements` a post-baseline control table's, and
 * `grantAccessAuditStatements` the SEC-15 audit's. What did not exist was an answer to
 * "what is the **whole** set, in order". Three callers needed one and each would have
 * built its own:
 *
 *   1. the **baseline**, which applies the installation-wide half plus one pass per
 *      shipped environment;
 *   2. the **environment command**, which applies one environment's half when it creates
 *      one;
 *   3. the **re-grant subcommand** (issue #1094), which re-applies all of it after a
 *      restore, because `pg_dump --no-privileges` carries no grant at all and the drizzle
 *      journal rides inside the dump, so a post-restore `migrate` re-applies nothing.
 *
 * A third hand-kept copy of the model is what the Code Owner's ruling of 2026-10-22
 * forbids, so this module is the one list and the three callers walk it. {@link
 * regrantPasses} is caller 3; {@link GRANT_SOURCES} is what it walks, and
 * `grants.test.ts` fails if a `GRANT` or a `REVOKE` appears anywhere in the migration
 * tree that this list does not produce.
 *
 * # Order is load-bearing, twice
 *
 * The list is in the order a fully migrated database applied it, and two pairs depend on
 * that:
 *
 *   - the control role's grant is `GRANT ... ON ALL TABLES IN SCHEMA control`, which on a
 *     **restored** database reaches every table including the two audits, so the access
 *     audit's own source has to come **after** it to take `UPDATE` and `DELETE` back;
 *   - the migrate-only revoke on `control.two_factor_resets` comes **last** for the same
 *     reason, which is the order the baseline already uses.
 *
 * # Task 067's reporting grants are a third kind of source, not a fourth entry
 *
 * The first draft of this module said 067's per-workspace reporting grants would be "one
 * more entry with `scope: "environment"`". PR #1099's review showed that does not hold:
 * the generator is **async** and reads `control.organization`, and no migration carries a
 * per-workspace grant, because the workspaces did not exist when any migration was
 * written. So the list gained a third source kind, `environment-database`, and a recorded
 * exemption from the migration-tree comparison. See {@link GrantSource}.
 *
 * Only the **grant** half of 067's generator is in the list. The view half is not: a
 * restore keeps the views and loses the privileges, so a command called `regrant` has no
 * business creating a view set nobody reconciled - which it did, until the restore drill
 * caught it.
 */

import type { Executor } from "../queries/executor.js";
import { ACCESS_AUDIT_TABLE } from "../schema/control/access-audit.js";
import { ENDPOINT_PROPOSALS_TABLE } from "../schema/control/endpoint-proposals.js";
import { CONTROL_ROLE, CONTROL_SCHEMA } from "../schema/schemas.js";

import {
  revokeWorkspaceViewsFromEnvironmentRole,
  workspaceReportingGrantsForEnvironment,
} from "./reporting.js";
import {
  grantAccessAuditStatements,
  grantControlTableStatements,
  grantEnvironmentStatements,
  revokeMigrateOnlyStatement,
} from "./sql.js";

/**
 * The control role's rights on `control`: DML, with the two audits carved out by the
 * sources that follow this one in {@link GRANT_SOURCES}.
 *
 * Lives here rather than in `baseline.ts`, where it used to, so the baseline and the
 * re-grant subcommand emit the same bytes from the same function instead of one of them
 * holding a copy. `baseline.test.ts` still compares the checked-in migration against the
 * emitter, so a change here that nobody re-emits fails there.
 */
export function controlRoleGrantStatements(): readonly string[] {
  const statements = [
    `GRANT USAGE ON SCHEMA "${CONTROL_SCHEMA}" TO "${CONTROL_ROLE}"`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${CONTROL_SCHEMA}" TO "${CONTROL_ROLE}"`,
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA "${CONTROL_SCHEMA}" TO "${CONTROL_ROLE}"`,
  ];
  const body = statements.map((statement) => `\t\tEXECUTE '${statement}';`).join("\n");
  return [
    `-- \`qcms_app_control\` serves better-auth, authoring, grants, releases and closes, so
-- it holds DML on the whole of \`control\` - with the audit tables carved out below and
-- in task 069's migration. In the data schemas it holds INSERT on \`outbox\` and nothing
-- else at all (Q49), which the per-environment block above grants.
DO $$
BEGIN
\tIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${CONTROL_ROLE}') THEN
${body}
\tEND IF;
END
$$;`,
  ];
}

/**
 * `public` is left empty, off every search path, with `CREATE` on it granted to nobody.
 *
 * **This is the one statement in the model the re-grant subcommand cannot re-apply**, and
 * {@link UNREAPPLIABLE_SOURCES} records why rather than leaving it to be rediscovered: a
 * `REVOKE` on a schema requires owning it, and a database recreated by the documented
 * restore procedure owns `public` as `pg_database_owner` - a role the migration credential
 * is not a member of, because it owns schemas and not the database (`docker-compose.yml`'s
 * `db-roles`). Measured, not assumed: on `postgres:16-alpine`,
 * `pg_has_role('qcms_migrate', nspowner, 'USAGE')` is false for `public` after the restore
 * and true for `control`.
 *
 * Nothing is lost, and the reason is a PostgreSQL 15 default rather than an argument:
 * a freshly created database grants `PUBLIC` no `CREATE` on `public` at all, so the
 * property this statement establishes holds on the restored database without it. The
 * drill asserts that directly rather than trusting the paragraph, and the superuser
 * re-applies the statement on the next `up` through `db-roles`.
 */
export function lockPublicStatements(): readonly string[] {
  return [
    `-- \`public\` holds no QCMS object at all and is on no search path (Q20, criterion 2).
-- PostgreSQL 15 already revokes CREATE on it from PUBLIC; stated here so the property
-- is a thing this migration establishes rather than a default it inherits, and so a
-- database restored onto an older cluster gets it too.
REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;`,
  ];
}

/**
 * One source of grant statements.
 *
 * Three kinds, and the third exists because task 067's per-workspace reporting grants are
 * not shaped like the others (PR #1099's review, finding 3):
 *
 *   - **`installation`**: one pass, whatever the live set is.
 *   - **`environment`**: one pass per environment, synchronous, from a generator a
 *     migration also calls.
 *   - **`environment-database`**: one pass per environment, **asynchronous and reading the
 *     database**. `workspaceReportingGrantsForEnvironment` has to read
 *     `control.organization` to know which workspaces exist, so its statements cannot be
 *     derived from source alone and **no migration carries them** - a per-workspace grant
 *     names a workspace that did not exist when any migration was written.
 *
 * `inMigrationTree` records which of those a source is, as data rather than as a sentence
 * in a test. `grants.test.ts` asserts direction 1 ("every registry statement is in the
 * migration tree, verbatim") over the `true` sources only, and asserts separately that the
 * exempt set is exactly the sources that say so and that each carries a reason. A source
 * added with no `inMigrationTree` is a type error; one added with `false` and no
 * `whyNotInMigrationTree` fails that test.
 *
 * The `name` is not decoration. It is what the re-grant subcommand reports per source and
 * what a failure names **in place of the statement that failed** (SEC-8), so an operator
 * reading a refusal learns which part of the model could not be applied without the SQL
 * text reaching their terminal.
 */
interface GrantSourceCommon {
  readonly name: string;
  /**
   * Whether every statement this source emits appears in the migration tree verbatim.
   *
   * `true` for every source a migration also applies, which is what makes "the re-grant
   * cannot widen privilege" checkable by comparing text. `false` needs
   * {@link GrantSourceCommon.whyNotInMigrationTree}.
   */
  readonly inMigrationTree: boolean;
  /** Required when `inMigrationTree` is false, and read by `grants.test.ts`. */
  readonly whyNotInMigrationTree?: string;
}

export type GrantSource = GrantSourceCommon &
  (
    | { readonly scope: "installation"; readonly statements: () => readonly string[] }
    | {
        readonly scope: "environment";
        readonly statements: (environment: string) => readonly string[];
      }
    | {
        readonly scope: "environment-database";
        readonly statements: (exec: Executor, environment: string) => Promise<readonly string[]>;
      }
  );

/**
 * Every grant source a fully migrated database has applied, in that order.
 *
 * Read the entries as the chronology they are: the baseline's installation-wide pass and
 * its per-environment pass, then task 067's per-workspace reporting pass, then the two
 * migrations that create a control-plane table and own its grants, then the migrate-only
 * revoke last.
 */
export const GRANT_SOURCES: readonly GrantSource[] = [
  {
    name: "the control role's DML on control (baseline)",
    scope: "installation",
    inMigrationTree: true,
    statements: controlRoleGrantStatements,
  },
  {
    name: "one environment's grants (baseline, and the environment command)",
    scope: "environment",
    inMigrationTree: true,
    statements: grantEnvironmentStatements,
  },
  {
    // Task 067's grant half, called rather than copied. The **view** half is deliberately
    // not here: a restore keeps the views and loses only the privileges, and a command
    // called `regrant` that created a view set nobody had reconciled would be doing DDL an
    // operator did not ask for - which the restore drill caught it doing. The views'
    // `security_barrier = true` rides in the dump and is asserted rather than re-applied.
    name: "one environment's per-workspace reporting grants (task 067, Q26)",
    scope: "environment-database",
    inMigrationTree: false,
    whyNotInMigrationTree:
      "a per-workspace grant names a workspace slug read from control.organization at run " +
      "time, so no migration can carry one: the workspaces did not exist when any " +
      "migration was written, and the generator is async because it has to read them",
    statements: async (exec, environment) =>
      workspaceReportingGrantsForEnvironment(exec, environment),
  },
  {
    // The companion of the pass above, and a narrowing only. `grantEnvironmentStatements`
    // grants the application role `SELECT ON ALL TABLES IN SCHEMA reporting_<env>`, which
    // on a RESTORED database reaches the per-workspace views too, because they came back in
    // the dump before this ran. On every live path they do not exist yet. See
    // `revokeWorkspaceViewsFromEnvironmentRole` for why that makes the restored database
    // hold more than the migrated one it must equal, and for the Code Owner question.
    name: "the application role holds its own reporting views, not a workspace's (ADR-40, Q52)",
    scope: "environment-database",
    inMigrationTree: false,
    whyNotInMigrationTree:
      "it corrects an ordering only a restore produces: the baseline's ALL TABLES grant on " +
      "reporting_<env> runs before any per-workspace view exists in every live path, and " +
      "after they all exist on a restore, so no migration runs in the order that needs it. " +
      "It reads control.organization to know which views to name",
    statements: async (exec, environment) =>
      revokeWorkspaceViewsFromEnvironmentRole(exec, environment),
  },
  {
    name: "control.form_releases (migration 0001)",
    scope: "installation",
    inMigrationTree: true,
    statements: () => grantControlTableStatements("form_releases"),
  },
  {
    name: `${CONTROL_SCHEMA}.${ACCESS_AUDIT_TABLE} (migration 0004)`,
    scope: "installation",
    inMigrationTree: true,
    statements: grantAccessAuditStatements,
  },
  {
    // Task 070's pending `prod` endpoint change. The ordinary shape for a control-plane
    // table a migration creates after the baseline, and it needs no carve-out: the one
    // statement is DML for the control role, and **no environment role holds anything**
    // here, because `webhook_endpoint_proposals` is not on `CONTROL_READ_TABLES`. It sits
    // after the control role's `ALL TABLES` pass for the reason every entry above it does -
    // on a restored database that pass has already reached this table - and what follows it
    // is only the migrate-only revoke, which names a different table.
    name: `${CONTROL_SCHEMA}.${ENDPOINT_PROPOSALS_TABLE} (migration 0005)`,
    scope: "installation",
    inMigrationTree: true,
    statements: () => grantControlTableStatements(ENDPOINT_PROPOSALS_TABLE),
  },
  {
    name: "control.two_factor_resets is migrate-only (baseline, last)",
    scope: "installation",
    inMigrationTree: true,
    statements: () => [revokeMigrateOnlyStatement()],
  },
];

/**
 * The sources a re-grant deliberately does not re-apply, with the reason, so the
 * exclusion is data a test can read rather than a sentence somebody has to find.
 *
 * One member. See {@link lockPublicStatements}.
 */
export const UNREAPPLIABLE_SOURCES: readonly {
  readonly name: string;
  readonly why: string;
  readonly statements: () => readonly string[];
}[] = [
  {
    name: "CREATE on public belongs to nobody (baseline)",
    why:
      "a REVOKE on a schema requires owning it, and a database recreated by the restore " +
      "procedure owns public as pg_database_owner, which the migration credential is not a " +
      "member of. A freshly created PostgreSQL 15 or later database grants PUBLIC no CREATE " +
      "on public anyway, so the property holds without this statement; the drill asserts it " +
      "and the db-roles one-shot re-applies the statement as the superuser on the next up",
    statements: lockPublicStatements,
  },
];

/**
 * One pass of one source, grouped so the subcommand can report it and so a failure can
 * name its source instead of the statement that failed (SEC-8).
 */
export interface GrantPass {
  /** The source's {@link GrantSourceCommon.name}. */
  readonly source: string;
  /** The environment this pass was emitted for, absent for an installation-wide source. */
  readonly environment?: string;
  readonly statements: readonly string[];
}

/**
 * Every statement the **migration tree** carries, for the environments given.
 *
 * The sync half of the registry: the sources a migration also applies. This is what
 * `grants.test.ts` compares against the checked-in SQL in both directions, and it takes no
 * database, so the comparison stays a pure text test.
 *
 * Deliberately **not** the whole re-grant set: the per-workspace reporting source is
 * outside it by construction ({@link GrantSource}), which is why the two have different
 * names rather than one function with a flag.
 */
export function migrationBackedStatements(environments: readonly string[]): string[] {
  const statements: string[] = [];
  for (const source of GRANT_SOURCES) {
    if (!source.inMigrationTree) continue;
    if (source.scope === "installation") {
      statements.push(...source.statements());
      continue;
    }
    if (source.scope === "environment") {
      for (const environment of environments) statements.push(...source.statements(environment));
    }
  }
  return statements;
}

/**
 * Every pass that re-applies the whole grant model to the environments given, in the
 * order a migrated database applied it.
 *
 * Idempotent by construction rather than by a guard: every statement is a `GRANT` or a
 * `REVOKE`, which Postgres treats as "make it so" and not "add one". **There is no DDL in
 * the set at all**, which is the other half of why it is safe: a `regrant` neither creates
 * nor drops an object. So running this twice, or running it against a database that is
 * already correct, changes nothing. The e2e suite asserts both against a
 * real catalogue rather than resting on that sentence.
 *
 * Asynchronous because one source reads the database. The reads happen here, before the
 * transaction {@link regrantEnvironments} opens, which is why the statements are collected
 * rather than streamed.
 *
 * @param exec the migration credential's handle, for the sources that read
 * @param environments the live set, in `control.environments.position` order
 */
export async function regrantPasses(
  exec: Executor,
  environments: readonly string[],
): Promise<GrantPass[]> {
  const passes: GrantPass[] = [];
  for (const source of GRANT_SOURCES) {
    if (source.scope === "installation") {
      passes.push({ source: source.name, statements: source.statements() });
      continue;
    }
    for (const environment of environments) {
      const statements =
        source.scope === "environment"
          ? source.statements(environment)
          : await source.statements(exec, environment);
      passes.push({ source: source.name, environment, statements });
    }
  }
  return passes;
}
