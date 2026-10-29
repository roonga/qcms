/**
 * The per-environment generator (ADR-40). Hand-written because drizzle-kit has no notion
 * of N copies of one table in N schemas whose names come from a database row.
 */

import { SQL, getTableName } from "drizzle-orm";
import {
  type IndexedColumn,
  type PgColumn,
  PgDialect,
  type PgTable,
  getTableConfig,
} from "drizzle-orm/pg-core";

import {
  reportingViewStatements,
  workspaceReportingViewNames,
  workspaceReportingViewStatements,
} from "../reporting-views.js";
import { sqlLiteral as literal } from "../sql-literal.js";
import { ACCESS_AUDIT_TABLE } from "../schema/control/access-audit.js";
import {
  APPLICATION_ROLE_PREFIX,
  CONTROL_ROLE,
  CONTROL_SCHEMA,
  dataSchemaName,
  environmentRoleName,
  reportingSchemaName,
  workspaceReportingRoleName,
} from "../schema/schemas.js";
import {
  DATA_PLANE_TABLES,
  DATA_PLANE_TABLE_NAMES,
  DATA_PLANE_TRIGGERS,
  SESSION_ENVIRONMENT_CHECK,
} from "../schema/data/index.js";

const dialect = new PgDialect();

/** Postgres identifier quoting, with the doubling rule. */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Throwing rather than defaulting: Postgres would name an unnamed constraint differently
 * in every environment, and the derivation relies on one name set everywhere.
 */
function requireName(name: string | undefined, what: string): string {
  if (name === undefined || name === "") {
    throw new Error(`the per-environment generator needs a name for ${what}`);
  }
  return name;
}

/**
 * Parameters are inlined because DDL has no statement to bind them to, over a fresh `SQL`
 * rather than `value.inlineParams()`, which would mutate the schema module's own object.
 */
function render(value: SQL): string {
  return dialect.sqlToQuery(new SQL(value.queryChunks).inlineParams()).sql;
}

/** Enum types live in `control`, so a column declared with one is qualified into it. */
function columnType(column: PgColumn): string {
  const sqlType = column.getSQLType();
  return column.columnType === "PgEnumColumn" ? `${CONTROL_SCHEMA}.${quote(sqlType)}` : sqlType;
}

function columnDefault(value: unknown): string {
  if (value instanceof SQL) return render(value);
  if (typeof value === "string") return literal(value);
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value === null) return "NULL";
  throw new Error(`the per-environment generator cannot render a ${typeof value} column default`);
}

function columnDefinition(column: PgColumn): string {
  const parts = [quote(column.name), columnType(column)];
  if (column.primary) parts.push("PRIMARY KEY");
  if (column.hasDefault && column.default !== undefined) {
    parts.push(`DEFAULT ${columnDefault(column.default)}`);
  }
  if (column.notNull) parts.push("NOT NULL");
  return `\t${parts.join(" ")}`;
}

function indexColumn(column: Partial<IndexedColumn | SQL>): string {
  if (column instanceof SQL) return render(column);
  const indexed = column as Partial<IndexedColumn>;
  const config = indexed.indexConfig;
  const order = config?.order === "desc" ? " DESC" : "";
  // ASC implies NULLS LAST and DESC implies NULLS FIRST, so the clause is written only
  // where the sort order does not already give it.
  let nulls = "";
  if (config?.nulls === "first") nulls = " NULLS FIRST";
  else if (order !== "") nulls = " NULLS LAST";
  return `${quote(requireName(indexed.name, "an index column"))}${order}${nulls}`;
}

/**
 * Every enum type a data-plane column uses, created once in `control` rather than per environment.
 * No type `USAGE` or trigger `EXECUTE` grant is emitted: Postgres grants both to `PUBLIC` by default.
 */
function dataPlaneEnumTypes(): string[] {
  const names = new Set<string>();
  for (const table of DATA_PLANE_TABLES) {
    for (const column of getTableConfig(table).columns) {
      if (column.columnType === "PgEnumColumn") names.add(column.getSQLType());
    }
  }
  return [...names].sort();
}

/** The enum types in `control` that every environment's `sessions` rows are written with. */
export const DATA_PLANE_ENUM_TYPES: readonly string[] = dataPlaneEnumTypes();

/** The names of every object the generator emits for one environment. */
export interface EnvironmentObjectNames {
  readonly schema: string;
  readonly reportingSchema: string;
  readonly role: string;
  /** In creation order. */
  readonly tables: readonly string[];
  /**
   * Every trigger, CHECK, UNIQUE and index. Counted apart from the foreign keys because
   * their absence is silent: an environment missing `answers_reject_delete` has an
   * erasable ledger and nothing says so.
   */
  readonly guards: readonly string[];
  readonly foreignKeys: readonly string[];
  /** Those referencing this environment's own schema. */
  readonly inPlaneForeignKeys: readonly string[];
  /** Those referencing the single `control` copy. */
  readonly crossingForeignKeys: readonly string[];
}

/**
 * Derived rather than written down, so the tests compare against `pg_constraint` and
 * `pg_trigger` instead of a typed-in count.
 */
export function environmentObjectNames(environment: string): EnvironmentObjectNames {
  const guards: string[] = [];
  const inPlane: string[] = [];
  const crossing: string[] = [];

  for (const table of DATA_PLANE_TABLES) {
    const config = getTableConfig(table);
    for (const check of config.checks) guards.push(check.name);
    for (const unique of config.uniqueConstraints) {
      guards.push(requireName(unique.name, `a unique constraint on ${getTableName(table)}`));
    }
    for (const index of config.indexes) {
      guards.push(requireName(index.config.name, `an index on ${getTableName(table)}`));
    }
    for (const foreignKey of config.foreignKeys) {
      const target = getTableName(foreignKey.reference().foreignTable);
      (DATA_PLANE_TABLE_NAMES.includes(target) ? inPlane : crossing).push(foreignKey.getName());
    }
  }
  for (const trigger of DATA_PLANE_TRIGGERS) guards.push(trigger.name);
  // The one guard whose text differs per environment.
  guards.push(SESSION_ENVIRONMENT_CHECK);

  return {
    schema: dataSchemaName(environment),
    reportingSchema: reportingSchemaName(environment),
    role: environmentRoleName(environment),
    tables: DATA_PLANE_TABLE_NAMES,
    guards,
    foreignKeys: [...inPlane, ...crossing],
    inPlaneForeignKeys: inPlane,
    crossingForeignKeys: crossing,
  };
}

function createTableSql(environment: string, table: PgTable): string {
  const schema = dataSchemaName(environment);
  const config = getTableConfig(table);
  const lines = config.columns.map((column) => columnDefinition(column));

  for (const primaryKey of config.primaryKeys) {
    const columns = primaryKey.columns.map((column) => quote(column.name)).join(",");
    const name = requireName(primaryKey.getName(), `a primary key on ${getTableName(table)}`);
    lines.push(`\tCONSTRAINT ${quote(name)} PRIMARY KEY(${columns})`);
  }
  for (const unique of config.uniqueConstraints) {
    const columns = unique.columns.map((column) => quote(column.name)).join(",");
    const name = requireName(unique.name, `a unique constraint on ${getTableName(table)}`);
    lines.push(`\tCONSTRAINT ${quote(name)} UNIQUE(${columns})`);
  }
  for (const check of config.checks) {
    lines.push(`\tCONSTRAINT ${quote(check.name)} CHECK (${render(check.value)})`);
  }
  if (getTableName(table) === "sessions") {
    // The one guard whose predicate names the schema it sits in, so it cannot be declared
    // on the Drizzle table beside the others. A CHECK passes on NULL, which is why
    // `environment` is NOT NULL on the column above.
    lines.push(
      `\tCONSTRAINT ${quote(SESSION_ENVIRONMENT_CHECK)} ` +
        `CHECK ("sessions"."environment" = ${literal(environment)})`,
    );
  }

  return `CREATE TABLE ${quote(schema)}.${quote(getTableName(table))} (\n${lines.join(",\n")}\n);`;
}

function foreignKeySql(environment: string): string[] {
  const schema = dataSchemaName(environment);
  const statements: string[] = [];
  for (const table of DATA_PLANE_TABLES) {
    const config = getTableConfig(table);
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const target = getTableName(reference.foreignTable);
      // Derived per key: a copied in-plane key can end up pointing at another
      // environment's `sessions`, which the search path would never reveal.
      const targetSchema = DATA_PLANE_TABLE_NAMES.includes(target) ? schema : CONTROL_SCHEMA;
      const columns = reference.columns.map((column) => quote(column.name)).join(",");
      const targetColumns = reference.foreignColumns.map((column) => quote(column.name)).join(",");
      statements.push(
        `ALTER TABLE ${quote(schema)}.${quote(getTableName(table))} ` +
          `ADD CONSTRAINT ${quote(foreignKey.getName())} FOREIGN KEY (${columns}) ` +
          `REFERENCES ${quote(targetSchema)}.${quote(target)}(${targetColumns}) ` +
          `ON DELETE ${foreignKey.onDelete ?? "no action"} ` +
          `ON UPDATE ${foreignKey.onUpdate ?? "no action"};`,
      );
    }
  }
  return statements;
}

function indexSql(environment: string): string[] {
  const schema = dataSchemaName(environment);
  const statements: string[] = [];
  for (const table of DATA_PLANE_TABLES) {
    const config = getTableConfig(table);
    for (const index of config.indexes) {
      const settings = index.config;
      const columns = settings.columns.map((column) => indexColumn(column)).join(",");
      const where = settings.where === undefined ? "" : ` WHERE ${render(settings.where)}`;
      const tableName = getTableName(table);
      const name = quote(requireName(settings.name, `an index on ${tableName}`));
      const unique = settings.unique ? "UNIQUE " : "";
      statements.push(
        `CREATE ${unique}INDEX ${name} ON ${quote(schema)}.${quote(tableName)} ` +
          `USING ${settings.method}(${columns})${where};`,
      );
    }
  }
  return statements;
}

function triggerSql(environment: string): string[] {
  const schema = dataSchemaName(environment);
  return DATA_PLANE_TRIGGERS.map(
    (trigger) =>
      `-- ${trigger.why}\n` +
      `CREATE TRIGGER ${quote(trigger.name)}\n` +
      `\t${trigger.timing} ON ${quote(schema)}.${quote(trigger.table)}\n` +
      `\tFOR EACH ROW EXECUTE FUNCTION ${CONTROL_SCHEMA}.${quote(trigger.functionName)}();`,
  );
}

/** `reporting_<env>` is on no search path, so readers must qualify it. */
function reportingViewSql(environment: string): string[] {
  return [
    `CREATE SCHEMA ${quote(reportingSchemaName(environment))};`,
    ...reportingViewStatements({
      reporting: reportingSchemaName(environment),
      data: dataSchemaName(environment),
    }),
  ];
}

/**
 * Every statement that creates one environment's schemas, tables, guards, foreign keys
 * and reporting views, in dependency order.
 */
export function createEnvironmentStatements(environment: string): string[] {
  const schema = dataSchemaName(environment);
  return [
    `CREATE SCHEMA ${quote(schema)};`,
    ...DATA_PLANE_TABLES.map((table) => createTableSql(environment, table)),
    ...foreignKeySql(environment),
    ...indexSql(environment),
    ...triggerSql(environment),
    ...reportingViewSql(environment),
  ];
}

/**
 * The grants for one environment. `qcms_app_<env>` gets DML on its own schemas and on `control` only
 * {@link CONTROL_READ_TABLES} plus one `UPDATE`; `qcms_app_control` gets `INSERT` on `outbox` only.
 * Every statement is guarded on the role existing, since an unguarded `GRANT` would fail the migration on a
 * database without `qcms_app%` roles.
 */
export function grantEnvironmentStatements(environment: string): string[] {
  const schema = dataSchemaName(environment);
  const reporting = reportingSchemaName(environment);
  const role = environmentRoleName(environment);

  const environmentGrants = [
    `GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(role)}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quote(schema)} TO ${quote(role)}`,
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${quote(schema)} TO ${quote(role)}`,
    // `ALL TABLES` reaches the environment-wide pair only because of when this runs: moving the reconciliation
    // above this pass would grant the application role every workspace's views.
    // `revokeWorkspaceViewsFromEnvironmentRole` in `./reporting.ts` corrects the restore order.
    `GRANT USAGE ON SCHEMA ${quote(reporting)} TO ${quote(role)}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${quote(reporting)} TO ${quote(role)}`,
    `GRANT USAGE ON SCHEMA ${quote(CONTROL_SCHEMA)} TO ${quote(role)}`,
    // The guarded members are emitted below instead.
    ...CONTROL_READ_TABLES.filter(
      (table) => !CONTROL_READ_TABLES_GUARDED_ON_EXISTENCE.includes(table),
    ).map((table) => `GRANT SELECT ON ${quote(CONTROL_SCHEMA)}.${quote(table)} TO ${quote(role)}`),
    // No `INSERT`: an environment role consumes a link and never mints one.
    `GRANT UPDATE ON ${quote(CONTROL_SCHEMA)}.${quote("secure_links")} TO ${quote(role)}`,
    // No type or function grant: Postgres grants both to `PUBLIC` by default, so a
    // statement here would grant what is already held. See `DATA_PLANE_ENUM_TYPES`.
  ];

  const controlRoleGrants = [
    `GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(CONTROL_ROLE)}`,
    `GRANT INSERT ON ${quote(schema)}.${quote("outbox")} TO ${quote(CONTROL_ROLE)}`,
  ];

  return [
    guardedOnRole(role, environmentGrants),
    ...CONTROL_READ_TABLES_GUARDED_ON_EXISTENCE.map((table) =>
      guardedOnRoleAndTable(role, CONTROL_SCHEMA, table, [
        `GRANT SELECT ON ${quote(CONTROL_SCHEMA)}.${quote(table)} TO ${quote(role)}`,
      ]),
    ),
    // `INSERT` and nothing else, so an environment role may add an audit row and may not
    // read, change or remove one (SEC-15).
    guardedOnRoleAndTable(role, CONTROL_SCHEMA, ACCESS_AUDIT_TABLE, [
      `GRANT INSERT ON ${quote(CONTROL_SCHEMA)}.${quote(ACCESS_AUDIT_TABLE)} TO ${quote(role)}`,
    ]),
    guardedOnRole(CONTROL_ROLE, controlRoleGrants),
    // Emitted here too, so an environment created later cannot arrive holding it.
    revokeMigrateOnlyStatement(),
  ];
}

/**
 * One (workspace, environment) reporting consumer: its views and its read-only role's
 * grants, which name those views and nothing else, because `ALL TABLES IN SCHEMA` would
 * hand a workspace's analysts every other workspace's views.
 */
export function workspaceReportingStatements(input: {
  readonly environment: string;
  readonly slug: string;
  readonly workspaceId: string;
}): string[] {
  return [
    ...workspaceReportingViewStatements({
      reporting: reportingSchemaName(input.environment),
      slug: input.slug,
      workspaceId: input.workspaceId,
      control: CONTROL_SCHEMA,
    }),
    ...workspaceReportingGrantStatements(input),
  ];
}

/** The grant half alone, for the re-grant subcommand, which must do no DDL. */
export function workspaceReportingGrantStatements(input: {
  readonly environment: string;
  readonly slug: string;
}): string[] {
  const reporting = reportingSchemaName(input.environment);
  const role = workspaceReportingRoleName(input.environment, input.slug);
  return [
    guardedOnRole(role, [
      `GRANT USAGE ON SCHEMA ${quote(reporting)} TO ${quote(role)}`,
      ...workspaceReportingViewNames(input.slug).map(
        (view) => `GRANT SELECT ON ${quote(reporting)}.${quote(view)} TO ${quote(role)}`,
      ),
    ]),
  ];
}

/**
 * The grants for a control-plane table created after the baseline, which its own migration must carry: the
 * baseline's `ALL TABLES` pass covers only tables existing then, and no default privilege can carve out the
 * break-glass audit. `qcms_app_control` gets DML; an environment role gets `SELECT` only if the table is on
 * {@link CONTROL_READ_TABLES}.
 */
export function grantControlTableStatements(table: string): string[] {
  const statements = [
    guardedOnRole(CONTROL_ROLE, [
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${quote(CONTROL_SCHEMA)}.${quote(table)} TO ${quote(CONTROL_ROLE)}`,
    ]),
  ];
  if (CONTROL_READ_TABLES.includes(table)) {
    statements.push(grantControlReadToEnvironmentRolesStatement(table));
  }
  return statements;
}

/**
 * The SEC-15 access audit's grants: `INSERT` for every application role, `SELECT` for the
 * control role alone, and `UPDATE` and `DELETE` revoked from all of them so a credential
 * serving traffic cannot rewrite the record of what it did.
 *
 * An environment role therefore cannot use `RETURNING` on an audit insert.
 */
export function grantAccessAuditStatements(): string[] {
  const table = `${quote(CONTROL_SCHEMA)}.${quote(ACCESS_AUDIT_TABLE)}`;
  return [
    guardedOnRole(CONTROL_ROLE, [`GRANT SELECT, INSERT ON ${table} TO ${quote(CONTROL_ROLE)}`]),
    grantAccessAuditInsertToEnvironmentRolesStatement(),
    revokeAccessAuditWritesStatement(),
  ];
}

function grantAccessAuditInsertToEnvironmentRolesStatement(): string {
  const grant = `GRANT INSERT ON ${quote(CONTROL_SCHEMA)}.${quote(ACCESS_AUDIT_TABLE)} TO %I`;
  return `DO $$
DECLARE environment_role text;
BEGIN
\tFOR environment_role IN
\t\tSELECT ${literal(`${APPLICATION_ROLE_PREFIX}_`)} || environment.name
\t\t\tFROM ${CONTROL_SCHEMA}.environments AS environment
\t\t\tWHERE EXISTS (
\t\t\t\tSELECT 1 FROM pg_roles
\t\t\t\t WHERE rolname = ${literal(`${APPLICATION_ROLE_PREFIX}_`)} || environment.name)
\tLOOP
\t\tEXECUTE format(${literal(grant)}, environment_role);
\tEND LOOP;
END
$$;`;
}

// Against the role prefix, so a role an operator creates later is covered too.
function revokeAccessAuditWritesStatement(): string {
  return `DO $$
DECLARE application_role text;
BEGIN
\tFOR application_role IN
\t\tSELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms\\_app%'
\tLOOP
\t\tEXECUTE format(
\t\t\t'REVOKE UPDATE, DELETE ON TABLE ${CONTROL_SCHEMA}.${ACCESS_AUDIT_TABLE} FROM %I',
\t\t\tapplication_role);
\tEND LOOP;
END
$$;`;
}

/**
 * A loop over `control.environments` rather than over `qcms_app%` roles, which is what
 * keeps `qcms_app_control` out of it. A role may not exist for an environment that has a
 * row, hence the `EXISTS` in the cursor.
 */
function grantControlReadToEnvironmentRolesStatement(table: string): string {
  const grant = `GRANT SELECT ON ${quote(CONTROL_SCHEMA)}.${quote(table)} TO %I`;
  return `DO $$
DECLARE environment_role text;
BEGIN
\tFOR environment_role IN
\t\tSELECT ${literal(`${APPLICATION_ROLE_PREFIX}_`)} || environment.name
\t\t\tFROM ${CONTROL_SCHEMA}.environments AS environment
\t\t\tWHERE EXISTS (
\t\t\t\tSELECT 1 FROM pg_roles
\t\t\t\t WHERE rolname = ${literal(`${APPLICATION_ROLE_PREFIX}_`)} || environment.name)
\tLOOP
\t\tEXECUTE format(${literal(grant)}, environment_role);
\tEND LOOP;
END
$$;`;
}

/**
 * The `control` tables an environment role may read. Exported so the least-privilege
 * suite asserts it against the catalogue rather than re-typing it.
 */
export const CONTROL_READ_TABLES: readonly string[] = [
  "forms",
  "form_versions",
  "question_versions",
  "secure_links",
  "environments",
  "form_releases",
];

/**
 * The members of {@link CONTROL_READ_TABLES} whose grant is guarded on the table existing,
 * because {@link grantEnvironmentStatements} runs both before and after the migration that
 * creates them. Not a list of tables an environment role lacks `SELECT` on.
 */
export const CONTROL_READ_TABLES_GUARDED_ON_EXISTENCE: readonly string[] = ["form_releases"];

/**
 * The identity, session, membership and grant tables an environment role must hold no
 * privilege of any kind on, so a defect on the anonymous respondent path fails on
 * permission rather than rewriting a grant. Exported like the read list.
 */
export const CONTROL_FORBIDDEN_TABLES: readonly string[] = [
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
  "two_factor_resets",
  "invitation",
  "member",
  "team",
  "teamMember",
];

function guardedOnRoleAndTable(
  role: string,
  schema: string,
  table: string,
  statements: readonly string[],
): string {
  const body = statements.map((statement) => `\t\tEXECUTE ${literal(statement)};`).join("\n");
  return `DO $$
BEGIN
\tIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)})
\t\tAND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = ${literal(schema)} AND tablename = ${literal(table)}) THEN
${body}
\tEND IF;
END
$$;`;
}

function guardedOnRole(role: string, statements: readonly string[]): string {
  const body = statements.map((statement) => `\t\tEXECUTE ${literal(statement)};`).join("\n");
  return `DO $$
BEGIN
\tIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN
${body}
\tEND IF;
END
$$;`;
}

/**
 * Takes every privilege on `control.two_factor_resets` back from every `qcms_app%` role, since an audit row a
 * traffic-serving credential could rewrite proves nothing (SEC-10). A revoke, because no grant form carves
 * one table out of a schema.
 */
export function revokeMigrateOnlyStatement(): string {
  return `DO $$
DECLARE application_role text;
BEGIN
\tFOR application_role IN
\t\tSELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms\\_app%'
\tLOOP
\t\tEXECUTE format(
\t\t\t'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE ${CONTROL_SCHEMA}.two_factor_resets FROM %I',
\t\t\tapplication_role);
\tEND LOOP;
END
$$;`;
}

/**
 * Safe only because the drop command refuses while the environment holds any session:
 * `CASCADE` over a populated schema would take the answer ledger without passing
 * `answers_reject_delete`, a third whole-session deletion path where ADR-17 allows two.
 */
export function dropEnvironmentStatements(environment: string): string[] {
  return [
    `DROP SCHEMA ${quote(reportingSchemaName(environment))} CASCADE;`,
    `DROP SCHEMA ${quote(dataSchemaName(environment))} CASCADE;`,
  ];
}
