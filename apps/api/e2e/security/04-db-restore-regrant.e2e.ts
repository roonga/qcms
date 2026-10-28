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

/** Two, because a grant that reached both workspaces' views would look correct against one. */
const WORKSPACES: readonly { readonly id: string; readonly slug: string }[] = [
  { id: "org_restore_home", slug: "home" },
  { id: "org_restore_vehicle", slug: "vehicle" },
];

const REPORTING_ROLES = ENVIRONMENTS.flatMap((environment) =>
  WORKSPACES.map((workspace) => workspaceReportingRoleName(environment, workspace.slug)),
);
const QCMS_SCHEMAS = [
  "control",
  "data_test",
  "data_prod",
  "reporting_test",
  "reporting_prod",
] as const;
const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

/** Not `/tmp`: the `postgres` user's own directory in a container this test alone owns. */
const DUMP_PATH = "/var/lib/postgresql/qcms-restore-regrant.sql";

let testDb: TestDb;
let owner: pg.Client;
let migratePool: pg.Pool;
const passwords = new Map<string, string>();
const clients = new Map<string, pg.Client>();

/** Generated per run, never committed. */
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

async function inContainer(command: string[], what: string): Promise<string> {
  const result = await testDb.container.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(`${what} exited ${String(result.exitCode)}:\n${result.output}`);
  }
  return result.output;
}

function psql(role: string, args: string[]): string[] {
  // On the local socket the official image keeps initdb's `local all all trust`, so no
  // password is needed and none is passed (SEC-8).
  return ["psql", "--username", role, "--dbname", databaseName(), ...args];
}

/**
 * Cast: `drizzle(pool)` with no schema satisfies the `Executor` alias structurally but
 * not nominally, and nothing here reads a declared table through it.
 */
function migrateDb(): Parameters<typeof regrantEnvironments>[0] {
  return drizzle(migratePool) as unknown as Parameters<typeof regrantEnvironments>[0];
}

function databaseName(): string {
  return new URL(testDb.connectionUri).pathname.replace(/^\//, "");
}

/**
 * The whole map rather than the privileges a test expected, because a listing of what was
 * expected cannot see a privilege nobody expected.
 */
async function grantMap(): Promise<string[]> {
  const result = await owner.query<{ line: string }>(PRIVILEGE_MAP_SQL, [[]]);
  return result.rows.map((row) => row.line);
}

/**
 * A plain view's own predicate is not a security boundary in Postgres - a consumer's qual
 * can be pushed below it - so each workspace view carries `security_barrier`.
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

let grantsBeforeDump: string[] = [];
let ownershipBeforeDump: string[] = [];
let grantLinesInDump = -1;
let grantsAfterRestore: string[] = [];
let barriersBeforeDump: string[] = [];

beforeAll(async () => {
  // Unmigrated: migrating as the superuser first would leave every object owned by the
  // wrong role and quietly test nothing.
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

  // `dropdb` is unusable here (the container's one database is under test), so every QCMS
  // schema is dropped instead; `public` keeps its ACL, which `pnpm qcms:drill-restore` covers.
  for (const schema of [...QCMS_SCHEMAS, "drizzle"]) {
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }

  // `--no-owner` lands ownership on whoever runs the restore, which has to be the role
  // that owns the schemas.
  await inContainer(
    ["sh", "-c", psql(MIGRATE_ROLE, ["--set", "ON_ERROR_STOP=on", "--file", DUMP_PATH]).join(" ")],
    "psql restore",
  );
  grantsAfterRestore = await grantMap();

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
    expect(grantLinesInDump).toBe(0);
  });

  it("left the application roles with no grant to speak of before the re-grant ran", () => {
    // A difference rather than an empty map, because the owner's own implicit privileges
    // are reported by `information_schema` too.
    expect(grantsAfterRestore).not.toEqual(grantsBeforeDump);
    expect(grantsAfterRestore.length).toBeLessThan(grantsBeforeDump.length);
  });
});

describe("after the restore and the re-grant", () => {
  it("holds exactly the grant map a migrated database holds, row for row", async () => {
    expect(await grantMap()).toEqual(grantsBeforeDump);
  });

  it("holds exactly the ownership map, so `control` is `qcms_migrate`'s again", async () => {
    expect(await ownershipMap()).toEqual(ownershipBeforeDump);
    for (const schema of QCMS_SCHEMAS) {
      expect(ownershipBeforeDump).toContain(`schema ${schema} ${MIGRATE_ROLE}`);
    }
  });

  it("gives every per-workspace reporting role exactly its own two views back", async () => {
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
    // `grantEnvironmentStatements` grants `SELECT ON ALL TABLES IN SCHEMA
    // reporting_<env>`, which on a restored database reaches the per-workspace views too,
    // because they came back in the dump; a narrowing source takes that back.
    for (const environment of ENVIRONMENTS) {
      const role = ENVIRONMENT_ROLES[environment];
      const held = await tablePrivileges(`reporting_${environment}`, role);
      expect(Object.keys(held).sort(), role).toEqual(["answers_flat", "responses"]);
      for (const privileges of Object.values(held)) expect([...privileges]).toEqual(["SELECT"]);
    }
  });

  it("keeps `security_barrier` on every per-workspace view", async () => {
    // Not a privilege: the option lives in the view definition and rides in the dump, so
    // the re-grant is not what restores it.
    const after = await securityBarriers();
    expect(after).toEqual(barriersBeforeDump);
    expect(after).toHaveLength(ENVIRONMENTS.length * WORKSPACES.length * 2);
    for (const line of after) expect(line, line).toContain("barrier=security_barrier=true");
  });

  it("passes the `ownsControlSchema` guard the environment command refuses on", async () => {
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
    const perEnvironment = GRANT_SOURCES.filter((source) => source.scope !== "installation").length;
    const installation = GRANT_SOURCES.length - perEnvironment;
    expect(report.passes).toHaveLength(installation + perEnvironment * ENVIRONMENTS.length);
    for (const pass of report.passes) expect(pass.statements, pass.source).toBeGreaterThan(0);
    expect(report.publicCreateGrantedToPublic).toBe(false);
  });

  it("leaves `public` empty with `CREATE` on it granted to nobody (criterion 2)", async () => {
    // The re-grant cannot re-apply this `REVOKE`: it needs `public`'s owner, which a
    // restored database holds as `pg_database_owner`. PostgreSQL 15 and later grant
    // `PUBLIC` no `CREATE` on a fresh `public` at all, which is what makes the skip safe.
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
    // `form_versions.published_by` carries no privilege of its own, so no grant assertion
    // in this file can see a restore that dropped it.
    const table = await owner.query<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'control' and c.relname = $1`,
      [ENDPOINT_PROPOSALS_TABLE],
    );
    expect(table.rows.map((row) => row.relname)).toEqual([ENDPOINT_PROPOSALS_TABLE]);

    // A table restored without its CHECKs would accept a self-confirmation, which is the
    // one write this mechanism exists to refuse.
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

    expect(
      [
        ...((await tablePrivileges("control", CONTROL_ROLE))[ENDPOINT_PROPOSALS_TABLE] ?? []),
      ].sort(),
    ).toEqual([...DML].sort());
    for (const environment of ENVIRONMENTS) {
      const held = await tablePrivileges("control", ENVIRONMENT_ROLES[environment]);
      expect(held[ENDPOINT_PROPOSALS_TABLE], `qcms_app_${environment}`).toBeUndefined();
    }

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
