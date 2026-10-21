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
 * 03 is left untouched on purpose: it owns the claim about a **migrated** database, and
 * task 067 (PR #1093) is editing it.
 *
 * ## Why `container.exec` rather than a simulated dump
 *
 * The defect **is** what `pg_dump` leaves out, so a dump simulated over a connection
 * would prove nothing. `pg_dump` and `psql` are the server's own binaries, so the suite
 * reaches them through the container (`StartedTestPostgres.exec`, widened for this file).
 */

import { applyMigrations, CONTAINER_BOOT_TIMEOUT_MS } from "@roonga/qcms-db/testing";
import {
  ACCESS_AUDIT_TABLE,
  CONTROL_FORBIDDEN_TABLES,
  CONTROL_READ_TABLES,
  DATA_PLANE_TABLE_NAMES,
  GRANT_SOURCES,
  ownsControlSchema,
  regrantEnvironments,
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
  // The local socket, where the official image's `initdb --auth-local=trust` means no
  // password is needed and none is passed - which is also why the documented restore
  // procedure can name `qcms_migrate` without putting a credential in the runbook (SEC-8).
  return ["psql", "--username", role, "--dbname", databaseName(), ...args];
}

function databaseName(): string {
  return new URL(testDb.connectionUri).pathname.replace(/^\//, "");
}

/**
 * The complete grant map: every privilege every `qcms%` role holds on every relation in
 * every schema, plus schema `USAGE` and `CREATE`.
 *
 * The whole map rather than the privileges a test expected, because the property is "the
 * re-grant cannot widen privilege" and a listing of what was expected cannot see a
 * privilege nobody expected.
 */
async function grantMap(): Promise<string[]> {
  const tables = await owner.query<{ row: string }>(
    `select format('%s.%s %s %s', table_schema, table_name, grantee, privilege_type) as row
       from information_schema.table_privileges
      where grantee like 'qcms%'
      order by 1`,
  );
  const schemas = await owner.query<{ row: string }>(
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

  grantsBeforeDump = await grantMap();
  ownershipBeforeDump = await ownershipMap();

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
  migratePool = testDb.register(
    new pg.Pool({ connectionString: uriFor(MIGRATE_ROLE) }),
    "migrate pool",
  );
  const migrateDb = drizzle(migratePool) as unknown as Parameters<typeof regrantEnvironments>[0];
  await regrantEnvironments(migrateDb);

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

  it("passes the `ownsControlSchema` guard the environment command refuses on", async () => {
    // The second half of the defect. Before this fix the restore landed ownership on the
    // superuser, so the next `pnpm qcms:environment create ...` was refused and a later
    // migration as `qcms_migrate` would have failed on objects it did not own.
    const connected = await ownsControlSchema(
      drizzle(migratePool) as unknown as Parameters<typeof ownsControlSchema>[0],
    );
    expect(connected.role).toBe(MIGRATE_ROLE);
    expect(connected.owns).toBe(true);
  });

  it("changes nothing when the re-grant runs a second time", async () => {
    const after = await grantMap();
    await regrantEnvironments(
      drizzle(migratePool) as unknown as Parameters<typeof regrantEnvironments>[0],
    );
    expect(await grantMap()).toEqual(after);
    expect(await grantMap()).toEqual(grantsBeforeDump);
  });

  it("reports one pass per source, with every environment-scoped source expanded", async () => {
    const report = await regrantEnvironments(
      drizzle(migratePool) as unknown as Parameters<typeof regrantEnvironments>[0],
    );
    expect(report.environments).toEqual([...ENVIRONMENTS]);
    const perEnvironment = GRANT_SOURCES.filter((source) => source.scope === "environment").length;
    const installation = GRANT_SOURCES.length - perEnvironment;
    expect(report.passes).toHaveLength(installation + perEnvironment * ENVIRONMENTS.length);
    // Task 067's per-workspace reporting grants arrive as one more environment-scoped
    // source, and this count follows them with no edit here.
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
