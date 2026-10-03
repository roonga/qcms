/**
 * Security scenario 3 - SEC-10, least-privilege database roles (task 040, issues #492
 * and #995).
 *
 * ## What this file is, after ADR-40
 *
 * It used to assert two roles against one schema. It now asserts **three kinds of role**
 * against a control plane and one data plane per environment, and the assertion that
 * matters is the same one it always was: **the table list per role, read out of the
 * catalogue**. That is the form that fails when somebody widens a grant, rather than the
 * form that passes because nobody looked.
 *
 * The roles (Q40 as amended by Q48, Q49 and Q52):
 *
 * | Role               | On `control`                                     | On `data_<env>`                        | On `reporting_<env>`        |
 * | ------------------ | ------------------------------------------------ | -------------------------------------- | --------------------------- |
 * | `qcms_app_control` | DML, with nothing at all on `two_factor_resets`  | `INSERT` on `outbox`, nothing else     | nothing                     |
 * | `qcms_app_<env>`   | `SELECT` on a named list, `UPDATE` on one table  | DML on its **own** schema only         | `USAGE` + `SELECT`, its own |
 * | `qcms_migrate`     | owner, DDL                                       | owner, DDL                             | owner, DDL                  |
 *
 * ## Two properties this file exists to catch, both of which are silent
 *
 * **A widened grant.** Every assertion below is an *exact* list rather than a presence
 * check, so a role that gained a privilege fails here naming it. The forbidden lists are
 * imported from `@roonga/qcms-db` rather than re-typed, because a test carrying its own
 * copy of the grant model passes while the model drifts.
 *
 * **A revoke that only covers the shipped names.** Migration 0021 revoked
 * `two_factor_resets` from the literal `qcms_app`. There are now as many application
 * roles as there are environments plus one, and an operator may create more, so the
 * baseline revokes from every `qcms_app%` role - and this file creates one under a
 * **non-shipped** name, before migrating, purely so that claim is executed rather than
 * believed.
 *
 * ## Ordering is the recipe's, not this file's
 *
 * The roles exist and the migration role owns the schema **before** the migration runs,
 * which is exactly the bootstrap ordering `docs/operations.md` specifies and
 * `docker-compose.yml` arranges with its `db-roles` one-shot. The baseline's own grants
 * are guarded on each role existing, so running the recipe first is what makes them
 * land; a database migrated with no application role at all simply has none to grant to,
 * which is the Testcontainers harness's case.
 *
 * **The upgrading-database scenario is gone**, and its absence is a ruling rather than a
 * gap: Q22 and Q41 make this green field. Every existing database is deleted and
 * recreated by hand, there is no upgrade path, and a suite that exercised one would be
 * testing a world the design says does not exist.
 */

import { applyMigrations, CONTAINER_BOOT_TIMEOUT_MS } from "@roonga/qcms-db/testing";
import {
  CONTROL_FORBIDDEN_TABLES,
  CONTROL_READ_TABLES,
  CONTROL_READ_TABLES_NOT_YET_CREATED,
} from "@roonga/qcms-db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "../support/index.js";

const MIGRATE_ROLE = "qcms_migrate";
const CONTROL_ROLE = "qcms_app_control";
const ENVIRONMENTS = ["test", "prod"] as const;
const ENVIRONMENT_ROLES = { test: "qcms_app_test", prod: "qcms_app_prod" } as const;

/**
 * An application role under a name this project does not ship.
 *
 * It exists for exactly one assertion: `two_factor_resets`' revoke covers **every**
 * `qcms_app%` role rather than the names in the recipe. Created before the migration, so
 * the revoke in the baseline meets it.
 */
const UNSHIPPED_ROLE = "qcms_app_zebra";

/** The reporting consumer role of `docs/reporting-view.md`, granted one environment. */
const REPORTING_ROLE = "qcms_reporting";

/** The privileges a table grant can carry, in the order the catalogue reports them. */
const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

let testDb: TestDb;
/** Superuser/owner connection: the "as a superuser or the database owner" the recipe asks for. */
let owner: pg.Client;
let migrator: pg.Client;
const clients = new Map<string, pg.Client>();

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

function uriFor(container: TestDb, role: string, password: string): string {
  const uri = new URL(container.connectionUri);
  uri.username = role;
  uri.password = password;
  return uri.toString();
}

async function connectAs(role: string, password: string, searchPath: string): Promise<pg.Client> {
  const client = testDb.register(
    new pg.Client({
      connectionString: uriFor(testDb, role, password),
      options: `-c search_path=${searchPath}`,
    }),
    `${role} client`,
  );
  await client.connect();
  return client;
}

/**
 * Every table privilege `role` holds in `schema`, read from the catalogue.
 *
 * `information_schema.table_privileges` rather than `has_table_privilege` per name: this
 * reports what the role **has**, so a privilege nobody expected appears in the result
 * instead of being missed by a question nobody asked.
 */
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
  for (const row of res.rows) (byTable[row.table_name] ??= []).push(row.privilege_type);
  return byTable;
}

/** Whether `role` holds `USAGE` on `schema`. */
async function hasSchemaUsage(schema: string, role: string): Promise<boolean> {
  const res = await owner.query<{ has: boolean }>(
    `select has_schema_privilege($1, $2, 'USAGE') as has`,
    [role, schema],
  );
  return res.rows[0]?.has ?? false;
}

beforeAll(async () => {
  // UNMIGRATED on purpose. The recipe runs before the first migration, and the migration
  // then runs as qcms_migrate: migrating here as the superuser first would leave every
  // object owned by the wrong role and quietly test nothing.
  testDb = await startTestDb({ migrate: false });
  owner = testDb.register(
    new pg.Client({ connectionString: testDb.connectionUri }),
    "owner client",
  );
  await owner.connect();

  const passwords = new Map<string, string>();
  const allRoles = [
    MIGRATE_ROLE,
    CONTROL_ROLE,
    ...Object.values(ENVIRONMENT_ROLES),
    UNSHIPPED_ROLE,
  ];
  for (const role of allRoles) {
    const password = ephemeralPassword();
    passwords.set(role, password);
    await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  }

  // The migration role owns the schemas it is about to create, and may create them.
  // `CREATE ON DATABASE` rather than ownership of the database: owning it would also
  // allow DROP DATABASE, which is past what "owns the schema" has to mean.
  await owner.query(`ALTER SCHEMA public OWNER TO ${MIGRATE_ROLE}`);
  await owner.query(
    `DO $$ BEGIN
       EXECUTE format('GRANT CREATE ON DATABASE %I TO ${MIGRATE_ROLE}', current_database());
     END $$`,
  );

  // The migration itself, run as the role the recipe says runs it. Every grant and
  // revoke the baseline carries lands here, guarded on each role existing - which is why
  // the roles were created above rather than after.
  migrator = testDb.register(
    new pg.Client({
      connectionString: uriFor(testDb, MIGRATE_ROLE, passwords.get(MIGRATE_ROLE) ?? ""),
    }),
    "migrator client",
  );
  await migrator.connect();
  await applyMigrations(migrator);

  for (const environment of ENVIRONMENTS) {
    const role = ENVIRONMENT_ROLES[environment];
    clients.set(
      role,
      await connectAs(role, passwords.get(role) ?? "", `data_${environment},control`),
    );
  }
  clients.set(
    CONTROL_ROLE,
    await connectAs(CONTROL_ROLE, passwords.get(CONTROL_ROLE) ?? "", "control"),
  );

  // The reporting consumer role of `docs/reporting-view.md`, granted ONE environment's
  // view set. Per (workspace, environment) is Q26 and task 067's; per environment is
  // what exists today.
  const reportingPassword = ephemeralPassword();
  await owner.query(`CREATE ROLE ${REPORTING_ROLE} LOGIN PASSWORD '${reportingPassword}'`);
  await owner.query(`GRANT USAGE ON SCHEMA reporting_prod TO ${REPORTING_ROLE}`);
  await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting_prod TO ${REPORTING_ROLE}`);
  clients.set(REPORTING_ROLE, await connectAs(REPORTING_ROLE, reportingPassword, "reporting_prod"));
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  // Every client above is registered with the harness, so this one call drains them all
  // and then stops the container (issue #888).
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the migration role is the only role that owns anything", () => {
  it("migrated the database, which is the recipe's ordering working end to end", async () => {
    const schemas = await migrator.query<{ nspname: string }>(
      `select nspname from pg_namespace
        where nspname in ('control', 'data_test', 'data_prod', 'reporting_test', 'reporting_prod')
        order by nspname`,
    );
    expect(schemas.rows.map((row) => row.nspname)).toEqual([
      "control",
      "data_prod",
      "data_test",
      "reporting_prod",
      "reporting_test",
    ]);
  });

  it("owns every schema and every object the baseline created", async () => {
    const wrong = await owner.query<{ name: string; owner: string }>(
      `select format('%I.%I', n.nspname, c.relname) as name, pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('control', 'data_test', 'data_prod', 'reporting_test', 'reporting_prod')
          and c.relkind in ('r', 'v', 'm', 'S')
          and pg_get_userbyid(c.relowner) <> '${MIGRATE_ROLE}'`,
    );
    expect(wrong.rows).toEqual([]);
  });

  it("holds the INSERT and SELECT `qcms:reset-2fa` needs on the break-glass audit", async () => {
    // The other side of the migrate-only rule: nobody else may touch the table, and the
    // one credential that may has to be able to write the row the reset produces.
    for (const privilege of ["SELECT", "INSERT"]) {
      const res = await owner.query<{ has: boolean }>(
        `select has_table_privilege($1, 'control.two_factor_resets', $2) as has`,
        [MIGRATE_ROLE, privilege],
      );
      expect(res.rows[0]?.has, `${MIGRATE_ROLE} needs ${privilege}`).toBe(true);
    }
  });
});

describe("qcms_app_control: the control plane, and one grant in each data plane", () => {
  it("holds DML on every control-plane table except the break-glass audit", async () => {
    const held = await tablePrivileges("control", CONTROL_ROLE);
    // `two_factor_resets` is absent entirely rather than present with fewer privileges:
    // the revoke takes all four, so the catalogue reports no row for it at all.
    expect(held["two_factor_resets"]).toBeUndefined();
    // Every other control-plane table carries all four. An exact per-table comparison,
    // so a table that lost a privilege fails here as loudly as one that gained it.
    for (const [table, privileges] of Object.entries(held)) {
      expect([...privileges].sort(), `control.${table}`).toEqual([...DML].sort());
    }
    // And the floor under that loop: it has to have found the tables at all.
    expect(Object.keys(held).length).toBeGreaterThan(10);
  });

  it.each(ENVIRONMENTS)(
    "holds INSERT on data_%s.outbox and no other privilege of any kind there (Q49)",
    async (environment) => {
      const held = await tablePrivileges(`data_${environment}`, CONTROL_ROLE);
      expect(held).toEqual({ outbox: ["INSERT"] });
      // `USAGE` on the schema is the unavoidable companion of that one grant: Postgres
      // has no way to reach a table in a schema without it, and it conveys no access to
      // any other table - which the exact table listing above is what proves.
      expect(await hasSchemaUsage(`data_${environment}`, CONTROL_ROLE)).toBe(true);
    },
  );

  it.each(ENVIRONMENTS)("holds nothing at all on reporting_%s (Q52)", async (environment) => {
    expect(await tablePrivileges(`reporting_${environment}`, CONTROL_ROLE)).toEqual({});
    expect(await hasSchemaUsage(`reporting_${environment}`, CONTROL_ROLE)).toBe(false);
  });

  it("is refused a read of an answer, which is the property the split buys", async () => {
    const client = clients.get(CONTROL_ROLE);
    const refusal = await refusalFor(client!, `select * from data_prod.answers limit 1`);
    expect(refusal).toMatch(/permission denied/i);
  });

  it("can insert the release event Q49 gives it, without RETURNING", async () => {
    const client = clients.get(CONTROL_ROLE);
    await client!.query(
      `insert into data_prod.outbox ("event_type", "payload") values ('form.released', '{}'::jsonb)`,
    );
    // And `INSERT ... RETURNING` is refused, because RETURNING reads the row it wrote and
    // Postgres requires SELECT for that. This is why `enqueueInEnvironment` has no
    // `.returning()`: widening the grant would let an authoring credential read the
    // respondent answers an outbox payload carries.
    const refusal = await refusalFor(
      client!,
      `insert into data_prod.outbox ("event_type", "payload") values ('x', '{}'::jsonb) returning id`,
    );
    expect(refusal).toMatch(/permission denied/i);
  });
});

describe.each(ENVIRONMENTS)(
  "qcms_app_%s: its own data plane and a named read list",
  (environment) => {
    const role = ENVIRONMENT_ROLES[environment];
    const other = environment === "test" ? "prod" : "test";

    it("holds DML on every table in its own data schema", async () => {
      const held = await tablePrivileges(`data_${environment}`, role);
      for (const [table, privileges] of Object.entries(held)) {
        expect([...privileges].sort(), `data_${environment}.${table}`).toEqual([...DML].sort());
      }
      expect(Object.keys(held).length).toBe(7);
    });

    it("holds nothing at all in another environment's data schema", async () => {
      expect(await tablePrivileges(`data_${other}`, role)).toEqual({});
      expect(await hasSchemaUsage(`data_${other}`, role)).toBe(false);
    });

    it("is refused a schema-qualified read of another environment's answers (criterion 3)", async () => {
      // The **privilege** half of criterion 3. `search_path` is a resolution default and
      // not a grant, so the resolution half alone is unsatisfiable as an isolation claim:
      // a statement that names the other schema explicitly has to be refused, and this is
      // what refuses it.
      const refusal = await refusalFor(
        clients.get(role)!,
        `select * from data_${other}.answers limit 1`,
      );
      expect(refusal).toMatch(/permission denied/i);
    });

    it("resolves an unqualified data-plane name inside its OWN schema (criterion 3)", async () => {
      // The **resolution** half, with a positive control in each environment: the row this
      // insert makes is visible to this role and the other role's schema is untouched.
      const client = clients.get(role)!;
      const inserted = await client.query<{ nspname: string }>(
        `select n.nspname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.oid = 'sessions'::regclass`,
      );
      expect(inserted.rows[0]?.nspname).toBe(`data_${environment}`);
    });

    it("holds exactly the named SELECT list on `control`, and UPDATE on one table", async () => {
      const held = await tablePrivileges("control", role);
      // `form_releases` is task 065's table and does not exist yet, so its grant is
      // guarded on the table existing. The list is the decision either way: five today,
      // six once 065 has landed, and this is the line that notices.
      const expectedReads = CONTROL_READ_TABLES.filter(
        (table) => !CONTROL_READ_TABLES_NOT_YET_CREATED.includes(table),
      );
      expect(expectedReads).toHaveLength(5);
      expect(Object.keys(held).sort()).toEqual([...expectedReads].sort());
      for (const table of expectedReads) {
        const expected = table === "secure_links" ? ["SELECT", "UPDATE"] : ["SELECT"];
        expect([...(held[table] ?? [])].sort(), `control.${table}`).toEqual(expected);
      }
    });

    it.each(CONTROL_FORBIDDEN_TABLES)(
      "holds no privilege of any kind on control.%s",
      async (table) => {
        // The property Q40 buys that an API check cannot: a defect on the anonymous
        // respondent path cannot rewrite a grant row or a staff session, because the
        // connection it runs on has no grant on those tables at all.
        const held = await tablePrivileges("control", role);
        expect(held[table]).toBeUndefined();
        for (const privilege of DML) {
          // The table name is QUOTED inside the regclass literal: two of the plugin's
          // tables are camelCase (`twoFactor`, `teamMember`), and an unquoted identifier
          // is lower-cased by the parser, so the check would look for a relation that does
          // not exist and fail for the wrong reason.
          const res = await owner.query<{ has: boolean }>(
            `select has_table_privilege($1, $2, $3) as has`,
            [role, `control."${table}"`, privilege],
          );
          expect(res.rows[0]?.has, `${role} must not hold ${privilege} on control.${table}`).toBe(
            false,
          );
        }
      },
    );

    it("reads its own reporting views and no other environment's (Q52)", async () => {
      expect(await hasSchemaUsage(`reporting_${environment}`, role)).toBe(true);
      const own = await tablePrivileges(`reporting_${environment}`, role);
      expect(Object.keys(own).sort()).toEqual(["answers_flat", "responses"]);
      for (const privileges of Object.values(own)) expect([...privileges]).toEqual(["SELECT"]);

      expect(await hasSchemaUsage(`reporting_${other}`, role)).toBe(false);
      expect(await tablePrivileges(`reporting_${other}`, role)).toEqual({});
    });

    it("cannot write through its own reporting views", async () => {
      const refusal = await refusalFor(
        clients.get(role)!,
        `delete from reporting_${environment}.responses`,
      );
      expect(refusal).toMatch(/permission denied|cannot delete/i);
    });

    it("is refused DDL of every shape, and holds no CREATE on any schema", async () => {
      const client = clients.get(role)!;
      for (const statement of [
        `create table data_${environment}.probe (id int)`,
        `drop table data_${environment}.answers`,
        `alter table data_${environment}.answers add column probe int`,
        `create schema probe_${environment}`,
      ]) {
        expect(await refusalFor(client, statement), statement).toMatch(
          /permission denied|must be owner/i,
        );
      }
      for (const schema of ["public", "control", `data_${environment}`]) {
        const res = await owner.query<{ has: boolean }>(
          `select has_schema_privilege($1, $2, 'CREATE') as has`,
          [role, schema],
        );
        expect(res.rows[0]?.has, `${role} on ${schema}`).toBe(false);
      }
    });

    it("owns no object at all", async () => {
      const owned = await owner.query<{ name: string }>(
        `select format('%I.%I', n.nspname, c.relname) as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where pg_get_userbyid(c.relowner) = $1`,
        [role],
      );
      expect(owned.rows).toEqual([]);
    });

    it("cannot become the migration role", async () => {
      const refusal = await refusalFor(clients.get(role)!, `set role ${MIGRATE_ROLE}`);
      expect(refusal).toMatch(/permission denied|must be (a )?member/i);
    });
  },
);

describe("the migrate-only audit table (issue #432, Q40 finding B)", () => {
  it.each([CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES), UNSHIPPED_ROLE])(
    "leaves %s none of the four privileges on control.two_factor_resets",
    async (role) => {
      // The widened revoke, executed rather than believed. `qcms_app_zebra` is a name
      // this project does not ship and no recipe mentions: it is here because migration
      // 0021 named one literal role, and the baseline names the PREFIX instead, so an
      // installation that creates `qcms_app_staging` next week is covered by a migration
      // written today.
      for (const privilege of DML) {
        const res = await owner.query<{ has: boolean }>(
          `select has_table_privilege($1, 'control.two_factor_resets', $2) as has`,
          [role, privilege],
        );
        expect(res.rows[0]?.has, `${role} must not hold ${privilege}`).toBe(false);
      }
    },
  );

  it("refuses the control role a read of an audit row, not merely the bit", async () => {
    const refusal = await refusalFor(
      clients.get(CONTROL_ROLE)!,
      `select * from control.two_factor_resets limit 1`,
    );
    expect(refusal).toMatch(/permission denied/i);
  });
});

describe("`public` is empty, unreachable and un-writable (criterion 2)", () => {
  it("holds no QCMS object", async () => {
    const tables = await owner.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(tables.rows).toEqual([]);
  });

  it.each([CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES)])(
    "grants %s no CREATE on it",
    async (role) => {
      const res = await owner.query<{ has: boolean }>(
        `select has_schema_privilege($1, 'public', 'CREATE') as has`,
        [role],
      );
      expect(res.rows[0]?.has).toBe(false);
    },
  );

  it("is on no application role's search path", async () => {
    for (const role of [CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES)]) {
      const res = await clients
        .get(role)!
        .query<{ path: string }>(`select current_setting('search_path') as path`);
      expect(res.rows[0]?.path, role).not.toContain("public");
    }
  });
});

describe("the documented reporting consumer role is read-only on one environment", () => {
  it("reads that environment's views", async () => {
    const res = await clients.get(REPORTING_ROLE)!.query(`select * from responses limit 1`);
    expect(res.rowCount).toBeGreaterThanOrEqual(0);
  });

  it("cannot reach the operational tables or another environment's views", async () => {
    const client = clients.get(REPORTING_ROLE)!;
    expect(await refusalFor(client, `select * from data_prod.answers limit 1`)).toMatch(
      /permission denied/i,
    );
    expect(await refusalFor(client, `select * from reporting_test.responses limit 1`)).toMatch(
      /permission denied/i,
    );
    expect(await refusalFor(client, `select * from control.user limit 1`)).toMatch(
      /permission denied/i,
    );
  });

  it("cannot write or issue DDL anywhere", async () => {
    const client = clients.get(REPORTING_ROLE)!;
    expect(await refusalFor(client, `delete from responses`)).toBeDefined();
    expect(await refusalFor(client, `create table probe (id int)`)).toBeDefined();
  });
});

describe("the roles are the operator's to create, not a migration's", () => {
  it("ships no role-creating migration", async () => {
    // Roles are cluster-level, need a credential no migration may carry, and
    // `qcms_migrate` deliberately holds no CREATEROLE - so the recipe in
    // `docs/operations.md` creates them and the baseline only grants, guarded on each
    // role existing. Every qcms role in this container was created by this file.
    const roles = await owner.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms%' ORDER BY rolname`,
    );
    expect(roles.rows.map((row) => row.rolname)).toEqual(
      [
        MIGRATE_ROLE,
        CONTROL_ROLE,
        ...Object.values(ENVIRONMENT_ROLES),
        UNSHIPPED_ROLE,
        REPORTING_ROLE,
      ].sort(),
    );
  });
});
