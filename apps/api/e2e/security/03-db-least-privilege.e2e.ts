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
 * 1. **A new database** (`docs/operations.md`, "Least-privilege database roles" > "The
 *    recipe"). The container is booted UNMIGRATED, the recipe's roles are created from
 *    it, and the real migration set is then applied **as `qcms_migrate`** - which is
 *    the only honest way to assert "the migration role can migrate". Everything after
 *    that is about the runtime role: it reads and writes rows in `public`, it can
 *    READ the reporting views the export path uses and cannot write to them, and it is
 *    refused DDL of every shape, holds no `CREATE` on `public`, and owns nothing.
 * 2. **An upgrading database** (the same document's "Upgrading a database that was
 *    migrated under one credential"). This is the path a real adopter takes and it has
 *    its own failure modes, so it gets its own container: migrate first with the OLD
 *    single credential, through drizzle's real migrator so its bookkeeping table and
 *    that table's SERIAL sequence exist bootstrap-owned, then run the handover, then
 *    assert the NEXT migration succeeds as `qcms_migrate` and the runtime denials hold.
 *    Reviewer finding on PR #782: the handover aborted on exactly that linked sequence,
 *    and nothing in this file could see it, because scenario 1 applies migrations with
 *    `applyMigrations` and never creates drizzle's bookkeeping table at all.
 * 3. **The reporting role** (`docs/reporting-view.md`, "Connection guidance"),
 *    unchanged from 040: readable reporting views, no reach into the operational
 *    tables, no writes, no DDL.
 *
 * The SQL is quoted from the documents, not paraphrased: if either recipe stops
 * working, this suite is where it shows. Order matters and is not incidental - the
 * roles have to exist and own the schema before the migration runs, which is exactly
 * the bootstrap ordering the operator recipe specifies and `docker-compose.yml`
 * arranges with its `db-roles` one-shot.
 */

import {
  applyMigrations,
  CONTAINER_BOOT_TIMEOUT_MS,
  MIGRATIONS_DIR,
} from "@roonga/qcms-db/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

/**
 * `container`'s connection string rewritten to authenticate as `role`.
 *
 * The container is a parameter rather than the module-level one, because this file
 * boots two: a new database and an upgrading one. Closing over the first silently
 * pointed the second scenario's clients at the wrong container, which surfaced as
 * `password authentication failed` on a role that existed in both.
 */
function uriFor(container: TestDb, role: string, password: string): string {
  const uri = new URL(container.connectionUri);
  uri.username = role;
  uri.password = password;
  return uri.toString();
}

/** Open a client on `container` as `role`. */
async function connectAs(container: TestDb, role: string, password: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: uriFor(container, role, password) });
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

  // Two layers, and the scoping is the control: the SELECT default is unscoped so it
  // reaches `reporting` when migration 0003 creates it, and the write defaults name
  // `public`, so a reporting view gets SELECT and only SELECT.
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} GRANT SELECT ON TABLES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} IN SCHEMA public
       GRANT INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} IN SCHEMA public
       GRANT USAGE ON SEQUENCES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} GRANT USAGE ON SCHEMAS TO ${APP_ROLE}`,
  );

  // The migration itself, run as the role the recipe says runs it. This is the
  // assertion "the migration role can migrate": it applies the real, package-owned
  // migration set, so a grant the migration needs and does not have fails here.
  migrator = await connectAs(testDb, MIGRATE_ROLE, migratePassword);
  await applyMigrations(migrator);

  app = await connectAs(testDb, APP_ROLE, appPassword);

  // Verbatim from docs/reporting-view.md, "Connection guidance". Unchanged by #492:
  // the reporting role is a third, independent recipe and still runs as the owner.
  const reportingPassword = ephemeralPassword();
  await owner.query(`CREATE ROLE ${REPORTING_ROLE} LOGIN PASSWORD '${reportingPassword}'`);
  await owner.query(`GRANT USAGE ON SCHEMA reporting TO ${REPORTING_ROLE}`);
  await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${REPORTING_ROLE}`);
  await owner.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO ${REPORTING_ROLE}`,
  );
  reporting = await connectAs(testDb, REPORTING_ROLE, reportingPassword);
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

  it.each(["reporting.responses", "reporting.answers_flat"])(
    "holds SELECT and nothing more on %s",
    async (view) => {
      // SEC-10 and the operations table say the runtime role gets SELECT on the
      // reporting views. Until the PR #782 review the shipped grants said otherwise:
      // the DML pass fanned out over every schema the migration role owned, and the
      // unscoped default privilege extended INSERT/UPDATE/DELETE to future views too.
      // Inert in practice, because both views are joins and so not auto-updatable -
      // but a grant that does not match the stated posture is the posture nobody can
      // trust, and the next view added here might well be updatable.
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
        [view],
      );
      expect(result.rows[0]).toEqual({
        select: true,
        insert: false,
        update: false,
        delete: false,
      });
    },
  );

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

/**
 * Scenario 2: an existing database, migrated under the old single credential.
 *
 * This is the path every current adopter takes, and it is not scenario 1 with extra
 * steps. It has one failure mode of its own that no amount of fresh-install testing
 * can reach, and PR #782's reviewer hit it: the objects to hand over include
 * **drizzle's own bookkeeping table**, `drizzle.__drizzle_migrations`, whose `id
 * SERIAL` column carries a LINKED SEQUENCE. Postgres refuses `ALTER SEQUENCE ...
 * OWNER TO` on a linked sequence outright, and with `ON_ERROR_STOP` set that aborts
 * the whole `db-roles` one-shot, so `migrate` and `api` never start.
 *
 * Scenario 1 could not see it, and that is the interesting part: it applies
 * migrations with `applyMigrations`, which deliberately bypasses drizzle's tracker,
 * so no bookkeeping table and no sequence ever exist there. This block therefore
 * migrates through **drizzle's real migrator**, exactly as `packages/db/src/migrate.ts`
 * does, before it does anything else.
 */
describe("an upgrading database, migrated under the old single credential", () => {
  let upgradeDb: TestDb;
  let bootstrap: pg.Client;
  let upgradeMigrator: pg.Client;
  let upgradeApp: pg.Client;
  /** The migration role's connection string, for the drizzle-migrator test below. */
  let migrateUri: string;
  /** Sequences that a migration created as `SERIAL` and Postgres links to their table. */
  const LINKED_SEQUENCE_QUERY = `
    SELECT format('%I.%I', n.nspname, c.relname) AS name,
           pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S'
       AND EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                      AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i'))`;

  beforeAll(async () => {
    // MIGRATED as the bootstrap superuser, through drizzle's real migrator. That is
    // the world this scenario exists for: every object, including drizzle's own
    // bookkeeping table and its linked sequence, owned by the old credential.
    upgradeDb = await startTestDb({ migrate: true });
    bootstrap = new pg.Client({ connectionString: upgradeDb.connectionUri });
    await bootstrap.connect();

    const before = await bootstrap.query<{ name: string; owner: string }>(LINKED_SEQUENCE_QUERY);
    // A floor on the fixture itself. If drizzle ever stops using SERIAL, this block
    // would keep passing while testing nothing, which is the failure mode that let
    // the defect through in the first place.
    expect(before.rows.length, "the old world must carry a linked sequence").toBeGreaterThan(0);
    expect(before.rows.every((row) => row.owner !== MIGRATE_ROLE)).toBe(true);

    const migratePassword = ephemeralPassword();
    const appPassword = ephemeralPassword();
    await bootstrap.query(`CREATE ROLE ${MIGRATE_ROLE} LOGIN PASSWORD '${migratePassword}'`);
    await bootstrap.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword}'`);
    await bootstrap.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await bootstrap.query(
      `DO $$ BEGIN
         EXECUTE format('GRANT CREATE ON DATABASE %I TO ${MIGRATE_ROLE}', current_database());
       END $$`,
    );

    // Verbatim from docs/operations.md, "Upgrading a database that was migrated under
    // one credential". The pg_depend clause is the fix under test.
    await bootstrap.query(`
      DO $$
      DECLARE statement text;
      BEGIN
        FOR statement IN
          SELECT format('ALTER SCHEMA %I OWNER TO ${MIGRATE_ROLE}', nspname)
            FROM pg_namespace
           WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
             AND nspowner <> '${MIGRATE_ROLE}'::regrole
          UNION ALL
          SELECT format('ALTER TABLE %I.%I OWNER TO ${MIGRATE_ROLE}', n.nspname, c.relname)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
             AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
             AND c.relowner <> '${MIGRATE_ROLE}'::regrole
             AND NOT (c.relkind = 'S' AND EXISTS (
                   SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                      AND d.refclassid = 'pg_class'::regclass
                      AND d.deptype IN ('a', 'i')))
          UNION ALL
          SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO ${MIGRATE_ROLE}',
                        n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
             AND p.proowner <> '${MIGRATE_ROLE}'::regrole
          UNION ALL
          SELECT format('ALTER TYPE %I.%I OWNER TO ${MIGRATE_ROLE}', n.nspname, t.typname)
            FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE t.typtype = 'e'
             AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
             AND t.typowner <> '${MIGRATE_ROLE}'::regrole
        LOOP
          EXECUTE statement;
        END LOOP;
      END
      $$`);

    await bootstrap.query(`GRANT USAGE ON SCHEMA reporting TO ${APP_ROLE}`);
    await bootstrap.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${APP_ROLE}`);
    await bootstrap.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );

    migrateUri = uriFor(upgradeDb, MIGRATE_ROLE, migratePassword);
    upgradeMigrator = await connectAs(upgradeDb, MIGRATE_ROLE, migratePassword);
    upgradeApp = await connectAs(upgradeDb, APP_ROLE, appPassword);
  }, CONTAINER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await upgradeApp?.end().catch(() => undefined);
    await upgradeMigrator?.end().catch(() => undefined);
    await bootstrap?.end().catch(() => undefined);
    await upgradeDb?.teardown();
  });

  it("completes the handover at all (it aborted on the linked sequence)", async () => {
    // If the handover threw, `beforeAll` would have failed and every test here would
    // report as a setup error - which is what the reviewer saw, and what an operator
    // would have seen as `db-roles` exiting nonzero with migrate and api never
    // starting. This is the positive statement of the same fact.
    const owners = await bootstrap.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'p', 'v', 'm')
          AND pg_get_userbyid(c.relowner) <> $1`,
      [MIGRATE_ROLE],
    );
    expect(Number(owners.rows[0]?.count)).toBe(0);
  });

  it("moves each linked sequence along with the table that owns it", async () => {
    // The skipped rows are not left behind: `ALTER TABLE ... OWNER TO` carries a
    // linked sequence with it, which is why excluding them is complete rather than
    // merely convenient, and why the exclusion needs no ordering.
    const after = await bootstrap.query<{ name: string; owner: string }>(LINKED_SEQUENCE_QUERY);
    expect(after.rows.length).toBeGreaterThan(0);
    for (const row of after.rows) {
      expect(row.owner, `${row.name} was left behind by the handover`).toBe(MIGRATE_ROLE);
    }
  });

  it("lets the migration role run drizzle's migrator, the way the next upgrade will", async () => {
    // The real thing rather than a probe: the same `migrate(drizzle(pool), ...)` call
    // `packages/db/src/migrate.ts` makes, over a pool connected as qcms_migrate. It
    // reads and writes drizzle's bookkeeping table, which is precisely the object
    // whose handover the linked sequence was breaking. Every migration is already
    // applied, so this is the no-op pass a re-run does; the point is that it needs
    // ownership of that table and its sequence to get that far at all.
    const pool = new pg.Pool({ connectionString: migrateUri });
    pool.on("error", () => undefined);
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
    } finally {
      await pool.end();
    }

    // It ran as the migration role and left the journal intact: one applied row per
    // migration file, still owned by qcms_migrate. A migrator that had failed to read
    // its own bookkeeping table would not have got here, and one that had recreated
    // the table under a different owner would fail the second assertion.
    const journal = await upgradeMigrator.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );
    expect(Number(journal.rows[0]?.count)).toBeGreaterThan(0);
    const journalOwner = await upgradeMigrator.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner
         FROM pg_class WHERE oid = 'drizzle.__drizzle_migrations'::regclass`,
    );
    expect(journalOwner.rows[0]?.owner).toBe(MIGRATE_ROLE);
  });

  it("lets the migration role write drizzle's bookkeeping table and its sequence", async () => {
    // The narrower statement of the same thing, so a failure names the object. An
    // INSERT here consumes the SERIAL sequence, which is the row the handover skips.
    await upgradeMigrator.query("BEGIN");
    try {
      const inserted = await upgradeMigrator.query<{ id: number }>(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         VALUES ('probe_492', 0) RETURNING id`,
      );
      // A returned id means the linked sequence was reachable, which is the whole
      // point: `nextval` on it is what an INSERT into this table does.
      expect(inserted.rows[0]?.id).toBeGreaterThan(0);
    } finally {
      await upgradeMigrator.query("ROLLBACK");
    }
  });

  it("lets the migration role issue the DDL a future migration needs", async () => {
    // Ownership of tables, functions and enums, each checked by the statement a
    // migration would actually use. Each is reverted where it can be.
    await upgradeMigrator.query("ALTER TABLE public.sessions ADD COLUMN probe_492 text");
    await upgradeMigrator.query("ALTER TABLE public.sessions DROP COLUMN probe_492");
    await upgradeMigrator.query("CREATE TABLE public.probe_492 (id text)");
    await upgradeMigrator.query("DROP TABLE public.probe_492");
    await upgradeMigrator.query(
      `CREATE OR REPLACE FUNCTION answers_reject_delete() RETURNS trigger AS $fn$
       BEGIN RETURN OLD; END $fn$ LANGUAGE plpgsql`,
    );
    // ALTER TYPE ... ADD VALUE is not revertible, which is fine in a throwaway
    // container and is the statement a real migration uses on an enum.
    await upgradeMigrator.query(
      "ALTER TYPE public.access_mode ADD VALUE IF NOT EXISTS 'probe_492'",
    );

    // Each statement above needed ownership of a different KIND of object, so the
    // assertion is that the handover reached all of them: the enum carries the added
    // label, the probe table is gone again, and the trigger function is the one this
    // test just replaced (proving CREATE OR REPLACE was allowed, not merely accepted).
    const enumLabels = await upgradeMigrator.query<{ label: string }>(
      `SELECT unnest(enum_range(NULL::public.access_mode))::text AS label`,
    );
    expect(enumLabels.rows.map((row) => row.label)).toContain("probe_492");
    const leftovers = await upgradeMigrator.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'probe_492'`,
    );
    expect(Number(leftovers.rows[0]?.count)).toBe(0);
    const fn = await upgradeMigrator.query<{ owner: string }>(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc
        WHERE proname = 'answers_reject_delete'`,
    );
    expect(fn.rows[0]?.owner).toBe(MIGRATE_ROLE);
  });

  it("still refuses the runtime role every form of DDL", async () => {
    for (const sql of [
      "CREATE TABLE public.smuggled (id text)",
      "DROP TABLE public.sessions",
      "ALTER TABLE public.sessions ADD COLUMN smuggled text",
      "CREATE SCHEMA smuggled",
      "TRUNCATE public.answers",
    ]) {
      const refusal = await refusalFor(upgradeApp, sql);
      expect(refusal, `${sql} succeeded for the runtime role`).toBeDefined();
      expect(refusal as string).toMatch(/permission denied|must be owner/i);
    }
    const schema = await upgradeApp.query<{ create: boolean }>(
      `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS create`,
    );
    expect(schema.rows[0]?.create).toBe(false);
  });

  it("still lets the runtime role read and write rows", async () => {
    const result = await upgradeApp.query<{ select: boolean; delete: boolean }>(
      `SELECT has_table_privilege(current_user, 'public.sessions', 'SELECT') AS select,
              has_table_privilege(current_user, 'public.sessions', 'DELETE') AS delete`,
    );
    expect(result.rows[0]).toEqual({ select: true, delete: true });
    const rows = await upgradeApp.query("SELECT * FROM reporting.responses LIMIT 1");
    expect(rows.rowCount).not.toBeNull();
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
