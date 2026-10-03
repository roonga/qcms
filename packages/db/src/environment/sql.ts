/**
 * The per-environment generator (ADR-40, task 064).
 *
 * # Why a generator and not N copies of the SQL
 *
 * An environment is a schema, and every data-plane table, guard and foreign key exists
 * **once per environment**. drizzle-kit cannot express that: it diffs a schema source
 * against a snapshot and emits one set of tables, with no notion of N copies of the
 * same table in N schemas whose names come from a database row. So the per-environment
 * half of the baseline is hand-authored SQL - and hand-authored SQL copied twice is
 * hand-authored SQL that will differ on the third copy.
 *
 * This module is the answer. It reads the data-plane module
 * (`../schema/data/index.ts`) and emits one environment's objects from it, so:
 *
 *   - the **baseline** emits `test` and `prod` from here, checked in as SQL because a
 *     migration is a file the migrator reads, with `environment-sql.test.ts` asserting
 *     the checked-in text is still what this module produces;
 *   - the **environment command** emits every later environment from here, at run time;
 *   - and the **counts** are a consequence of the code rather than a paragraph to
 *     maintain. `environmentObjectNames` derives them, and the tests assert against the
 *     derivation rather than against a number somebody typed.
 *
 * The first draft of the design listed four of the twelve guards it then had, which is
 * exactly why the durable form is code.
 *
 * # What multiplies and what does not
 *
 * The **trigger functions stay single, in `control`**: a trigger in `data_test`
 * executes `control.answers_reject_update()`, so N triggers share one body. The
 * **control-plane tables** are one copy and are not this module's. The **reporting
 * views** are per environment (Q10) and are here, because they read one environment's
 * data-plane tables by name.
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
  CONTROL_ROLE,
  CONTROL_SCHEMA,
  dataSchemaName,
  environmentRoleName,
  reportingSchemaName,
} from "../schema/schemas.js";
import {
  DATA_PLANE_TABLES,
  DATA_PLANE_TABLE_NAMES,
  DATA_PLANE_TRIGGERS,
  SESSION_ENVIRONMENT_CHECK,
} from "../schema/data/index.js";

const dialect = new PgDialect();

/** `forms` as `"forms"`. Postgres identifier quoting, with the doubling rule. */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * A name drizzle types as optional but always sets for the objects this module reads.
 *
 * Throwing rather than defaulting: an index or a constraint with no name would be
 * emitted with an empty one, which Postgres would then name for us differently in every
 * environment - and the whole point of the derivation is that the names are the same
 * set everywhere and can be asserted back out of the catalogue.
 */
function requireName(name: string | undefined, what: string): string {
  if (name === undefined || name === "") {
    throw new Error(`the per-environment generator needs a name for ${what}`);
  }
  return name;
}

/** `'test'` from `test`. A SQL string literal, with the doubling rule. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Render a schema-level `SQL` fragment - a CHECK predicate, an index predicate, an
 * index expression, a column default - to text.
 *
 * Parameters are **inlined**, because this is DDL: there is no statement to bind them
 * to. A fresh `SQL` wrapping the same chunks rather than `value.inlineParams()`, which
 * mutates the object the schema module exported and would leave every later reader of
 * that table looking at an altered fragment.
 *
 * Column references come out as `"table"."column"`, unqualified by schema, which is
 * what a constraint or an index on a table inside `data_<env>` needs: the range-table
 * entry in scope is the table itself.
 */
function render(value: SQL): string {
  return dialect.sqlToQuery(new SQL(value.queryChunks).inlineParams()).sql;
}

/** A column's type, with an enum type qualified into `control` where it lives. */
function columnType(column: PgColumn): string {
  const sqlType = column.getSQLType();
  return column.columnType === "PgEnumColumn" ? `${CONTROL_SCHEMA}.${quote(sqlType)}` : sqlType;
}

/** A column default as DDL text. */
function columnDefault(value: unknown): string {
  if (value instanceof SQL) return render(value);
  if (typeof value === "string") return literal(value);
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value === null) return "NULL";
  throw new Error(`the per-environment generator cannot render a ${typeof value} column default`);
}

/** One column's line inside `CREATE TABLE`. */
function columnDefinition(column: PgColumn): string {
  const parts = [quote(column.name), columnType(column)];
  if (column.primary) parts.push("PRIMARY KEY");
  if (column.hasDefault && column.default !== undefined) {
    parts.push(`DEFAULT ${columnDefault(column.default)}`);
  }
  if (column.notNull) parts.push("NOT NULL");
  return `\t${parts.join(" ")}`;
}

/** One column reference inside an index, with its sort order when it is not the default. */
function indexColumn(column: Partial<IndexedColumn | SQL>): string {
  if (column instanceof SQL) return render(column);
  const indexed = column as Partial<IndexedColumn>;
  const config = indexed.indexConfig;
  const order = config?.order === "desc" ? " DESC" : "";
  // Postgres's own defaults: ASC implies NULLS LAST and DESC implies NULLS FIRST, so
  // the clause is written only where it is not already what the sort order gives.
  let nulls = "";
  if (config?.nulls === "first") nulls = " NULLS FIRST";
  else if (order !== "") nulls = " NULLS LAST";
  return `${quote(requireName(indexed.name, "an index column"))}${order}${nulls}`;
}

/**
 * Every enum type a data-plane table's column is declared with.
 *
 * **The types are created once, in `control`, exactly as the trigger functions are**
 * (Code Owner, 2026-09-29, Q54). They are not per environment and are not part of the
 * per-environment set: `data_test.sessions` and `data_prod.sessions` both use
 * `control.access_mode`, so the closed set of values is one declaration and a change to
 * it is one migration rather than one per environment.
 *
 * What each environment role does need is **`USAGE` on the type**, which Postgres
 * requires to write a value of it. `PUBLIC` holds that by default, so the grant below is
 * strictly speaking redundant on a stock cluster - and it is emitted anyway, because a
 * deployment that hardened its database by revoking type usage from `PUBLIC` would
 * otherwise see every session insert fail with a permission error naming a type nobody
 * had thought about. Stating it makes the requirement visible and costs one statement.
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
  /** The data-plane schema, `data_<env>`. */
  readonly schema: string;
  /** The reporting view schema, `reporting_<env>`. */
  readonly reportingSchema: string;
  /** The application role, `qcms_app_<env>`. */
  readonly role: string;
  /** The data-plane tables, in creation order. */
  readonly tables: readonly string[];
  /**
   * Every guard: a trigger, a CHECK, a UNIQUE or an index on a data-plane table.
   * These are the objects whose absence is **silent** - an environment missing
   * `answers_reject_delete` has an erasable ledger and nothing says so - which is why
   * they are counted apart from the foreign keys, whose absence fails on the first
   * insert.
   */
  readonly guards: readonly string[];
  /** Every foreign key declared on a data-plane table. */
  readonly foreignKeys: readonly string[];
  /** The foreign keys that reference a table in this environment's own schema. */
  readonly inPlaneForeignKeys: readonly string[];
  /** The foreign keys that reference the single `control` copy. */
  readonly crossingForeignKeys: readonly string[];
}

/**
 * Derive the per-environment object set from the data-plane module.
 *
 * **This is the derivation the counts come from.** Nothing here reads a number; the
 * tests compare `guards.length` and `foreignKeys.length` against what a `grep` of the
 * migration SQL finds, and against what `pg_constraint` and `pg_trigger` hold after the
 * baseline has run. A figure written into a document goes stale silently; this does
 * not.
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
  // Q46's thirteenth guard, the one whose text differs per environment.
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

/** `CREATE TABLE data_<env>.<name> (...)`, with its checks, uniques and composite key. */
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
    // Q46. The one guard whose predicate names the schema it sits in, so it cannot be
    // declared on the Drizzle table beside the others. A CHECK passes on NULL, which is
    // why `environment` is NOT NULL on the column above.
    lines.push(
      `\tCONSTRAINT ${quote(SESSION_ENVIRONMENT_CHECK)} ` +
        `CHECK ("sessions"."environment" = ${literal(environment)})`,
    );
  }

  return `CREATE TABLE ${quote(schema)}.${quote(getTableName(table))} (\n${lines.join(",\n")}\n);`;
}

/** Every `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` for one environment. */
function foreignKeySql(environment: string): string[] {
  const schema = dataSchemaName(environment);
  const statements: string[] = [];
  for (const table of DATA_PLANE_TABLES) {
    const config = getTableConfig(table);
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const target = getTableName(reference.foreignTable);
      // The half a generator gets wrong quietly: an in-plane key written once against
      // `data_test` and copied can end up pointing at another environment's `sessions`,
      // which is a cross-environment reference the search path would never reveal. The
      // target schema is therefore derived per key, and criterion 1a asserts it back
      // out of `pg_constraint`.
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

/** Every `CREATE INDEX` for one environment. */
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

/** Every `CREATE TRIGGER` for one environment, each executing its single body in `control`. */
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

/**
 * The erasure-safe reporting views for one environment (Q10).
 *
 * One schema per environment holding the same two view names, so a BI tool connects to
 * one environment's schema and its queries are otherwise unchanged. `reporting_<env>`
 * is on **no search path**, so `queries/reporting.ts` reads it schema-qualified; that
 * is the one place in the package where a schema name is interpolated, and it is
 * interpolated from the connection's own environment.
 *
 * The erasure guarantee is in the shape of the view rather than in a filter a caller
 * has to remember: an erased session is absent because its tombstone joins, and a
 * non-submitted one is absent because the status is checked here (ADR-17, I11).
 */
function reportingViewSql(environment: string): string[] {
  const data = quote(dataSchemaName(environment));
  const reporting = quote(reportingSchemaName(environment));
  return [
    `CREATE SCHEMA ${reporting};`,
    `CREATE VIEW ${reporting}."responses" AS
SELECT
\t"sub"."session_id" AS "session_id",
\t"s"."form_id" AS "form_id",
\t"s"."form_version" AS "form_version",
\t"sub"."submitted_at" AS "submitted_at",
\t"s"."access_mode" AS "access_mode",
\tCOALESCE(
\t\t(
\t\t\tSELECT jsonb_object_agg("elem"."item" ->> 'questionId', "elem"."item" -> 'value')
\t\t\tFROM jsonb_array_elements("sub"."locked_answers" -> 'answers') AS "elem"("item")
\t\t),
\t\t'{}'::jsonb
\t) AS "answers"
FROM ${data}."submissions" "sub"
JOIN ${data}."sessions" "s" ON "s"."session_id" = "sub"."session_id"
LEFT JOIN ${data}."erasure_tombstones" "t" ON "t"."session_id" = "sub"."session_id"
WHERE "s"."status" = 'submitted'
\tAND "t"."session_id" IS NULL;`,
    `CREATE VIEW ${reporting}."answers_flat" AS
SELECT
\t"r"."session_id" AS "session_id",
\t"r"."form_id" AS "form_id",
\t"r"."form_version" AS "form_version",
\t"r"."submitted_at" AS "submitted_at",
\t"kv"."key" AS "question_id",
\t"kv"."value" AS "value"
FROM ${reporting}."responses" "r"
CROSS JOIN LATERAL jsonb_each("r"."answers") AS "kv"("key", "value");`,
  ];
}

/**
 * Every statement that creates one environment's schemas, tables, guards, foreign keys
 * and reporting views, in dependency order.
 *
 * Returned as a list of statements rather than one blob, because the baseline joins
 * them with drizzle's `--> statement-breakpoint` and the environment command executes
 * them one at a time inside one transaction.
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
 * The grants for one environment (Q17, Q40, Q48, Q49, Q52), as statements.
 *
 * Read the shape off the three roles rather than off the statements:
 *
 *   - **`qcms_app_<env>`** holds DML on its own `data_<env>` and nothing in any other
 *     environment's; `USAGE` on its own `reporting_<env>` with `SELECT` on that
 *     schema's views and on no other environment's (Q52); and on `control` the named
 *     read list plus one `UPDATE`, so a defect on the anonymous respondent path cannot
 *     rewrite a grant row or a staff session. That list is **five** `SELECT`s today and
 *     **six** once task 065 creates `form_releases`; see {@link CONTROL_READ_TABLES}.
 *   - **`qcms_app_control`** holds `INSERT` on this environment's `outbox` and **nothing
 *     else in any data schema** (Q49), because a release record and its `form.released`
 *     event commit in one transaction. `USAGE` on the schema is the unavoidable
 *     companion of that one grant: Postgres has no way to reach a table in a schema
 *     without it, and it conveys no access to any other table.
 *   - **`qcms_migrate`** is the owner and is untouched here.
 *
 * Every statement is **guarded on the role existing**, for the reason migration 0021's
 * revoke is: most databases this runs against have no `qcms_app%` role at all - a
 * Testcontainers harness and a single-credential development database both migrate as
 * one superuser - and an unguarded `GRANT` would fail on them and take the whole
 * migration with it.
 */
export function grantEnvironmentStatements(environment: string): string[] {
  const schema = dataSchemaName(environment);
  const reporting = reportingSchemaName(environment);
  const role = environmentRoleName(environment);

  const environmentGrants = [
    `GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(role)}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quote(schema)} TO ${quote(role)}`,
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${quote(schema)} TO ${quote(role)}`,
    // Q52: its own reporting views and no other environment's.
    `GRANT USAGE ON SCHEMA ${quote(reporting)} TO ${quote(role)}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${quote(reporting)} TO ${quote(role)}`,
    `GRANT USAGE ON SCHEMA ${quote(CONTROL_SCHEMA)} TO ${quote(role)}`,
    // The `control` reads of Q40 as amended by Q48: five today, six once 065 lands.
    // `question_versions` is on the list because `getQuestionVersion` runs on every
    // step served and every submission; without it every respondent request fails on
    // permission.
    ...CONTROL_READ_TABLES.filter(
      (table) => !CONTROL_READ_TABLES_NOT_YET_CREATED.includes(table),
    ).map((table) => `GRANT SELECT ON ${quote(CONTROL_SCHEMA)}.${quote(table)} TO ${quote(role)}`),
    // One-time link consumption (`consumeSecureLink`). Deliberately no `INSERT`: an
    // environment role redeems and consumes a link, it never mints one. Minting runs on
    // the control pool (Q53).
    `GRANT UPDATE ON ${quote(CONTROL_SCHEMA)}.${quote("secure_links")} TO ${quote(role)}`,
    // Q54: the two enum types live once in `control`, and writing a value of one needs
    // USAGE on it.
    ...DATA_PLANE_ENUM_TYPES.map(
      (type) => `GRANT USAGE ON TYPE ${quote(CONTROL_SCHEMA)}.${quote(type)} TO ${quote(role)}`,
    ),
  ];

  const controlRoleGrants = [
    `GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(CONTROL_ROLE)}`,
    `GRANT INSERT ON ${quote(schema)}.${quote("outbox")} TO ${quote(CONTROL_ROLE)}`,
  ];

  return [
    guardedOnRole(role, environmentGrants),
    // `form_releases` is on the six-table read list and is **task 065's** table, so its
    // grant is guarded on the table existing rather than left out: the list is the
    // decision, and a grant that had to be remembered when 065 landed would be a
    // boundary nobody wrote down.
    ...CONTROL_READ_TABLES_NOT_YET_CREATED.map((table) =>
      guardedOnRoleAndTable(role, CONTROL_SCHEMA, table, [
        `GRANT SELECT ON ${quote(CONTROL_SCHEMA)}.${quote(table)} TO ${quote(role)}`,
      ]),
    ),
    guardedOnRole(CONTROL_ROLE, controlRoleGrants),
    // `two_factor_resets` stays migrate-only for EVERY `qcms_app%` role, the control
    // role included (Q40, finding B). Emitted per environment as well as in the
    // baseline so an environment created later cannot arrive holding it.
    revokeMigrateOnlyStatement(),
  ];
}

/**
 * The `control` tables an environment role may read (Q40 as amended by Q48).
 *
 * **Five are granted at this task's landing and the sixth arrives with task 065.**
 * `form_releases` is **task 065's** table and does not exist yet, so its grant is
 * guarded on the table existing rather than left out: the list is the decision, and a
 * grant that had to be remembered when 065 landed would be a boundary nobody wrote
 * down. Exported because `apps/api/e2e/security/03-db-least-privilege.e2e.ts` asserts
 * the list per role from the catalogue, and a test that re-typed it would pass while
 * the grant drifted.
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
 * The members of {@link CONTROL_READ_TABLES} whose table a later task creates, so
 * their grant is guarded on the table existing. `form_releases` is task 065's.
 */
export const CONTROL_READ_TABLES_NOT_YET_CREATED: readonly string[] = ["form_releases"];

/**
 * The tables an environment role must hold **no privilege of any kind** on (Q40).
 *
 * Identity, session, membership and grant tables. This is the property Q40 buys that
 * an API-layer check cannot: an environment pool has no grant on them at all, so a
 * defect on the anonymous respondent path fails on permission rather than rewriting a
 * grant. Exported for the same reason as the read list.
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

/** Wrap statements in the same guard, plus a check that the table exists yet. */
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

/** Wrap statements in the `DO $$ ... IF EXISTS (pg_roles) ... $$` guard 0021 established. */
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
 * Take every privilege on `control.two_factor_resets` back from **every `qcms_app%`
 * role**, not from one literal name (Q40, finding B).
 *
 * That table records that somebody cleared an administrator's second factor out of
 * band. The credential that performs a reset is the migration role, and the point of
 * SEC-10's split is that the credential serving traffic is not that one, so an audit
 * row an application credential can `UPDATE` or `DELETE` proves nothing against the
 * attacker the split is drawn against. Migration 0021 named `qcms_app`; there are now
 * as many application roles as there are environments plus one, and naming them would
 * be a list that goes stale the first time an operator creates an environment.
 *
 * It has to be a revoke rather than a narrower grant: `GRANT ... ON ALL TABLES IN
 * SCHEMA` and `ALTER DEFAULT PRIVILEGES` are both keyed on (role, schema, object type)
 * with no per-table filter, so "every table except that one" is not expressible in
 * Postgres. The grant lands and is taken back.
 *
 * The SEC-15 access audit's own grants and revokes are **task 069's migration**, which
 * is the migration that creates that table; this one has nothing to act on there.
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
 * `DROP SCHEMA data_<env>` and its companions, for the environment **drop** command.
 *
 * Deliberately **not** `CASCADE` on a populated schema: the command refuses while any
 * form in the environment is open or any session exists, so by the time this runs the
 * schema holds no answer row. `CASCADE` here would otherwise take the answer ledger
 * without passing the `answers_reject_delete` trigger, which would be a third
 * whole-session deletion path, and ADR-17 says there are two.
 *
 * Nothing in a **migration** ever calls this. It is the command's, and the command is
 * the only caller, which is what keeps the baseline free of a `DROP` (Q41).
 */
export function dropEnvironmentStatements(environment: string): string[] {
  return [
    `DROP SCHEMA ${quote(reportingSchemaName(environment))} CASCADE;`,
    `DROP SCHEMA ${quote(dataSchemaName(environment))} CASCADE;`,
  ];
}
