import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Executor } from "../queries/executor.js";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  applyMigrations,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";

import { createEnvironment, ownsControlSchema } from "./command.js";
import { GRANT_SOURCES } from "./grants.js";
import { listEnvironmentNames, regrantEnvironments } from "./regrant.js";

/**
 * The re-grant subcommand against a real catalogue (issue #1094).
 *
 * This file covers the three properties that do not need a dump to observe:
 *
 *   - **it is a no-op on a database that is already correct**, so an operator can run it
 *     without wondering what it changed;
 *   - **running it twice changes nothing**, which is what makes it safe inside a recovery
 *     script that may be re-run;
 *   - **it repairs a database whose application grants have been taken away**, which is
 *     the restored shape, and repairs it to **exactly** the grant map a migrated database
 *     holds rather than to a superset.
 *
 * The full dump-restore-re-grant cycle, with `pg_dump` and ownership, is
 * `apps/api/e2e/security/04-db-restore-regrant.e2e.ts`; the end-to-end operator
 * procedure is `pnpm qcms:drill-restore`.
 *
 * ## Why the roles are created before the migration here
 *
 * The baseline's grants are guarded on each role existing, so a database migrated with no
 * application role has no grant to compare against and this file would measure nothing.
 * The ordering is the operator recipe's, the same one `03-db-least-privilege.e2e.ts`
 * follows: roles first, migration second.
 */

const REGRANT_TIMEOUT_MS = 60_000;

const MIGRATE_ROLE = "qcms_migrate";
const APPLICATION_ROLES = [
  "qcms_app_control",
  "qcms_app_test",
  "qcms_app_prod",
  // A name this project does not ship, so the prefix-shaped revokes are executed rather
  // than believed, exactly as the least-privilege suite does it.
  "qcms_app_zebra",
] as const;

let testDb: TestDb;
let owner: pg.Client;
let db: Executor;
/** The password every role in this container is created with. Generated, never committed. */
let password: string;

function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The complete grant map: every privilege every `qcms%` role holds on every table and
 * view in every schema QCMS named, plus schema `USAGE` and `CREATE`.
 *
 * **The whole map rather than the privileges a test expected**, because the property
 * under test is "the re-grant cannot widen privilege". A listing of what was expected
 * cannot see a privilege nobody expected; an equality on the whole map can, and names it.
 */
async function grantMap(client: pg.Client): Promise<string[]> {
  const tables = await client.query<{ row: string }>(
    `select format('%s.%s %s %s', table_schema, table_name, grantee, privilege_type) as row
       from information_schema.table_privileges
      where grantee like 'qcms%'
      order by 1`,
  );
  const schemas = await client.query<{ row: string }>(
    `select format('schema %s %s %s', n.nspname, r.rolname, p.privilege) as row
       from pg_catalog.pg_namespace n
       cross join pg_catalog.pg_roles r
       cross join (values ('USAGE'), ('CREATE')) as p(privilege)
      where r.rolname like 'qcms%'
        and n.nspname not like 'pg\\_%'
        and n.nspname <> 'information_schema'
        and has_schema_privilege(r.rolname, n.nspname, p.privilege)
      order by 1`,
  );
  return [...tables.rows.map((row) => row.row), ...schemas.rows.map((row) => row.row)];
}

beforeAll(async () => {
  // UNMIGRATED on purpose: the roles have to exist before the baseline reaches its grant
  // block, which is the recipe's ordering.
  testDb = await startTestDb({ migrate: false });
  owner = testDb.register(new pg.Client({ connectionString: testDb.connectionUri }), "owner");
  await owner.connect();

  password = ephemeralPassword();
  for (const role of [MIGRATE_ROLE, ...APPLICATION_ROLES]) {
    // The role name is a literal from the list above, never input.
    await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  }
  await applyMigrations(owner);
  // Registered with the harness, so teardown drains it before the container stops: an
  // unregistered pool whose database vanished underneath it reports as an unhandled
  // `terminating connection due to administrator command` (issue #888).
  const pool = testDb.register(
    new pg.Pool({ connectionString: testDb.connectionUri }),
    "owner pool",
  );
  db = drizzle(pool) as unknown as Executor;
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the re-grant subcommand", { timeout: REGRANT_TIMEOUT_MS }, () => {
  it("reads the live set in `position` order", async () => {
    expect(await listEnvironmentNames(db)).toEqual(["test", "prod"]);
  });

  it("changes nothing on a database that is already correct", async () => {
    // The first thing an operator will do with this command is run it on a database they
    // are not sure about. It has to be safe, and "safe" is an equality on the whole grant
    // map rather than an absence of errors.
    const before = await grantMap(owner);
    expect(before.length).toBeGreaterThan(50);
    const report = await regrantEnvironments(db);
    expect(report.environments).toEqual(["test", "prod"]);
    expect(report.statements).toBeGreaterThan(0);
    expect(await grantMap(owner)).toEqual(before);
  });

  it("changes nothing when it runs twice", async () => {
    const after = await grantMap(owner);
    await regrantEnvironments(db);
    expect(await grantMap(owner)).toEqual(after);
  });

  it("reports one pass per source, with every environment-scoped source expanded", async () => {
    const report = await regrantEnvironments(db);
    const perEnvironment = GRANT_SOURCES.filter((source) => source.scope === "environment").length;
    const installation = GRANT_SOURCES.length - perEnvironment;
    expect(report.passes).toHaveLength(installation + perEnvironment * 2);
    // Task 067's reporting source arrives as one more environment-scoped entry, and this
    // count follows it with no change here.
    for (const pass of report.passes) expect(pass.statements).toBeGreaterThan(0);
  });

  it("reports that `public` grants PUBLIC no CREATE, which the baseline established", async () => {
    const report = await regrantEnvironments(db);
    expect(report.publicCreateGrantedToPublic).toBe(false);
  });

  it("restores exactly the grant map after the application grants are taken away", async () => {
    // The restored shape, simulated at the privilege layer: `pg_dump --no-privileges`
    // leaves the objects and drops every grant, and this is what that leaves behind. The
    // repair has to land on the SAME map, not a superset - which is the security
    // requirement of the ruling, asserted as an equality.
    const expected = await grantMap(owner);
    for (const role of APPLICATION_ROLES) {
      for (const schema of [
        "control",
        "data_test",
        "data_prod",
        "reporting_test",
        "reporting_prod",
      ]) {
        await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`);
        await owner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}`);
        await owner.query(`REVOKE ALL ON SCHEMA ${schema} FROM ${role}`);
      }
    }
    const stripped = await grantMap(owner);
    expect(stripped).not.toEqual(expected);
    // And the specific grant the defect report named, gone.
    const refused = await owner.query<{ has: boolean }>(
      `select has_table_privilege('qcms_app_prod', 'data_prod.sessions', 'INSERT') as has`,
    );
    expect(refused.rows[0]?.has).toBe(false);

    await regrantEnvironments(db);
    expect(await grantMap(owner)).toEqual(expected);
  });

  it("covers an environment created after the migrations, by reading the live set", async () => {
    // The reason the command enumerates `control.environments` rather than naming `test`
    // and `prod`: an operator who created `staging` last week has to get its grants back
    // from a re-grant written before it existed.
    await owner.query(`CREATE ROLE qcms_app_staging LOGIN PASSWORD '${password}'`);
    await createEnvironment(db, { name: "staging" });
    const expected = await grantMap(owner);
    for (const schema of ["control", "data_staging", "reporting_staging"]) {
      await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM qcms_app_staging`);
      await owner.query(`REVOKE ALL ON SCHEMA ${schema} FROM qcms_app_staging`);
    }
    expect(await grantMap(owner)).not.toEqual(expected);

    const report = await regrantEnvironments(db);
    expect(report.environments).toEqual(["test", "prod", "staging"]);
    expect(await grantMap(owner)).toEqual(expected);
  });

  it("names the source and never the statement when Postgres refuses (SEC-8)", async () => {
    // drizzle wraps a failed statement in a `DrizzleQueryError` whose message is
    // `Failed query: ${query}`, and the CLI writes an error's message to stderr. No grant
    // statement carries a credential today; the discipline is asserted anyway, so a
    // generator that one day emits a `CREATE ROLE ... PASSWORD` is not the thing that
    // discovers this.
    const pool = testDb.register(
      new pg.Pool({
        connectionString: (() => {
          const uri = new URL(testDb.connectionUri);
          uri.username = "qcms_app_control";
          uri.password = password;
          return uri.toString();
        })(),
      }),
      "non-owner pool",
    );
    const asApplicationRole = drizzle(pool) as unknown as Executor;
    // The guard the CLI applies first, for completeness: this credential is refused
    // before any statement runs.
    expect((await ownsControlSchema(asApplicationRole)).owns).toBe(false);

    const failure = await regrantEnvironments(asApplicationRole).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("could not re-apply");
    expect(message).toContain("SEC-8");
    expect(message).not.toMatch(/\bGRANT\b/);
    expect(message).not.toMatch(/\bREVOKE\b/);
    expect(message).not.toContain("Failed query");
    // The cause is still attached, so the CLI's one-line form says why Postgres refused.
    expect((failure as Error).cause).toBeDefined();
  });

  it("refuses a database whose live set is empty, rather than granting nothing quietly", async () => {
    // A restored database carries the live set inside the dump, so an empty table means
    // the restore did not land the control plane - which is worth a refusal rather than a
    // report of zero statements that reads as success.
    await owner.query(
      `create table control.environments_regrant_backup as table control.environments`,
    );
    await owner.query(`delete from control.environments where name = 'staging'`);
    await owner.query(`alter table control.form_releases disable trigger all`);
    await owner.query(`delete from control.form_releases`);
    await owner.query(`delete from control.environments`);
    try {
      await expect(regrantEnvironments(db)).rejects.toThrow(/environments is empty/);
    } finally {
      await owner.query(
        `insert into control.environments select * from control.environments_regrant_backup`,
      );
      await owner.query(`alter table control.form_releases enable trigger all`);
      await owner.query(`drop table control.environments_regrant_backup`);
    }
  });
});
