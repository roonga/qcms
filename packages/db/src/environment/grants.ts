/**
 * The grant model as one ordered list of sources (ADR-40, SEC-10). `grants.test.ts` fails
 * if a `GRANT` or `REVOKE` appears in the migration tree that this list does not produce.
 */

import type { Executor } from "../queries/executor.js";
import { ACCESS_AUDIT_TABLE } from "../schema/control/access-audit.js";
import { AGENT_ACTIONS_TABLE } from "../schema/control/agent-actions.js";
import { ENDPOINT_PROPOSALS_TABLE } from "../schema/control/endpoint-proposals.js";
import { RELEASE_BATCHES_TABLE } from "../schema/control/release-batches.js";
import {
  RELEASE_WORKFLOW_REVISIONS_TABLE,
  RELEASE_WORKFLOW_RULES_TABLE,
} from "../schema/control/release-workflow.js";
import { CONTROL_ROLE, CONTROL_SCHEMA } from "../schema/schemas.js";

import {
  revokeWorkspaceViewsFromEnvironmentRole,
  workspaceReportingGrantsForEnvironment,
} from "./reporting.js";
import {
  grantAccessAuditStatements,
  grantAgentActionsStatements,
  grantControlTableStatements,
  grantEnvironmentStatements,
  revokeMigrateOnlyStatement,
} from "./sql.js";

/**
 * The control role's DML on `control`, with the two audits carved out by the sources that
 * follow this one in {@link GRANT_SOURCES}.
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
 * Leaves `public` with `CREATE` granted to nobody. The one statement a re-grant cannot
 * re-apply, because a `REVOKE` on a schema requires owning it and the migration
 * credential does not own `public`. See {@link UNREAPPLIABLE_SOURCES}.
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

interface GrantSourceCommon {
  /** Reported in place of the statement that failed (SEC-8). */
  readonly name: string;
  /**
   * Whether every statement this source emits appears in the migration tree verbatim,
   * which is what makes "a re-grant cannot widen privilege" checkable by comparing text.
   */
  readonly inMigrationTree: boolean;
  /** Required when `inMigrationTree` is false, and read by `grants.test.ts`. */
  readonly whyNotInMigrationTree?: string;
}

/**
 * One source of grant statements. `environment-database` scope reads the database, so its
 * statements cannot be derived from source and no migration carries them.
 */
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
 * Every grant source a fully migrated database has applied, in that order. The order is
 * load-bearing: a source that narrows an earlier `ALL TABLES` pass must follow it.
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
    // The grant half only: a restore keeps the views and loses only the privileges, so a
    // `regrant` emitting the view DDL would create a view set nobody had reconciled.
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
    // A narrowing only, and the companion of the pass above. See
    // `revokeWorkspaceViewsFromEnvironmentRole` for what a restore's ordering does here.
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
    name: `${CONTROL_SCHEMA}.${ENDPOINT_PROPOSALS_TABLE} (migration 0005)`,
    scope: "installation",
    inMigrationTree: true,
    statements: () => grantControlTableStatements(ENDPOINT_PROPOSALS_TABLE),
  },
  {
    name: `${CONTROL_SCHEMA}.${RELEASE_WORKFLOW_REVISIONS_TABLE} (migration 0006)`,
    scope: "installation",
    inMigrationTree: true,
    statements: () => grantControlTableStatements(RELEASE_WORKFLOW_REVISIONS_TABLE),
  },
  {
    name: `${CONTROL_SCHEMA}.${RELEASE_WORKFLOW_RULES_TABLE} (migration 0006)`,
    scope: "installation",
    inMigrationTree: true,
    statements: () => grantControlTableStatements(RELEASE_WORKFLOW_RULES_TABLE),
  },
  {
    name: `${CONTROL_SCHEMA}.${RELEASE_BATCHES_TABLE} (migration 0006)`,
    scope: "installation",
    inMigrationTree: true,
    statements: () => grantControlTableStatements(RELEASE_BATCHES_TABLE),
  },
  {
    name: `${CONTROL_SCHEMA}.${AGENT_ACTIONS_TABLE} (migration 0007)`,
    scope: "installation",
    inMigrationTree: true,
    statements: grantAgentActionsStatements,
  },
  {
    name: "control.two_factor_resets is migrate-only (baseline, last)",
    scope: "installation",
    inMigrationTree: true,
    statements: () => [revokeMigrateOnlyStatement()],
  },
];

/** The sources a re-grant deliberately does not re-apply, with the reason. */
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

/** One source's pass, so a failure can name its source rather than the statement (SEC-8). */
export interface GrantPass {
  readonly source: string;
  /** Absent for an installation-wide source. */
  readonly environment?: string;
  readonly statements: readonly string[];
}

/**
 * Every statement the migration tree carries. Not the whole re-grant set: the
 * `environment-database` sources are outside it by construction.
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
 * Every pass that re-applies the whole grant model, in the order a migrated database
 * applied it. Idempotent, and never DDL. `environments` must be in position order.
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
