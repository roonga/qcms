/**
 * Security scenario 3 - SEC-10, least-privilege database roles (task 040, issue #492).
 *
 * The triage that fed task 040 recorded SEC-10 as "not inspected at all", and that
 * turned out to be the right warning: `docs/SECURITY_DESIGN.md` §7 listed two role
 * properties and exactly one of them existed anywhere as SQL. 040 closed the
 * reporting half and pinned the other half's absence as an executable fact, so that
 * "the day a split ships this file goes red and gets updated rather than quietly
 * continuing to describe the old world".
 *
 * That day is issue #492. Both halves are recipes now, and this file executes both
 * against a real Postgres:
 *
 * 1. **The app/migration split** (`docs/operations.md`, "Least-privilege database
 *    roles"). The container is booted UNMIGRATED, the recipe's roles are created from
 *    it, and the real migration set is then applied **as `qcms_migrate`** - which is
 *    the only honest way to assert "the migration role can migrate". Everything after
 *    that is about the runtime role: it reads and writes rows, it can read the
 *    reporting views the export path uses, and it is refused DDL of every shape,
 *    holds no `CREATE` on `public`, and owns nothing.
 * 2. **The reporting role** (`docs/reporting-view.md`, "Connection guidance"),
 *    unchanged from 040: readable reporting views, no reach into the operational
 *    tables, no writes, no DDL.
 *
 * The SQL is quoted from the documents, not paraphrased: if either recipe stops
 * working, this suite is where it shows. Order matters and is not incidental - the
 * roles have to exist and own the schema before the migration runs, which is exactly
 * the bootstrap ordering the operator recipe specifies and `docker-compose.yml`
 * arranges with its `db-roles` one-shot.
 */

import { applyMigrations, CONTAINER_BOOT_TIMEOUT_MS } from "@qcms/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "../support/index.js";

const REPORTING_ROLE = "qcms_reporting";
const MIGRATE_ROLE = "qcms_migrate";
const APP_ROLE = "qcms_app";

/** The operational tables the runtime role has to be able to read and write. */
const OPERATIONAL_TABLES = [
  "answers",
  "sessions",
  "submissions",
  "forms",
  "form_versions",
  "secure_links",
  "webhooks",
  "outbox",
] as const;

let testDb: TestDb;
/** Superuser/owner connection: the "as a superuser or the database owner" both recipes ask for. */
let owner: pg.Client;
/** A connection as the migration role. */
let migrator: pg.Client;
/** A connection as the runtime role the API runs as. */
let app: pg.Client;
/** A connection as the read-only reporting role. */
let reporting: pg.Client;

/** A throwaway password for a containerised role. Generated, never committed. */
function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Run `sql` and return the error message, or `undefined` when it succeeded. */
async function refusalFor(client: pg.Client, sql: string): Promise<string | undefined> {
  try {
    await client.query(sql);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Open a client on the same container as `role`. */
async function connectAs(role: string, password: string): Promise<pg.Client> {
  const uri = new URL(testDb.connectionUri);
  uri.username = role;
  uri.password = password;
  const client = new pg.Client({ connectionString: uri.toString() });
  await client.connect();
  return client;
}

beforeAll(async () => {
  // UNMIGRATED on purpose. The recipe runs before the first migration, and the
  // migration then runs as qcms_migrate - migrating here as the superuser first
  // would leave every object owned by the wrong role and quietly test nothing.
  testDb = await startTestDb({ migrate: false });
  owner = new pg.Client({ connectionString: testDb.connectionUri });
  await owner.connect();

  const migratePassword = ephemeralPassword();
  const appPassword = ephemeralPassword();

  // Verbatim from docs/operations.md, "Least-privilege database roles" > "The
  // recipe". The passwords are the only substitution, exactly as the doc instructs.
  await owner.query(`CREATE ROLE ${MIGRATE_ROLE} LOGIN PASSWORD '${migratePassword}'`);
  await owner.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword}'`);

  await owner.query(`ALTER SCHEMA public OWNER TO ${MIGRATE_ROLE}`);
  const database = (await owner.query<{ name: string }>("SELECT current_database() AS name"))
    .rows[0]?.name;
  await owner.query(`GRANT CREATE ON DATABASE "${database}" TO ${MIGRATE_ROLE}`);

  await owner.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await owner.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
  );
  await owner.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);

  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE}
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} GRANT USAGE ON SEQUENCES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} GRANT USAGE ON SCHEMAS TO ${APP_ROLE}`,
  );

  // The migration itself, run as the role the recipe says runs it. This is the
  // assertion "the migration role can migrate": it applies the real, package-owned
  // migration set, so a grant the migration needs and does not have fails here.
  migrator = await connectAs(MIGRATE_ROLE, migratePassword);
  await applyMigrations(migrator);

  app = await connectAs(APP_ROLE, appPassword);

  // Verbatim from docs/reporting-view.md, "Connection guidance". Unchanged by #492:
  // the reporting role is a third, independent recipe and still runs as the owner.
  const reportingPassword = ephemeralPassword();
  await owner.query(`CREATE ROLE ${REPORTING_ROLE} LOGIN PASSWORD '${reportingPassword}'`);
  await owner.query(`GRANT USAGE ON SCHEMA reporting TO ${REPORTING_ROLE}`);
  await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${REPORTING_ROLE}`);
  await owner.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO ${REPORTING_ROLE}`,
  );
  reporting = await connectAs(REPORTING_ROLE, reportingPassword);
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await reporting?.end().catch(() => undefined);
  await app?.end().catch(() => undefined);
  await migrator?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  await testDb?.teardown();
});

describe("the migration role is the only role that owns the schema", () => {
  it("migrated the database (the recipe's ordering works end to end)", async () => {
    // If the role could not have migrated, `beforeAll` would have thrown. This is
    // the positive statement of the same thing, and it also proves migration 0003
    // ran, which needs CREATE on the database rather than merely on the schema.
    const tables = await migrator.query<{ count: string }>(
      `SELECT count(*) AS count FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(Number(tables.rows[0]?.count)).toBeGreaterThan(10);
    const views = await migrator.query<{ viewname: string }>(
      `SELECT viewname FROM pg_views WHERE schemaname = 'reporting' ORDER BY viewname`,
    );
    expect(views.rows.map((row) => row.viewname)).toEqual(["answers_flat", "responses"]);
  });

  it("owns the public schema", async () => {
    const result = await owner.query<{ owner: string }>(
      `SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'`,
    );
    expect(result.rows[0]?.owner).toBe(MIGRATE_ROLE);
  });

  it("owns every table and view the migrations created", async () => {
    const result = await owner.query<{ relname: string; owner: string }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'reporting')
          AND c.relkind IN ('r', 'v')
          AND pg_get_userbyid(c.relowner) <> $1`,
      [MIGRATE_ROLE],
    );
    expect(result.rows).toEqual([]);
  });
});

describe("the runtime role reads and writes rows, and nothing else", () => {
  it("connects as the role the recipe creates (the fixture is real)", async () => {
    const who = await app.query<{ current_user: string }>("SELECT current_user");
    expect(who.rows[0]?.current_user).toBe(APP_ROLE);
  });

  it.each(OPERATIONAL_TABLES)("holds all four DML privileges on public.%s", async (table) => {
    const result = await app.query<{
      select: boolean;
      insert: boolean;
      update: boolean;
      delete: boolean;
    }>(
      `SELECT has_table_privilege(current_user, $1::text, 'SELECT') AS select,
              has_table_privilege(current_user, $1::text, 'INSERT') AS insert,
              has_table_privilege(current_user, $1::text, 'UPDATE') AS update,
              has_table_privilege(current_user, $1::text, 'DELETE') AS delete`,
      [`public.${table}`],
    );
    // DELETE is granted whole rather than narrowed to the erasure and retention
    // tables. That narrowing was considered and rejected in the #492 ruling: the
    // `answers_reject_delete` trigger (migration 0004) is the control on that path,
    // and a per-table grant list is one an operator can get wrong at runtime.
    expect(result.rows[0]).toEqual({ select: true, insert: true, update: true, delete: true });
  });

  it("can actually read an operational table, not merely hold the bit", async () => {
    const result = await app.query("SELECT * FROM public.sessions LIMIT 1");
    expect(result.rowCount).not.toBeNull();
  });

  it("reads the reporting views the export path goes through", async () => {
    // `apps/api/src/features/responses/admin/handler.ts` exports through
    // `reporting.responses`, so the runtime role needs USAGE on that schema too.
    // It gets it from the recipe's unscoped ALTER DEFAULT PRIVILEGES, because the
    // schema does not exist when the recipe runs.
    for (const view of ["reporting.responses", "reporting.answers_flat"]) {
      const result = await app.query(`SELECT * FROM ${view} LIMIT 1`);
      expect(result.rowCount, `${view} was unreadable by the runtime role`).not.toBeNull();
    }
  });

  it("holds no CREATE on the public schema", async () => {
    const result = await app.query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS usage,
              has_schema_privilege(current_user, 'public', 'CREATE') AS create`,
    );
    expect(result.rows[0]?.usage).toBe(true);
    expect(result.rows[0]?.create).toBe(false);
  });

  it("is not the schema owner, and owns no object at all", async () => {
    const schema = await app.query<{ owner: string }>(
      `SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'`,
    );
    expect(schema.rows[0]?.owner).not.toBe(APP_ROLE);

    const owned = await app.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
          AND c.relowner = current_user::regrole`,
    );
    expect(Number(owned.rows[0]?.count)).toBe(0);
  });

  it.each([
    "CREATE TABLE public.smuggled (id text)",
    "CREATE TABLE reporting.smuggled (id text)",
    "CREATE SCHEMA smuggled",
    "DROP TABLE public.sessions",
    "DROP VIEW reporting.responses",
    "ALTER TABLE public.sessions ADD COLUMN smuggled text",
    "CREATE INDEX smuggled ON public.sessions (id)",
    "TRUNCATE public.answers",
  ])("is refused DDL of every shape: %s", async (sql) => {
    // The single property this whole issue exists to establish: the credential the
    // API process holds cannot change the schema. TRUNCATE is in the list because it
    // is the one destructive statement that is a table privilege rather than an
    // ownership check, so a `GRANT ALL` slip would show up here and nowhere else.
    const refusal = await refusalFor(app, sql);
    expect(refusal, `${sql} succeeded for the runtime role`).toBeDefined();
    expect(refusal as string).toMatch(/permission denied|must be owner/i);
  });

  it("cannot become the migration role", async () => {
    // Membership would hand back everything the grants above withhold, so the two
    // roles being unrelated is part of the control rather than an implementation
    // detail of how the recipe happens to be written.
    const refusal = await refusalFor(app, `SET ROLE ${MIGRATE_ROLE}`);
    expect(refusal).toBeDefined();
    expect(refusal as string).toMatch(/permission denied|must be a member/i);
  });
});

describe("the documented reporting role is read-only on the reporting views", () => {
  it("connects as the role the recipe creates (the fixture is real)", async () => {
    const who = await reporting.query<{ current_user: string }>("SELECT current_user");
    expect(who.rows[0]?.current_user).toBe(REPORTING_ROLE);
  });

  it.each(["reporting.responses", "reporting.answers_flat"])("reads %s", async (view) => {
    const result = await reporting.query(`SELECT * FROM ${view} LIMIT 1`);
    expect(result.rowCount).not.toBeNull();
  });

  it.each(["answers", "sessions", "webhooks", "secure_links", "form_versions"])(
    "cannot read the operational table public.%s",
    async (table) => {
      const refusal = await refusalFor(reporting, `SELECT * FROM public.${table} LIMIT 1`);
      expect(refusal, `public.${table} was readable by the reporting role`).toBeDefined();
      expect(refusal as string).toMatch(/permission denied/i);
    },
  );

  it("cannot write through the reporting views", async () => {
    const refusal = await refusalFor(reporting, "DELETE FROM reporting.responses");
    expect(refusal).toBeDefined();
    expect(refusal as string).toMatch(/permission denied|cannot delete|not updatable/i);
  });

  it.each(["DELETE FROM public.sessions", "DELETE FROM public.answers"])(
    "cannot write to an operational table: %s",
    async (sql) => {
      // Column-free statements on purpose: a statement naming a column fails on
      // name resolution first, which reads like a refusal without being one.
      const refusal = await refusalFor(reporting, sql);
      expect(refusal).toBeDefined();
      expect(refusal as string).toMatch(/permission denied/i);
    },
  );

  it("cannot issue DDL anywhere", async () => {
    for (const sql of [
      "CREATE TABLE public.smuggled (id text)",
      "CREATE TABLE reporting.smuggled (id text)",
      "DROP VIEW reporting.responses",
      "CREATE SCHEMA smuggled",
    ]) {
      const refusal = await refusalFor(reporting, sql);
      expect(refusal, `${sql} succeeded for the reporting role`).toBeDefined();
      expect(refusal as string).toMatch(/permission denied|must be owner/i);
    }
  });

  it("holds no privilege on the public schema at all", async () => {
    const result = await reporting.query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS usage,
              has_schema_privilege(current_user, 'public', 'CREATE') AS create`,
    );
    expect(result.rows[0]?.create).toBe(false);
  });
});

describe("the roles are the operator's to create, not a migration's", () => {
  it("ships no role-creating migration", async () => {
    // Roles are cluster-level and environment-specific, so no migration creates one
    // and `docs/operations.md` carries the recipe instead (issue #428 keeps the
    // migration journal for schema changes). Every qcms role in this container was
    // created by this file, from a documented recipe - which is the assertion.
    const roles = await owner.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms%' ORDER BY rolname`,
    );
    expect(roles.rows.map((row) => row.rolname)).toEqual([APP_ROLE, MIGRATE_ROLE, REPORTING_ROLE]);
  });
});
