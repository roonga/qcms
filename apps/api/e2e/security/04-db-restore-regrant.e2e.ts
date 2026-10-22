/**
 * Security scenario 4 - a restored backup holds exactly the grants a migrated database
 * holds, and nothing more (SEC-8, SEC-10, ADR-40, issue #1094).
 *
 * ## The defect
 *
 * `docs/backup-restore.md` dumps with `pg_dump --clean --if-exists --no-owner
 * --no-privileges`, and the Code Owner's ruling of 2026-10-22 keeps `--no-privileges` so
 * the dump stays free of role names and portable. The dump therefore carries **no grant
 * at all** - zero `GRANT` and `REVOKE` lines against the 39 in the baseline - and the
 * drizzle journal rides inside it, so a post-restore `qcms-db-migrate` re-applies nothing.
 * Since task 064 put every application grant in the baseline, a restored database came
 * back with `qcms_app_prod` holding no `USAGE` on `data_prod` and no `INSERT` on
 * `data_prod.sessions`, and the first respondent write answered 500.
 *
 * Restoring as `$POSTGRES_USER` was the second half: `--no-owner` lands ownership on
 * whoever runs the restore, so `control`, `data_<env>` and `reporting_<env>` came back
 * owned by the superuser, `ownsControlSchema` then refused the environment command, and a
 * later migration run as `qcms_migrate` would fail on objects it did not own.
 *
 * ## What this file does, and why it is not 03 run twice
 *
 * It takes a **real** dump with the documented flags, destroys every schema, restores as
 * `qcms_migrate`, runs the re-grant subcommand, and then compares the **complete grant
 * map and the complete ownership map** against the snapshots taken before the dump, for
 * equality.
 *
 * That is deliberately stronger than re-running `03-db-least-privilege.e2e.ts`'s
 * expectations, and strictly contains them. Every assertion in 03 is a projection of this
 * map: the six-table read list, `access_audit` as `INSERT` alone, `two_factor_resets`
 * absent, `INSERT` on `outbox` and nothing else in a data schema, nothing at all in
 * another environment's. An equality on the whole map holds every one of them **and**
 * fails on a privilege no assertion in 03 happens to ask about, which is what the ruling's
 * "the exact grant lists, not has at least" asks for. The projections are spelled out
 * below anyway, read from the constants `@roonga/qcms-db` exports, so a failure says which
 * claim broke rather than printing a diff of several hundred rows.
 *
 * 03 is left untouched on purpose: it owns the claim about a **migrated** database, which
 * is a different claim from this file's, and it was task 067's to edit (PR #1093, merged
 * as `98bf4f32`). Keeping the two files apart is what lets a failure here say "the restore
 * lost a grant" rather than "least privilege is wrong somewhere".
 *
 * ## Why `container.exec` rather than a simulated dump
 *
 * The defect **is** what `pg_dump` leaves out, so a dump simulated over a connection
 * would prove nothing. `pg_dump` and `psql` are the server's own binaries, so the suite
 * reaches them through the container (`StartedTestPostgres.exec`, widened for this file).
 */

import {
  applyMigrations,
  CONTAINER_BOOT_TIMEOUT_MS,
  PRIVILEGE_MAP_SQL,
} from "@roonga/qcms-db/testing";
import {
  ACCESS_AUDIT_TABLE,
  CONTROL_FORBIDDEN_TABLES,
  CONTROL_READ_TABLES,
  DATA_PLANE_TABLE_NAMES,
  ENDPOINT_PROPOSALS_TABLE,
  GRANT_SOURCES,
  ownsControlSchema,
  reconcileWorkspaceReporting,
  regrantEnvironments,
  workspaceReportingRoleName,
  workspaceReportingViewNames,
} from "@roonga/qcms-db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "../support/index.js";

const MIGRATE_ROLE = "qcms_migrate";
const CONTROL_ROLE = "qcms_app_control";
const ENVIRONMENTS = ["test", "prod"] as const;
const ENVIRONMENT_ROLES = { test: "qcms_app_test", prod: "qcms_app_prod" } as const;
/** A name this project does not ship, so the prefix-shaped revokes are executed. */
const UNSHIPPED_ROLE = "qcms_app_zebra";

/**
 * **Two** workspaces, so task 067's per-workspace reporting grants are covered by the
 * equality below (PR #1099's review, finding 3).
 *
 * One would not be enough for the claim that matters: a grant that reached both
 * workspaces' views would look correct against a single workspace, and the whole point of
 * Q26 is that an analyst holding one workspace's role reads one workspace's views.
 */
const WORKSPACES: readonly { readonly id: string; readonly slug: string }[] = [
  { id: "org_restore_home", slug: "home" },
  { id: "org_restore_vehicle", slug: "vehicle" },
];

/** Every `qcms_reporting_<env>_<slug>` role, derived rather than typed. */
const REPORTING_ROLES = ENVIRONMENTS.flatMap((environment) =>
  WORKSPACES.map((workspace) => workspaceReportingRoleName(environment, workspace.slug)),
);
/** Every schema QCMS names, which is also the set whose ownership is asserted. */
const QCMS_SCHEMAS = [
  "control",
  "data_test",
  "data_prod",
  "reporting_test",
  "reporting_prod",
] as const;
const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

/**
 * Where the dump lands inside the container.
 *
 * `/var/lib/postgresql` rather than `/tmp`: the directory is the `postgres` user's own
 * inside a container this test alone owns, so there is no shared-temp race and no
 * sticky-bit question to reason about. `sonarjs/publicly-writable-directories` is right
 * to ask about `/tmp`, and the answer here is to not use it.
 */
const DUMP_PATH = "/var/lib/postgresql/qcms-restore-regrant.sql";

let testDb: TestDb;
/** Superuser connection: the "as a superuser or the database owner" the recipe asks for. */
let owner: pg.Client;
/** The migration credential, which is what the re-grant subcommand runs on. */
let migratePool: pg.Pool;
const passwords = new Map<string, string>();
const clients = new Map<string, pg.Client>();

/** A throwaway password for a containerised role. Generated, never committed. */
function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uriFor(role: string): string {
  const uri = new URL(testDb.connectionUri);
  uri.username = role;
  uri.password = passwords.get(role) ?? "";
  return uri.toString();
}

async function connectAs(role: string, searchPath: string): Promise<pg.Client> {
  const client = testDb.register(
    new pg.Client({ connectionString: uriFor(role), options: `-c search_path=${searchPath}` }),
    `${role} client`,
  );
  await client.connect();
  return client;
}

/** Run a command inside the container and fail loudly, with its output, when it exits non-zero. */
async function inContainer(command: string[], what: string): Promise<string> {
  const result = await testDb.container.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(`${what} exited ${String(result.exitCode)}:\n${result.output}`);
  }
  return result.output;
}

/** `psql` inside the container, as `role`, over the local socket. */
function psql(role: string, args: string[]): string[] {
  // The local socket, where the official image's `pg_hba.conf` carries initdb's own
  // default of `local all all trust`, so no password is needed and none is passed. The
  // image sets no `--auth` flag of its own (PR #1099's review, finding 5); that is also
  // why the documented restore procedure can name `qcms_migrate` without putting a
  // credential in the runbook, and why it says what to do when an operator has overridden
  // the default with `POSTGRES_INITDB_ARGS` (SEC-8).
  return ["psql", "--username", role, "--dbname", databaseName(), ...args];
}

/**
 * A drizzle handle on the migration credential's pool, which is what the subcommand runs
 * on.
 *
 * `drizzle(pool)` with no schema satisfies the `Executor` alias structurally but not
 * nominally, and nothing here reads a declared table through it. The same cast
 * `environment-cli.ts` and `migrate.ts` make, for the same reason - written once here
 * rather than at each call site.
 */
function migrateDb(): Parameters<typeof regrantEnvironments>[0] {
  return drizzle(migratePool) as unknown as Parameters<typeof regrantEnvironments>[0];
}

function databaseName(): string {
  return new URL(testDb.connectionUri).pathname.replace(/^\//, "");
}

/**
 * The complete effective privilege map, from the shared query.
 *
 * The whole map rather than the privileges a test expected, because the property is "the
 * re-grant cannot widen privilege" and a listing of what was expected cannot see a
 * privilege nobody expected.
 *
 * **Effective, not stored** - see `PRIVILEGE_MAP_SQL` for why that distinction cost a
 * drill run. No schema is excluded: this harness drops the QCMS schemas rather than the
 * database, so `public`'s owner never moves.
 */
async function grantMap(): Promise<string[]> {
  const result = await owner.query<{ line: string }>(PRIVILEGE_MAP_SQL, [[]]);
  return result.rows.map((row) => row.line);
}

/**
 * Every per-workspace reporting view, with whether it carries `security_barrier`.
 *
 * Task 067's review found that a plain view's own predicate is not a security boundary in
 * Postgres: a qual the consumer writes can be pushed below it and evaluated against the
 * rows the view was meant to hide, so each workspace view is created `WITH
 * (security_barrier = true)`. That option lives in `pg_class.reloptions`, which is part of
 * the view definition rather than a privilege - so it rides in the dump rather than being
 * re-granted, and this is the assertion that it really does (PR #1099's review).
 */
async function securityBarriers(): Promise<string[]> {
  const result = await owner.query<{ line: string }>(
    `select format('%s.%s barrier=%s', n.nspname, c.relname,
                   coalesce(array_to_string(c.reloptions, ','), 'none')) as line
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'v' and n.nspname like 'reporting\\_%'
        and c.relname = any($1)
      order by 1`,
    [WORKSPACES.flatMap((workspace) => [...workspaceReportingViewNames(workspace.slug)])],
  );
  return result.rows.map((row) => row.line);
}

/** Every schema and relation QCMS names, with its owner. */
async function ownershipMap(): Promise<string[]> {
  const result = await owner.query<{ row: string }>(
    `select format('schema %s %s', nspname, pg_get_userbyid(nspowner)) as row
       from pg_catalog.pg_namespace where nspname = any($1)
     union all
     select format('%s.%s %s', n.nspname, c.relname, pg_get_userbyid(c.relowner)) as row
       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'v', 'm', 'S')
      order by 1`,
    [[...QCMS_SCHEMAS]],
  );
  return result.rows.map((row) => row.row);
}

/** Every table privilege `role` holds in `schema`, as 03 reads them. */
async function tablePrivileges(
  schema: string,
  role: string,
): Promise<Record<string, readonly string[]>> {
  const res = await owner.query<{ table_name: string; privilege_type: string }>(
    `select table_name, privilege_type
       from information_schema.table_privileges
      where table_schema = $1 and grantee = $2
      order by table_name, privilege_type`,
    [schema, role],
  );
  const byTable: Record<string, string[]> = {};
  for (const row of res.rows) {
    const privileges = (byTable[row.table_name] ??= []);
    privileges.push(row.privilege_type);
  }
  return byTable;
}

async function hasSchemaUsage(schema: string, role: string): Promise<boolean> {
  const res = await owner.query<{ has: boolean }>(
    `select has_schema_privilege($1, $2, 'USAGE') as has`,
    [role, schema],
  );
  return res.rows[0]?.has ?? false;
}

/** The snapshots taken before the dump, which every assertion below is held against. */
let grantsBeforeDump: string[] = [];
let ownershipBeforeDump: string[] = [];
/** How many `GRANT`/`REVOKE` lines the dump carried, which the ruling expects to be zero. */
let grantLinesInDump = -1;
/** The grant map measured immediately after the restore and before the re-grant. */
let grantsAfterRestore: string[] = [];
/** The per-workspace views' `security_barrier` state before the dump. */
let barriersBeforeDump: string[] = [];

beforeAll(async () => {
  // UNMIGRATED: the recipe creates the roles and hands over the schemas before the first
  // migration, and the migration then runs as `qcms_migrate`. Migrating as the superuser
  // first would leave every object owned by the wrong role and quietly test nothing.
  testDb = await startTestDb({ migrate: false });
  owner = testDb.register(new pg.Client({ connectionString: testDb.connectionUri }), "owner");
  await owner.connect();

  for (const role of [
    MIGRATE_ROLE,
    CONTROL_ROLE,
    ...Object.values(ENVIRONMENT_ROLES),
    UNSHIPPED_ROLE,
    ...REPORTING_ROLES,
  ]) {
    const password = ephemeralPassword();
    passwords.set(role, password);
    await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  }
  await owner.query(`ALTER SCHEMA public OWNER TO ${MIGRATE_ROLE}`);
  await owner.query(
    `DO $$ BEGIN
       EXECUTE format('GRANT CREATE ON DATABASE %I TO ${MIGRATE_ROLE}', current_database());
     END $$`,
  );

  const migrator = testDb.register(
    new pg.Client({ connectionString: uriFor(MIGRATE_ROLE) }),
    "migrator",
  );
  await migrator.connect();
  await applyMigrations(migrator);
  await migrator.end();

  // The two workspaces and their reporting view sets, as an operator makes them: a
  // workspace row, then `qcms-db-environment reporting`, which is what
  // `reconcileWorkspaceReporting` is. Without this the database would be missing every
  // per-workspace view and the equality below would cover none of task 067's grants.
  for (const workspace of WORKSPACES) {
    await owner.query(
      `insert into control.organization (id, name, slug, "createdAt")
         values ($1, $1, $2, now())`,
      [workspace.id, workspace.slug],
    );
  }
  migratePool = testDb.register(
    new pg.Pool({ connectionString: uriFor(MIGRATE_ROLE) }),
    "migrate pool",
  );
  await reconcileWorkspaceReporting(migrateDb());

  grantsBeforeDump = await grantMap();
  ownershipBeforeDump = await ownershipMap();
  barriersBeforeDump = await securityBarriers();

  // 1. The dump, with the flags `docs/backup-restore.md` documents.
  await inContainer(
    [
      "sh",
      "-c",
      `pg_dump --username ${MIGRATE_ROLE} --dbname ${databaseName()} ` +
        `--clean --if-exists --no-owner --no-privileges > ${DUMP_PATH}`,
    ],
    "pg_dump",
  );
  const counted = await testDb.container.exec([
    "sh",
    "-c",
    `grep -c -E '^(GRANT|REVOKE)' ${DUMP_PATH} || true`,
  ]);
  grantLinesInDump = Number(counted.output.trim());

  // 2. Destroy. `dropdb` is not usable here - this container's single database is the one
  // under test and Testcontainers' connection URI names it - so every QCMS schema goes
  // instead, which is what the dump's own `DROP SCHEMA` statements would do over a
  // populated database and leaves nothing for the restore to hide behind.
  //
  // One thing that therefore does NOT happen here: `public` survives with the ACL and the
  // owner the recipe gave it, where the documented procedure recreates the database and
  // gets a `public` owned by `pg_database_owner`. That difference is exactly what
  // `UNREAPPLIABLE_SOURCES` is about, and `pnpm qcms:drill-restore` is what exercises it,
  // because it really does `dropdb` and `createdb`. The `public` assertion below is still
  // worth making - it is the property, whoever established it - and the drill makes the
  // same one against the real images.
  for (const schema of [...QCMS_SCHEMAS, "drizzle"]) {
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }

  // 3. Restore AS THE MIGRATION ROLE, which is the ruling: `--no-owner` lands ownership
  // on whoever runs the restore, and that has to be the role that owns the schemas.
  await inContainer(
    ["sh", "-c", psql(MIGRATE_ROLE, ["--set", "ON_ERROR_STOP=on", "--file", DUMP_PATH]).join(" ")],
    "psql restore",
  );
  grantsAfterRestore = await grantMap();

  // 4. The re-grant, on the migration credential, exactly as the subcommand runs it.
  await regrantEnvironments(migrateDb());

  for (const environment of ENVIRONMENTS) {
    const role = ENVIRONMENT_ROLES[environment];
    clients.set(role, await connectAs(role, `data_${environment},control`));
  }
  clients.set(CONTROL_ROLE, await connectAs(CONTROL_ROLE, "control"));
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the dump is role-free, and that is why a re-grant is needed", () => {
  it("carries no GRANT and no REVOKE, which is what `--no-privileges` is for", () => {
    // The ruling keeps `--no-privileges`, so this is the documented behaviour rather than
    // a defect - and it is the measured reason the step below has to exist.
    expect(grantLinesInDump).toBe(0);
  });

  it("left the application roles with no grant to speak of before the re-grant ran", () => {
    // The failure the issue reports, measured: the restore alone is not enough. Asserted
    // as a difference rather than as an empty map, because the owner's own implicit
    // privileges are reported by `information_schema` too.
    expect(grantsAfterRestore).not.toEqual(grantsBeforeDump);
    expect(grantsAfterRestore.length).toBeLessThan(grantsBeforeDump.length);
  });
});

describe("after the restore and the re-grant", () => {
  it("holds exactly the grant map a migrated database holds, row for row", async () => {
    // **The assertion the ruling asks for.** An equality, so a privilege the re-grant
    // widened appears here as an extra row and one it failed to restore appears as a
    // missing one. Every expectation in `03-db-least-privilege.e2e.ts` is a projection of
    // this map, so this line holds all of them at once.
    expect(await grantMap()).toEqual(grantsBeforeDump);
  });

  it("holds exactly the ownership map, so `control` is `qcms_migrate`'s again", async () => {
    expect(await ownershipMap()).toEqual(ownershipBeforeDump);
    for (const schema of QCMS_SCHEMAS) {
      expect(ownershipBeforeDump).toContain(`schema ${schema} ${MIGRATE_ROLE}`);
    }
  });

  it("gives every per-workspace reporting role exactly its own two views back", async () => {
    // Task 067's half of the model, which the dump drops like every other grant. The
    // claim is **exact**: this role holds `USAGE` on its own `reporting_<env>` and
    // `SELECT` on its own two views, and nothing on the other workspace's pair, on the
    // unfiltered environment-wide pair, or on any other environment's schema (Q26, Q52).
    for (const environment of ENVIRONMENTS) {
      for (const workspace of WORKSPACES) {
        const role = workspaceReportingRoleName(environment, workspace.slug);
        const own = [...workspaceReportingViewNames(workspace.slug)];
        const held = await tablePrivileges(`reporting_${environment}`, role);
        expect(Object.keys(held).sort(), role).toEqual([...own].sort());
        for (const [view, privileges] of Object.entries(held)) {
          expect([...privileges], `${role} on ${view}`).toEqual(["SELECT"]);
        }
        expect(await hasSchemaUsage(`reporting_${environment}`, role), role).toBe(true);

        const other = environment === "test" ? "prod" : "test";
        expect(await tablePrivileges(`reporting_${other}`, role), role).toEqual({});
        expect(await hasSchemaUsage(`reporting_${other}`, role), role).toBe(false);
        expect(await tablePrivileges(`data_${environment}`, role), role).toEqual({});
        expect(await tablePrivileges("control", role), role).toEqual({});
      }
    }
  });

  it("leaves the application role its own two views and not a workspace's (ADR-40, Q52)", async () => {
    // The over-reach the widened grant map caught. `grantEnvironmentStatements` grants
    // `SELECT ON ALL TABLES IN SCHEMA reporting_<env>`, which on a restored database
    // reaches the per-workspace views too, because they came back in the dump. The
    // narrowing source takes that back, and this is the assertion that it did.
    for (const environment of ENVIRONMENTS) {
      const role = ENVIRONMENT_ROLES[environment];
      const held = await tablePrivileges(`reporting_${environment}`, role);
      expect(Object.keys(held).sort(), role).toEqual(["answers_flat", "responses"]);
      for (const privileges of Object.values(held)) expect([...privileges]).toEqual(["SELECT"]);
    }
  });

  it("keeps `security_barrier` on every per-workspace view", async () => {
    // Not a privilege, so the re-grant is not what restores it: the option lives in the
    // view definition and rides in the dump. Asserted because a restore that brought the
    // views back **without** it would leave every workspace's analysts able to read the
    // other workspace's rows through their own view, which is the defect 067's review
    // found and the one thing in that model a grant cannot fix.
    const after = await securityBarriers();
    expect(after).toEqual(barriersBeforeDump);
    expect(after).toHaveLength(ENVIRONMENTS.length * WORKSPACES.length * 2);
    for (const line of after) expect(line, line).toContain("barrier=security_barrier=true");
  });

  it("passes the `ownsControlSchema` guard the environment command refuses on", async () => {
    // The second half of the defect. Before this fix the restore landed ownership on the
    // superuser, so the next `pnpm qcms:environment create ...` was refused and a later
    // migration as `qcms_migrate` would have failed on objects it did not own.
    const connected = await ownsControlSchema(migrateDb());
    expect(connected.role).toBe(MIGRATE_ROLE);
    expect(connected.owns).toBe(true);
  });

  it("changes nothing when the re-grant runs a second time", async () => {
    const after = await grantMap();
    await regrantEnvironments(migrateDb());
    expect(await grantMap()).toEqual(after);
    expect(await grantMap()).toEqual(grantsBeforeDump);
  });

  it("reports one pass per source, with every environment-scoped source expanded", async () => {
    const report = await regrantEnvironments(migrateDb());
    expect(report.environments).toEqual([...ENVIRONMENTS]);
    // Every source that is not installation-wide expands once per environment, whichever
    // kind it is - which is what makes this count a property of the list rather than of
    // the sources anybody remembered.
    const perEnvironment = GRANT_SOURCES.filter((source) => source.scope !== "installation").length;
    const installation = GRANT_SOURCES.length - perEnvironment;
    expect(report.passes).toHaveLength(installation + perEnvironment * ENVIRONMENTS.length);
    // Every pass carries statements, the two reporting ones included: the workspaces
    // seeded above are what make that true.
    for (const pass of report.passes) expect(pass.statements, pass.source).toBeGreaterThan(0);
    expect(report.publicCreateGrantedToPublic).toBe(false);
  });

  it("leaves `public` empty with `CREATE` on it granted to nobody (criterion 2)", async () => {
    // The one statement the re-grant cannot re-apply, so the property is asserted rather
    // than assumed: a `REVOKE` on a schema needs its owner, and a restored database owns
    // `public` as `pg_database_owner`. PostgreSQL 15 and later grant `PUBLIC` no `CREATE`
    // on a freshly created `public` at all, which is what makes the skip safe.
    const tables = await owner.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(tables.rows).toEqual([]);
    for (const role of [CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES)]) {
      const res = await owner.query<{ has: boolean }>(
        `select has_schema_privilege($1, 'public', 'CREATE') as has`,
        [role],
      );
      expect(res.rows[0]?.has, role).toBe(false);
    }
  });
});

describe("the projections of that map, named so a failure says which claim broke", () => {
  it("gives the control role DML on `control` with the two audits carved out", async () => {
    const held = await tablePrivileges("control", CONTROL_ROLE);
    expect(held["two_factor_resets"]).toBeUndefined();
    expect([...(held[ACCESS_AUDIT_TABLE] ?? [])].sort()).toEqual(["INSERT", "SELECT"]);
    for (const [table, privileges] of Object.entries(held)) {
      if (table === ACCESS_AUDIT_TABLE) continue;
      expect([...privileges].sort(), `control.${table}`).toEqual([...DML].sort());
    }
    expect(Object.keys(held).length).toBeGreaterThan(10);
  });

  it("brings task 070's table and column back, with nobody new on them", async () => {
    // The whole-map equality above covers the table's **grants**, and the two projections
    // around it cover both halves structurally - the control role's DML through the loop,
    // and the environment roles' absence through their exact key list. What neither covers
    // is a **column**: `form_versions.published_by` carries no privilege of its own, so a
    // restore that dropped it would leave every grant assertion in this file green and the
    // two-person rule unable to name an author. Hence one named case for both.
    const table = await owner.query<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'control' and c.relname = $1`,
      [ENDPOINT_PROPOSALS_TABLE],
    );
    expect(table.rows.map((row) => row.relname)).toEqual([ENDPOINT_PROPOSALS_TABLE]);

    // The guards came back too. A table restored without its CHECKs would accept a
    // self-confirmation, which is the one write this mechanism exists to refuse.
    const guards = await owner.query<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = ('control.' || $1)::regclass and contype = 'c' order by conname`,
      [ENDPOINT_PROPOSALS_TABLE],
    );
    expect(guards.rows.map((row) => row.conname)).toContain(
      "webhook_endpoint_proposals_second_account",
    );
    const index = await owner.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'control' and tablename = $1`,
      [ENDPOINT_PROPOSALS_TABLE],
    );
    expect(index.rows.map((row) => row.indexname)).toContain("webhook_endpoint_proposals_one_open");

    // The control role holds DML; no environment role holds anything at all.
    expect(
      [
        ...((await tablePrivileges("control", CONTROL_ROLE))[ENDPOINT_PROPOSALS_TABLE] ?? []),
      ].sort(),
    ).toEqual([...DML].sort());
    for (const environment of ENVIRONMENTS) {
      const held = await tablePrivileges("control", ENVIRONMENT_ROLES[environment]);
      expect(held[ENDPOINT_PROPOSALS_TABLE], `qcms_app_${environment}`).toBeUndefined();
    }

    // And the author column, which no grant map can see.
    const column = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'control' and table_name = 'form_versions' and column_name = 'published_by'`,
    );
    expect(column.rows.map((row) => row.column_name)).toEqual(["published_by"]);
  });

  it.each(ENVIRONMENTS)(
    "gives the control role INSERT on data_%s.outbox and nothing else there (Q49)",
    async (environment) => {
      expect(await tablePrivileges(`data_${environment}`, CONTROL_ROLE)).toEqual({
        outbox: ["INSERT"],
      });
      expect(await hasSchemaUsage(`data_${environment}`, CONTROL_ROLE)).toBe(true);
      expect(await hasSchemaUsage(`reporting_${environment}`, CONTROL_ROLE)).toBe(false);
    },
  );

  it.each(ENVIRONMENTS)("gives qcms_app_%s DML on its own data plane only", async (environment) => {
    const role = ENVIRONMENT_ROLES[environment];
    const other = environment === "test" ? "prod" : "test";
    const held = await tablePrivileges(`data_${environment}`, role);
    expect(Object.keys(held).length).toBe(DATA_PLANE_TABLE_NAMES.length);
    for (const [table, privileges] of Object.entries(held)) {
      expect([...privileges].sort(), `data_${environment}.${table}`).toEqual([...DML].sort());
    }
    expect(await tablePrivileges(`data_${other}`, role)).toEqual({});
    expect(await hasSchemaUsage(`data_${other}`, role)).toBe(false);
    expect(await hasSchemaUsage(`reporting_${other}`, role)).toBe(false);
  });

  it.each(ENVIRONMENTS)(
    "gives qcms_app_%s exactly the six-table read list, one UPDATE and one INSERT",
    async (environment) => {
      const held = await tablePrivileges("control", ENVIRONMENT_ROLES[environment]);
      expect(CONTROL_READ_TABLES).toHaveLength(6);
      expect(Object.keys(held).sort()).toEqual([...CONTROL_READ_TABLES, ACCESS_AUDIT_TABLE].sort());
      for (const table of CONTROL_READ_TABLES) {
        const expected = table === "secure_links" ? ["SELECT", "UPDATE"] : ["SELECT"];
        expect([...(held[table] ?? [])].sort(), `control.${table}`).toEqual(expected);
      }
      expect([...(held[ACCESS_AUDIT_TABLE] ?? [])]).toEqual(["INSERT"]);
    },
  );

  it.each(ENVIRONMENTS)(
    "gives qcms_app_%s SELECT on its own reporting views and no other environment's (Q52)",
    async (environment) => {
      const role = ENVIRONMENT_ROLES[environment];
      const own = await tablePrivileges(`reporting_${environment}`, role);
      expect(Object.keys(own).sort()).toEqual(["answers_flat", "responses"]);
      for (const privileges of Object.values(own)) expect([...privileges]).toEqual(["SELECT"]);
      expect(await hasSchemaUsage(`reporting_${environment}`, role)).toBe(true);
    },
  );

  it.each(CONTROL_FORBIDDEN_TABLES)(
    "gives no environment role any privilege on control.%s",
    async (table) => {
      for (const role of Object.values(ENVIRONMENT_ROLES)) {
        for (const privilege of DML) {
          const res = await owner.query<{ has: boolean }>(
            `select has_table_privilege($1, $2, $3) as has`,
            [role, `control."${table}"`, privilege],
          );
          expect(res.rows[0]?.has, `${role} on control.${table}`).toBe(false);
        }
      }
    },
  );

  it.each([CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES), UNSHIPPED_ROLE])(
    "leaves %s none of the four on control.two_factor_resets, including an unshipped name",
    async (role) => {
      // The prefix-shaped revoke, re-applied by the re-grant and executed against a name
      // no recipe mentions, exactly as 03 does it for the migrated database.
      for (const privilege of DML) {
        const res = await owner.query<{ has: boolean }>(
          `select has_table_privilege($1, 'control.two_factor_resets', $2) as has`,
          [role, privilege],
        );
        expect(res.rows[0]?.has, `${role} must not hold ${privilege}`).toBe(false);
      }
    },
  );

  it.each([CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES), UNSHIPPED_ROLE])(
    "leaves %s no UPDATE and no DELETE on control.access_audit",
    async (role) => {
      for (const privilege of ["UPDATE", "DELETE"]) {
        const res = await owner.query<{ has: boolean }>(
          `select has_table_privilege($1, 'control.access_audit', $2) as has`,
          [role, privilege],
        );
        expect(res.rows[0]?.has, `${role} must not hold ${privilege}`).toBe(false);
      }
    },
  );
});

describe("the product works on the restored database, which is what the grants are for", () => {
  it.each(ENVIRONMENTS)(
    "lets qcms_app_%s write the session row the first respondent request makes",
    async (environment) => {
      // The end-to-end shape of the write the issue reports as a 500: a form and a version
      // in `control`, a row in this environment's own `sessions` with both enum types and
      // the Q46 `environment` column. A grant missing anywhere in the chain surfaces here.
      const workspace = `org_restore_${environment}`;
      const formId = `frm_restore_${environment}`;
      await owner.query(
        `insert into control.organization (id, name, slug, "createdAt")
           values ($1, 'Restore drill', $2, now())`,
        [workspace, `restore-${environment}`],
      );
      await owner.query(
        `insert into control.forms (form_id, slug, workspace_id, default_locale)
           values ($1, $1, $2, 'en')`,
        [formId, workspace],
      );
      await owner.query(
        `insert into control.form_versions
           (form_id, version, definition, compiled, compiler_version,
            a2ui_spec_version, semantics_version)
         values ($1, 1, '{}'::jsonb, '{}'::jsonb, '0.0.0', '0.0.0', '0.0.0')`,
        [formId],
      );
      await clients.get(ENVIRONMENT_ROLES[environment])!.query(
        `insert into sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
         values ($1, $2, 1, 'anonymous', $3, now() + interval '1 day')`,
        [`ses_restore_${environment}`, formId, environment],
      );
      const written = await owner.query<{ environment: string }>(
        `select environment from data_${environment}.sessions where session_id = $1`,
        [`ses_restore_${environment}`],
      );
      expect(written.rows[0]?.environment).toBe(environment);
    },
  );

  it("still refuses the control role a read of an answer, which the split buys", async () => {
    const refusal = await clients
      .get(CONTROL_ROLE)!
      .query(`select * from data_prod.answers limit 1`)
      .then(
        () => undefined,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    expect(refusal).toMatch(/permission denied/i);
  });
});
