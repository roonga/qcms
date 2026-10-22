import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Executor } from "../queries/executor.js";
import { listEnvironmentNames } from "../queries/grants.js";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  applyMigrations,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";

import { workspaceReportingRoleName } from "../schema/schemas.js";

import { createEnvironment, ownsControlSchema } from "./command.js";
import { reconcileWorkspaceReporting } from "./reporting.js";
import { describeError } from "./describe-error.js";
import { GRANT_SOURCES } from "./grants.js";
import { regrantEnvironments } from "./regrant.js";

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

/** Two workspaces, so a per-workspace grant that reached both would be visible. */
const WORKSPACES: readonly (readonly [string, string])[] = [
  ["org_regrant_home", "home"],
  ["org_regrant_vehicle", "vehicle"],
];
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
 * The complete grant map: every privilege every `qcms%` role holds, on every object kind
 * that can carry one.
 *
 * **The whole map rather than the privileges a test expected**, because the property under
 * test is "the re-grant cannot widen privilege". A listing of what was expected cannot see
 * a privilege nobody expected; an equality on the whole map can, and names it.
 *
 * **Six object kinds, not one** (PR #1099's review, finding 4). The first version read
 * `information_schema.table_privileges` plus schema `USAGE`/`CREATE`, which leaves
 * sequences, functions, types, column-level privileges, default ACLs and large objects
 * outside the equality - and the registry already emits `GRANT USAGE ON ALL SEQUENCES IN
 * SCHEMA`, so a future sequence or function grant was one generator edit away from
 * widening the model unseen. `relacl`/`proacl`/`typacl`/`nspacl` are read through
 * `aclexplode` rather than `information_schema`, which has no view for a function or a type
 * privilege; a NULL acl means "the owner's implicit rights and nothing granted", and
 * `aclexplode(NULL)` correctly yields no rows.
 *
 * A column privilege is listed only when its table does not already carry the same one, so
 * the map is not every table grant repeated once per column.
 */
async function grantMap(client: pg.Client): Promise<string[]> {
  const res = await client.query<{ line: string }>(`
    with qcms as (select oid, rolname from pg_roles where rolname like 'qcms%')
    select line from (
      select format('relation %s.%s %s %s', n.nspname, c.relname, q.rolname, a.privilege_type) as line
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
        join qcms q on q.oid = a.grantee
       where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
      union all
      select format('column %s.%s.%s %s %s', table_schema, table_name, column_name, grantee, privilege_type)
        from information_schema.column_privileges
       where grantee like 'qcms%'
         and not exists (
           select 1 from information_schema.table_privileges t
            where t.table_schema = column_privileges.table_schema
              and t.table_name = column_privileges.table_name
              and t.grantee = column_privileges.grantee
              and t.privilege_type = column_privileges.privilege_type)
      union all
      select format('function %s.%s %s %s', n.nspname, p.proname, q.rolname, a.privilege_type) as line
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(p.proacl) a
        join qcms q on q.oid = a.grantee
       where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
      union all
      select format('type %s.%s %s %s', n.nspname, t.typname, q.rolname, a.privilege_type) as line
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        cross join lateral aclexplode(t.typacl) a
        join qcms q on q.oid = a.grantee
       where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
      union all
      select format('schema %s %s %s', n.nspname, q.rolname, a.privilege_type) as line
        from pg_namespace n
        cross join lateral aclexplode(n.nspacl) a
        join qcms q on q.oid = a.grantee
       where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
      union all
      select format('default %s %s %s %s %s', coalesce(n.nspname, '-'), d.defaclobjtype,
                    pg_get_userbyid(d.defaclrole), q.rolname, a.privilege_type) as line
        from pg_default_acl d
        left join pg_namespace n on n.oid = d.defaclnamespace
        cross join lateral aclexplode(d.defaclacl) a
        join qcms q on q.oid = a.grantee
      union all
      select format('largeobject %s %s %s', l.oid, q.rolname, a.privilege_type) as line
        from pg_largeobject_metadata l
        cross join lateral aclexplode(l.lomacl) a
        join qcms q on q.oid = a.grantee
    ) lines order by line`);
  return res.rows.map((row) => row.line);
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
  // **Two workspaces, and their reporting roles**, so task 067's per-workspace source has
  // something to emit and the equality below covers it. One workspace would not: a grant
  // that reached both workspaces' views would look correct against one.
  for (const [id, slug] of WORKSPACES) {
    await owner.query(
      `insert into control.organization (id, name, slug, "createdAt") values ($1, $1, $2, now())`,
      [id, slug],
    );
    for (const environment of ["test", "prod"]) {
      // The role name is this generator's, not a literal: a test that re-typed the
      // derivation would pass while the derivation drifted.
      await owner.query(
        `CREATE ROLE ${workspaceReportingRoleName(environment, slug)} LOGIN PASSWORD '${password}'`,
      );
    }
  }
  // Registered with the harness, so teardown drains it before the container stops: an
  // unregistered pool whose database vanished underneath it reports as an unhandled
  // `terminating connection due to administrator command` (issue #888).
  const pool = testDb.register(
    new pg.Pool({ connectionString: testDb.connectionUri }),
    "owner pool",
  );
  // `drizzle(pool)` with no schema satisfies the `Executor` alias structurally but not
  // nominally, and nothing under test reads a declared table through it. The same cast
  // `environment-cli.ts` and `migrate.ts` make, for the same reason.
  db = drizzle(pool) as unknown as Executor;
  // The reporting reconciliation, which is what `docs/reporting-view.md` tells an operator
  // to run after creating a workspace. Without it this database would not be the state a
  // set-up installation is in - it would be missing every per-workspace view - and "changes
  // nothing on a database that is already correct" would be measuring the wrong database.
  await reconcileWorkspaceReporting(db);
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
    const perEnvironment = GRANT_SOURCES.filter((source) => source.scope !== "installation").length;
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
    // `Failed query: <sql>\nparams: <params>`, and the CLI unwraps a cause into the line it
    // writes to stderr. No grant statement carries a credential today; the discipline is
    // asserted anyway, so a generator that one day emits a `CREATE ROLE ... PASSWORD` is
    // not the thing that discovers this - which is exactly how it was discovered on the
    // `CREATE ROLE` path in PR #1093 and on this path in PR #1099.
    const uri = new URL(testDb.connectionUri);
    uri.username = "qcms_app_control";
    uri.password = password;
    const pool = testDb.register(new pg.Pool({ connectionString: uri.toString() }), "non-owner");
    // `drizzle(pool)` with no schema satisfies the `Executor` alias structurally but not
    // nominally, and nothing under test reads a declared table through it. The same cast
    // `environment-cli.ts` and `migrate.ts` make, for the same reason.
    const asApplicationRole = drizzle(pool) as unknown as Executor;
    // The guard the CLI applies first, for completeness: this credential is refused
    // before any statement runs.
    expect((await ownsControlSchema(asApplicationRole)).owns).toBe(false);

    const failure = await regrantEnvironments(asApplicationRole).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    // The error is an `Error` by the assertion above, so reading it as one is a narrowing
    // the compiler cannot do through `unknown` rather than a claim about its shape.
    const thrown = failure as Error;

    // **What reaches stderr**, which is the layer the leak was in: the entry file writes
    // `qcms-db environment failed: ${describeError(error)}`, and `describeError` unwraps a
    // cause into that line. Asserting the thrown message alone is what missed it.
    const printed = `qcms-db environment failed: ${describeError(thrown)}`;
    for (const leak of [/\bGRANT\b/, /\bREVOKE\b/, /Failed query/, /DO \$\$/, /params:/]) {
      expect(printed, `stderr must not carry ${String(leak)}`).not.toMatch(leak);
    }
    // And it has to say something useful: the grant source that failed, and the driver's
    // own reason. `permission denied for schema control` is what Postgres says to a role
    // that does not own it, and repeating it is what tells an operator what to do.
    expect(printed).toContain("could not re-apply");
    expect(printed).toContain("the control role's DML on control (baseline)");
    expect(printed).toMatch(/permission denied/i);
    // No cause at all, which is what makes the line above provable rather than lucky:
    // `describeError` appends a cause's message, so the wrapper must attach none.
    expect(thrown.cause).toBeUndefined();
  });

  it("is stable over a workspace whose reporting roles the operator has not created", async () => {
    // The shape the Compose stack is in, and the one the restore drill found: 067's grants
    // are guarded on each reporting role existing, so for such a workspace the views carry
    // no ACL at all. Both of this PR's database-reading sources have to leave that alone -
    // a `REVOKE` on a NULL `relacl` materialises it, and `aclexplode` then reports the
    // owner's seven implicit entries for a relation that is semantically unchanged.
    await owner.query(
      `insert into control.organization (id, name, slug, "createdAt")
         values ('org_regrant_unprovisioned', 'Unprovisioned', 'unprovisioned', now())`,
    );
    await reconcileWorkspaceReporting(db);
    const expected = await grantMap(owner);
    // The views exist, and nothing is granted on them, which is what makes the next two
    // runs worth measuring.
    expect(expected.filter((line) => line.includes("unprovisioned"))).toEqual([]);

    await regrantEnvironments(db);
    expect(await grantMap(owner), "after one re-grant").toEqual(expected);
    await regrantEnvironments(db);
    expect(await grantMap(owner), "after a second re-grant").toEqual(expected);
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
