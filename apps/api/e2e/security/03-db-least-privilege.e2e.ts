import { applyMigrations, CONTAINER_BOOT_TIMEOUT_MS } from "@roonga/qcms-db/testing";
import {
  ACCESS_AUDIT_TABLE,
  CONTROL_FORBIDDEN_TABLES,
  CONTROL_READ_TABLES,
  DATA_PLANE_ENUM_TYPES,
  ENDPOINT_PROPOSALS_TABLE,
  DATA_PLANE_TABLE_NAMES,
  workspaceReportingRoleName,
  workspaceReportingStatements,
} from "@roonga/qcms-db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "../support/index.js";

const MIGRATE_ROLE = "qcms_migrate";
const CONTROL_ROLE = "qcms_app_control";
const FIXTURE_WORKSPACE = "org_least_privilege";
const ENVIRONMENTS = ["test", "prod"] as const;
const ENVIRONMENT_ROLES = { test: "qcms_app_test", prod: "qcms_app_prod" } as const;

// A name this project does not ship, so the `qcms_app%` revoke is executed, not believed.
const UNSHIPPED_ROLE = "qcms_app_zebra";

const REPORTING_ROLE = "qcms_reporting";

// Two workspaces, so "cannot read another workspace's views" has one to be refused.
const HOME_WORKSPACE = { id: "org_home_lp", slug: "home" } as const;
const VEHICLE_WORKSPACE = { id: "org_vehicle_lp", slug: "vehicle" } as const;

const HOME_PROD_REPORTING_ROLE = workspaceReportingRoleName("prod", HOME_WORKSPACE.slug);

const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

// Each planner probe needs a session of its own: `pg_temp` is per session, and a notice
// listener on a shared client would collect another case's notices.
let homeReportingPassword = "";
let probeClients = 0;

let testDb: TestDb;
let owner: pg.Client;
let migrator: pg.Client;
const clients = new Map<string, pg.Client>();

// Generated per run, never committed.
function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

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

// The catalogue rather than `has_table_privilege` per name, so a privilege nobody expected
// appears in the result instead of being missed by a question nobody asked.
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

beforeAll(async () => {
  // Unmigrated on purpose: migrating as the superuser first would leave every object owned
  // by the wrong role.
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

  // `CREATE ON DATABASE` rather than ownership of the database, which would also allow
  // DROP DATABASE.
  await owner.query(`ALTER SCHEMA public OWNER TO ${MIGRATE_ROLE}`);
  await owner.query(
    `DO $$ BEGIN
       EXECUTE format('GRANT CREATE ON DATABASE %I TO ${MIGRATE_ROLE}', current_database());
     END $$`,
  );

  // The baseline's grants are guarded on each role existing, which is why the roles were
  // created above rather than after.
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

  const reportingPassword = ephemeralPassword();
  await owner.query(`CREATE ROLE ${REPORTING_ROLE} LOGIN PASSWORD '${reportingPassword}'`);
  await owner.query(`GRANT USAGE ON SCHEMA reporting_prod TO ${REPORTING_ROLE}`);
  await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting_prod TO ${REPORTING_ROLE}`);
  clients.set(REPORTING_ROLE, await connectAs(REPORTING_ROLE, reportingPassword, "reporting_prod"));

  // `control.forms.workspace_id` is `NOT NULL` with no default, so a workspace row has to
  // exist before any form row below.
  await owner.query(
    `insert into control.organization (id, name, slug, "createdAt")
       values ($1, 'Least privilege', 'least-privilege', now())`,
    [FIXTURE_WORKSPACE],
  );

  await seedWorkspaceReporting();
}, CONTAINER_BOOT_TIMEOUT_MS);

// The role first as `owner` (`qcms_migrate` holds no `CREATEROLE`, and the grants are
// guarded on it existing), then the views as `migrator`, because a view's underlying-table
// privileges are checked against the view's owner.
async function seedWorkspaceReporting(): Promise<void> {
  for (const workspace of [HOME_WORKSPACE, VEHICLE_WORKSPACE]) {
    await owner.query(
      `insert into control.organization (id, name, slug, "createdAt")
         values ($1, $2, $2, now())`,
      [workspace.id, workspace.slug],
    );
    const formId = `frm_${workspace.slug}_lp`;
    await owner.query(
      `insert into control.forms (form_id, slug, workspace_id, default_locale)
         values ($1, $1, $2, 'en')`,
      [formId, workspace.id],
    );
    await owner.query(
      `insert into control.form_versions
         (form_id, version, definition, compiled, compiler_version,
          a2ui_spec_version, semantics_version)
       values ($1, 1, '{}'::jsonb, '{}'::jsonb, '0', '0', '0')`,
      [formId],
    );
    for (const environment of ENVIRONMENTS) {
      const sessionId = `ses_${workspace.slug}_${environment}`;
      await owner.query(
        `insert into data_${environment}.sessions
           (session_id, form_id, form_version, access_mode, status, environment, expires_at)
         values ($1, $2, 1, 'anonymous', 'submitted', $3, now() + interval '1 day')`,
        [sessionId, formId, environment],
      );
      await owner.query(
        `insert into data_${environment}.submissions (session_id, content_hash, locked_answers)
         values ($1, 'sha256:0', $2::jsonb)`,
        [
          sessionId,
          // One distinctive answer per workspace, so a leak is detectable by value.
          JSON.stringify({
            answers: [{ questionId: "q_secret", value: `${workspace.slug.toUpperCase()}_SECRET` }],
            flowState: { visible: [] },
          }),
        ],
      );
    }
  }

  const password = ephemeralPassword();
  homeReportingPassword = password;
  await owner.query(`CREATE ROLE ${HOME_PROD_REPORTING_ROLE} LOGIN PASSWORD '${password}'`);

  for (const environment of ENVIRONMENTS) {
    for (const workspace of [HOME_WORKSPACE, VEHICLE_WORKSPACE]) {
      for (const statement of workspaceReportingStatements({
        environment,
        slug: workspace.slug,
        workspaceId: workspace.id,
      })) {
        await migrator.query(statement);
      }
    }
  }

  clients.set(
    HOME_PROD_REPORTING_ROLE,
    await connectAs(HOME_PROD_REPORTING_ROLE, password, "reporting_prod"),
  );
}

afterAll(async () => {
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
  it("holds DML on every control-plane table except the two audits", async () => {
    const held = await tablePrivileges("control", CONTROL_ROLE);
    // Absent entirely rather than present with fewer privileges: the revoke takes all four.
    expect(held["two_factor_resets"]).toBeUndefined();
    // No `UPDATE` and no `DELETE` on the audit, so this role can add a row and change none.
    expect([...(held["access_audit"] ?? [])].sort()).toEqual(["INSERT", "SELECT"]);
    expect([...(held[ENDPOINT_PROPOSALS_TABLE] ?? [])].sort()).toEqual([...DML].sort());
    for (const [table, privileges] of Object.entries(held)) {
      if (table === "access_audit") continue;
      expect([...privileges].sort(), `control.${table}`).toEqual([...DML].sort());
    }
    expect(Object.keys(held).length).toBeGreaterThan(10);
  });

  it.each(ENVIRONMENTS)(
    "holds INSERT on data_%s.outbox and no other privilege of any kind there (Q49)",
    async (environment) => {
      const held = await tablePrivileges(`data_${environment}`, CONTROL_ROLE);
      expect(held).toEqual({ outbox: ["INSERT"] });
      // Schema `USAGE` is the unavoidable companion of that one grant, and conveys no
      // access to any other table.
      expect(await hasSchemaUsage(`data_${environment}`, CONTROL_ROLE)).toBe(true);
    },
  );

  it.each(ENVIRONMENTS)("holds nothing at all on reporting_%s (Q52)", async (environment) => {
    expect(await tablePrivileges(`reporting_${environment}`, CONTROL_ROLE)).toEqual({});
    expect(await hasSchemaUsage(`reporting_${environment}`, CONTROL_ROLE)).toBe(false);
  });

  it("holds USAGE on `control` and on every data schema, and on nothing else QCMS named", async () => {
    // Schema `USAGE` is the grant a table-privilege listing cannot show, and a statement
    // fails on the schema before it reaches the table.
    expect(await hasSchemaUsage("control", CONTROL_ROLE)).toBe(true);
    for (const environment of ENVIRONMENTS) {
      expect(await hasSchemaUsage(`data_${environment}`, CONTROL_ROLE)).toBe(true);
      expect(await hasSchemaUsage(`reporting_${environment}`, CONTROL_ROLE)).toBe(false);
    }
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
    // `RETURNING` reads the row it wrote, so Postgres requires `SELECT` for it: widening
    // the grant would let an authoring credential read the answers a payload carries.
    const refusal = await refusalFor(
      client!,
      `insert into data_prod.outbox ("event_type", "payload") values ('x', '{}'::jsonb) returning id`,
    );
    expect(refusal).toMatch(/permission denied/i);
  });
  it("publishes a version, under its own grants, and queues nothing anywhere (Q60, criterion 6)", async () => {
    // The counts are the owner's: this role holds `INSERT` on every `data_<env>.outbox`
    // and no `SELECT` in any data schema, so an empty outbox is the transaction's doing
    // rather than a refusal.
    const control = clients.get(CONTROL_ROLE)!;
    const formId = "q60-publish-count";

    await owner.query(
      `insert into control.forms (form_id, slug, workspace_id, default_locale)
         values ($1, $1, $2, 'en')`,
      [formId, FIXTURE_WORKSPACE],
    );
    await owner.query(
      `insert into control.form_drafts (form_id, definition) values ($1, '{}'::jsonb)`,
      [formId],
    );

    // A delta rather than an absolute count: another test in this file inserts into the
    // same outbox, and the assertion must not depend on which ran first.
    const outboxCounts = async (): Promise<Record<string, number>> => {
      const counts: Record<string, number> = {};
      for (const environment of ENVIRONMENTS) {
        const res = await owner.query<{ n: string }>(
          `select count(*) as n from data_${environment}.outbox`,
        );
        counts[environment] = Number(res.rows[0]?.n ?? "-1");
      }
      return counts;
    };
    const before = await outboxCounts();

    await control.query("begin");
    await control.query(
      `insert into control.form_versions
         (form_id, version, definition, compiled, compiler_version,
          a2ui_spec_version, semantics_version)
       values ($1, 1, '{}'::jsonb, '{}'::jsonb, '0', '0', '0')`,
      [formId],
    );
    await control.query(`delete from control.form_drafts where form_id = $1`, [formId]);
    await control.query("commit");

    const version = await owner.query<{ n: string }>(
      `select count(*) as n from control.form_versions where form_id = $1`,
      [formId],
    );
    expect(Number(version.rows[0]?.n)).toBe(1);

    expect(await outboxCounts()).toEqual(before);

    expect(await refusalFor(control, `select count(*) from data_prod.outbox`)).toMatch(
      /permission denied/i,
    );
  });

  it("releases a version, under its own grants, and queues exactly one event (Q49, criterion 8)", async () => {
    const control = clients.get(CONTROL_ROLE)!;
    const formId = "q49-release-count";

    await owner.query(
      `insert into control.forms (form_id, slug, workspace_id, default_locale)
         values ($1, $1, $2, 'en')`,
      [formId, FIXTURE_WORKSPACE],
    );
    await owner.query(
      `insert into control.form_versions
         (form_id, version, definition, compiled, compiler_version,
          a2ui_spec_version, semantics_version)
       values ($1, 1, '{}'::jsonb, '{}'::jsonb, '0', '0', '0')`,
      [formId],
    );

    const releasedRows = async (): Promise<number> => {
      const res = await owner.query<{ n: string }>(
        `select count(*) as n from data_prod.outbox
          where event_type = 'form.released' and payload->>'formId' = $1`,
        [formId],
      );
      return Number(res.rows[0]?.n ?? "-1");
    };
    expect(await releasedRows()).toBe(0);

    await control.query("begin");
    await control.query(
      `insert into control.form_releases
         (form_id, environment, version, sequence, released_by)
       values ($1, 'prod', 1, 1, 'usr_e2e')`,
      [formId],
    );
    // No `RETURNING`: the role holds `INSERT` here and no `SELECT` in any data schema.
    await control.query(
      `insert into data_prod.outbox ("event_type", "payload")
       values ('form.released', jsonb_build_object('formId', $1::text, 'version', 1,
               'environment', 'prod', 'releasedBy', 'usr_e2e'))`,
      [formId],
    );
    await control.query("commit");

    expect(await releasedRows()).toBe(1);
    const record = await owner.query<{ n: string }>(
      `select count(*) as n from control.form_releases where form_id = $1`,
      [formId],
    );
    expect(Number(record.rows[0]?.n)).toBe(1);

    // The grant is DML, so a trigger rather than a privilege is what refuses the rewrite.
    expect(
      await refusalFor(
        control,
        `update control.form_releases set version = 1 where form_id = '${formId}'`,
      ),
    ).toMatch(/append-only/i);
    expect(
      await refusalFor(control, `delete from control.form_releases where form_id = '${formId}'`),
    ).toMatch(/append-only/i);
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
      // Derived from the schema module rather than typed, so a new table needs no edit here.
      expect(Object.keys(held).length).toBe(DATA_PLANE_TABLE_NAMES.length);
    });

    it("holds nothing at all in another environment's data schema", async () => {
      expect(await tablePrivileges(`data_${other}`, role)).toEqual({});
      expect(await hasSchemaUsage(`data_${other}`, role)).toBe(false);
    });

    it("holds schema USAGE on exactly the three schemas it reaches, and no fourth", async () => {
      // The privilege half of the isolation claim, which a `search_path` default is not.
      expect(await hasSchemaUsage("control", role)).toBe(true);
      expect(await hasSchemaUsage(`data_${environment}`, role)).toBe(true);
      expect(await hasSchemaUsage(`reporting_${environment}`, role)).toBe(true);
      expect(await hasSchemaUsage(`data_${other}`, role)).toBe(false);
      expect(await hasSchemaUsage(`reporting_${other}`, role)).toBe(false);
    });

    it("is refused a schema-qualified read of another environment's answers (criterion 3)", async () => {
      // `search_path` is a resolution default, not a grant, so a statement naming the other
      // schema explicitly has to be refused on privilege.
      const refusal = await refusalFor(
        clients.get(role)!,
        `select * from data_${other}.answers limit 1`,
      );
      expect(refusal).toMatch(/permission denied/i);
    });

    it("resolves an unqualified data-plane name inside its OWN schema (criterion 3)", async () => {
      const client = clients.get(role)!;
      const inserted = await client.query<{ nspname: string }>(
        `select n.nspname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.oid = 'sessions'::regclass`,
      );
      expect(inserted.rows[0]?.nspname).toBe(`data_${environment}`);
    });

    it("holds exactly the named SELECT list on `control`, one UPDATE and one INSERT", async () => {
      const held = await tablePrivileges("control", role);
      const expectedReads = CONTROL_READ_TABLES;
      expect(expectedReads).toHaveLength(6);
      // The seventh table carries no read: the audit, on which this role holds `INSERT`
      // alone, so it can neither read, change nor remove a row it wrote.
      expect(Object.keys(held).sort()).toEqual([...expectedReads, ACCESS_AUDIT_TABLE].sort());
      for (const table of expectedReads) {
        const expected = table === "secure_links" ? ["SELECT", "UPDATE"] : ["SELECT"];
        expect([...(held[table] ?? [])].sort(), `control.${table}`).toEqual(expected);
      }
      expect([...(held[ACCESS_AUDIT_TABLE] ?? [])]).toEqual(["INSERT"]);
    });

    it("holds nothing at all on the pending prod endpoint change (task 070)", async () => {
      // The table holds a proposed production URL, and the credential serving anonymous
      // respondent traffic can neither read one nor write one.
      const held = await tablePrivileges("control", role);
      expect(held[ENDPOINT_PROPOSALS_TABLE]).toBeUndefined();
      for (const privilege of DML) {
        const res = await owner.query<{ has: boolean }>(
          `select has_table_privilege($1, $2, $3) as has`,
          [role, `control.${ENDPOINT_PROPOSALS_TABLE}`, privilege],
        );
        expect(res.rows[0]?.has, `${role} must not hold ${privilege} there`).toBe(false);
      }
    });

    it.each(CONTROL_FORBIDDEN_TABLES)(
      "holds no privilege of any kind on control.%s",
      async (table) => {
        // A defect on the anonymous respondent path cannot rewrite a grant row or a staff
        // session: its connection holds no grant on those tables at all.
        const held = await tablePrivileges("control", role);
        expect(held[table]).toBeUndefined();
        for (const privilege of DML) {
          // The table name is quoted: two of these tables are camelCase, and an unquoted
          // identifier is lower-cased by the parser.
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

    it("holds USAGE on the two enum types, which live once in `control` (Q54)", async () => {
      // This reads a DEFAULT, not a grant: Postgres grants type `USAGE` to `PUBLIC`, and the
      // baseline emits no type grant. A third enum would be a new dependency on that
      // default, and fails on the equality below.
      expect([...DATA_PLANE_ENUM_TYPES]).toEqual(["access_mode", "session_status"]);
      for (const type of DATA_PLANE_ENUM_TYPES) {
        const res = await owner.query<{ has: boolean }>(
          `select has_type_privilege($1, $2, 'USAGE') as has`,
          [role, `control.${type}`],
        );
        expect(res.rows[0]?.has, `${role} needs USAGE on control.${type}`).toBe(true);
      }
    });

    it("can actually write a session row, which is the test of every grant above", async () => {
      const formId = `frm_grant_${environment}`;
      await owner.query(
        `insert into control.forms (form_id, slug, workspace_id, default_locale)
           values ($1, $1, $2, 'en')`,
        [formId, FIXTURE_WORKSPACE],
      );
      await owner.query(
        `insert into control.form_versions
         (form_id, version, definition, compiled, compiler_version, a2ui_spec_version, semantics_version)
       values ($1, 1, '{}'::jsonb, '{}'::jsonb, '0.0.0', '0.0.0', '0.0.0')`,
        [formId],
      );
      await clients.get(role)!.query(
        `insert into sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ($1, $2, 1, 'anonymous', $3, now() + interval '1 day')`,
        [`ses_grant_${environment}`, formId, environment],
      );
      const written = await owner.query<{ environment: string }>(
        `select environment from data_${environment}.sessions where session_id = $1`,
        [`ses_grant_${environment}`],
      );
      expect(written.rows[0]?.environment).toBe(environment);
    });

    it("cannot mint a secure link, only redeem one (Q53)", async () => {
      // SELECT and UPDATE but no INSERT: this role redeems a link, minting runs on the
      // control pool.
      const refusal = await refusalFor(
        clients.get(role)!,
        `insert into control.secure_links (link_id, form_id, expires_at, environment)
         values ('lnk_probe', 'frm_probe', now(), '${environment}')`,
      );
      expect(refusal).toMatch(/permission denied/i);
    });

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
      // The revoke names the `qcms_app%` prefix, so a role an operator adds later is
      // covered; `qcms_app_zebra` is a name this project does not ship.
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

describe("the SEC-15 access audit's grants and revokes (task 069, Q40 with Q56)", () => {
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

  it.each(Object.values(ENVIRONMENT_ROLES))(
    "gives %s INSERT on control.access_audit and nothing else on it",
    async (role) => {
      const held = await tablePrivileges("control", role);
      expect([...(held["access_audit"] ?? [])]).toEqual(["INSERT"]);
    },
  );

  it.each(ENVIRONMENTS)(
    "lets qcms_app_%s write its own read's audit row in the read's transaction (Q40)",
    async (environment) => {
      // The read and its audit row commit or fail together, so a read that succeeded while
      // its audit write failed cannot happen.
      const client = clients.get(ENVIRONMENT_ROLES[environment]);
      expect(client).toBeDefined();
      await (client as pg.Client).query("begin");
      await (client as pg.Client).query(
        `insert into control.access_audit (actor, workspace_id, environment, form_id, kind)
         values ('usr_e2e', 'org_e2e', $1, 'frm_e2e', 'read')`,
        [environment],
      );
      await (client as pg.Client).query("commit");

      const counted = await owner.query<{ n: string }>(
        `select count(*) as n from control.access_audit where environment = $1`,
        [environment],
      );
      expect(Number(counted.rows[0]?.n)).toBeGreaterThan(0);
    },
  );

  it.each(ENVIRONMENTS)(
    "refuses qcms_app_%s a RETURNING on that insert, which is why the helper carries none (criterion 21)",
    async (environment) => {
      // Asserted for an environment role: `qcms_app_control` holds `SELECT` here, so the
      // same statement would succeed for it.
      const refusal = await refusalFor(
        clients.get(ENVIRONMENT_ROLES[environment])!,
        `insert into control.access_audit (actor, workspace_id, kind)
         values ('usr_e2e', 'org_e2e', 'read') returning id`,
      );
      expect(refusal).toMatch(/permission denied/i);
    },
  );

  it.each(Object.values(ENVIRONMENT_ROLES))("refuses %s a read of an audit row", async (role) => {
    const refusal = await refusalFor(
      clients.get(role)!,
      `select * from control.access_audit limit 1`,
    );
    expect(refusal).toMatch(/permission denied/i);
  });

  it("refuses every application role an UPDATE and a DELETE at the statement, not only the bit", async () => {
    for (const role of [CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES)]) {
      expect(
        await refusalFor(clients.get(role)!, `update control.access_audit set kind = 'read'`),
      ).toMatch(/permission denied/i);
      expect(await refusalFor(clients.get(role)!, `delete from control.access_audit`)).toMatch(
        /permission denied/i,
      );
    }
  });

  it("carries no foreign key, so no row cascades away with what it describes", async () => {
    // An audit row that cascades away with the account, workspace or form it names is not
    // an audit row.
    const keys = await owner.query<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'control.access_audit'::regclass and contype = 'f'`,
    );
    expect(keys.rows).toEqual([]);
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
    "still reports USAGE on it for %s, through PUBLIC, and that is the emptiness above doing the work",
    async (role) => {
      // Postgres grants `USAGE` on `public` to `PUBLIC`, so every role holds it whatever
      // the baseline says; what makes it worthless is that the schema holds no object.
      const res = await owner.query<{ has: boolean }>(
        `select has_schema_privilege($1, 'public', 'USAGE') as has`,
        [role],
      );
      expect(res.rows[0]?.has).toBe(true);
    },
  );

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

// A reporting consumer writes their own SQL against the database, so there is no handler
// to check: the grants are the whole boundary.
describe("a per-workspace reporting role reads one workspace in one environment (criterion 7)", () => {
  function consumer(): pg.Client {
    return clients.get(HOME_PROD_REPORTING_ROLE)!;
  }

  it("reads its own workspace's views, and sees its own workspace's response", async () => {
    const res = await consumer().query<{ form_id: string }>(
      `select form_id from reporting_prod.${HOME_WORKSPACE.slug}_responses`,
    );
    expect(res.rows.map((row) => row.form_id)).toEqual([`frm_${HOME_WORKSPACE.slug}_lp`]);

    const flat = await consumer().query(
      `select session_id from reporting_prod.${HOME_WORKSPACE.slug}_answers_flat`,
    );
    expect(flat.rowCount).toBeGreaterThanOrEqual(0);
  });

  it("cannot read another workspace's views in its own environment", async () => {
    for (const view of ["responses", "answers_flat"]) {
      expect(
        await refusalFor(
          consumer(),
          `select * from reporting_prod.${VEHICLE_WORKSPACE.slug}_${view} limit 1`,
        ),
        `${VEHICLE_WORKSPACE.slug}_${view} must be refused`,
      ).toMatch(/permission denied/i);
    }
  });

  it("cannot read another environment's reporting schema at all", async () => {
    // Refused at `USAGE` rather than at the view, which is why this says `schema`: the
    // role holds nothing on `reporting_test`, so even its own workspace's view set there
    // is unreachable.
    expect(await hasSchemaUsage("reporting_test", HOME_PROD_REPORTING_ROLE)).toBe(false);
    expect(
      await refusalFor(
        consumer(),
        `select * from reporting_test.${HOME_WORKSPACE.slug}_responses limit 1`,
      ),
    ).toMatch(/permission denied/i);
  });

  it("cannot read the application's own unfiltered views in its own schema", async () => {
    // The assertion that distinguishes this grant from `ALL TABLES IN SCHEMA`.
    // `reporting_prod.responses` is Q52's, held by `qcms_app_prod` and by no consumer, and
    // it carries every workspace's rows.
    for (const view of ["responses", "answers_flat"]) {
      expect(
        await refusalFor(consumer(), `select * from reporting_prod.${view} limit 1`),
        `the unfiltered ${view} must be refused`,
      ).toMatch(/permission denied/i);
    }
  });

  it("holds SELECT on exactly its own two views and nothing else in the schema", async () => {
    const privileges = await tablePrivileges("reporting_prod", HOME_PROD_REPORTING_ROLE);
    expect(Object.keys(privileges).sort()).toEqual([
      `${HOME_WORKSPACE.slug}_answers_flat`,
      `${HOME_WORKSPACE.slug}_responses`,
    ]);
    for (const granted of Object.values(privileges)) expect([...granted]).toEqual(["SELECT"]);
    expect(await hasSchemaUsage("reporting_prod", HOME_PROD_REPORTING_ROLE)).toBe(true);
  });

  it("declares `security_barrier` on every one of its views (PR #1093's review)", async () => {
    // The option is what makes the view's filter a boundary rather than a hint. Read out
    // of the catalogue rather than off the generator, because what defends the rows is the
    // option the database is holding, not the one the source meant to emit.
    const options = await owner.query<{ relname: string; reloptions: string[] | null }>(
      `select c.relname, c.reloptions
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'reporting_prod' and c.relkind = 'v'
          and c.relname like $1
        order by c.relname`,
      // `_` is a LIKE wildcard; escaping it keeps the pattern to this workspace's own
      // views. The backslash is SQL's, so it is written as a plain character here.
      [`${HOME_WORKSPACE.slug}${String.fromCharCode(92)}_%`],
    );
    expect(options.rows.map((row) => row.relname)).toEqual([
      `${HOME_WORKSPACE.slug}_answers_flat`,
      `${HOME_WORKSPACE.slug}_responses`,
    ]);
    for (const row of options.rows) {
      expect(row.reloptions ?? [], row.relname).toContain("security_barrier=true");
    }
  });

  /**
   * Side channels that make the consumer's own qual report what it was handed. They need no
   * privilege the role lacks, and they exercise the planner, which no string assertion can.
   */
  describe("the consumer's own SQL cannot reach past the filter", () => {
    const OTHER_SECRET = `${VEHICLE_WORKSPACE.slug.toUpperCase()}_SECRET`;

    /** A `COST 1` function in `pg_temp` that records every value it is handed. */
    async function plantProbe(client: pg.Client, name: string): Promise<void> {
      await client.query(
        `create or replace function pg_temp.${name}(v text) returns boolean as $$
           begin raise notice 'SAW %', v; return true; end
         $$ language plpgsql cost 1`,
      );
    }

    /** Every `SAW` notice one query raised, which is every value the qual was handed. */
    async function noticesFrom(sql: string): Promise<string[]> {
      // A client of its own: a notice listener on the shared one would collect another
      // case's notices, and `pg_temp` is per session anyway.
      const client = testDb.register(
        new pg.Client({
          connectionString: uriFor(testDb, HOME_PROD_REPORTING_ROLE, homeReportingPassword),
        }),
        `probe client ${String(probeClients++)}`,
      );
      await client.connect();
      const seen: string[] = [];
      client.on("notice", (notice) => {
        if (notice.message !== undefined) seen.push(notice.message);
      });
      await plantProbe(client, "saw");
      await client.query(sql);
      await client.end();
      return seen;
    }

    it("raises no data-dependent error for a row it must not see", async () => {
      // `division by zero` fires only if a row whose `form_id` is the other workspace's
      // reached the qual. `int4div` is not `leakproof` precisely because it can raise, so
      // a barrier view refuses to push it down.
      const refusal = await refusalFor(
        clients.get(HOME_PROD_REPORTING_ROLE)!,
        `select count(*) from reporting_prod.${HOME_WORKSPACE.slug}_responses
          where 1 / (case when form_id = 'frm_${VEHICLE_WORKSPACE.slug}_lp' then 0 else 1 end) = 1`,
      );
      expect(refusal, "the other workspace's row reached the consumer's qual").toBeUndefined();
    });

    it("hands a cheap function only its own workspace's rows", async () => {
      // The same planner knobs as the case below: without them this harness's one-row
      // tables do not produce the plan that pushes the qual down, and an assertion that
      // cannot fail is an assertion that has stopped guarding anything.
      const seen = await noticesFrom(
        `set join_collapse_limit = 1; set from_collapse_limit = 1;
         select count(*) from reporting_prod.${HOME_WORKSPACE.slug}_responses
          where pg_temp.saw(form_id || ' ' || session_id)`,
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.join("\n")).not.toContain(`frm_${VEHICLE_WORKSPACE.slug}_lp`);
      expect(seen.join("\n")).toContain(`frm_${HOME_WORKSPACE.slug}_lp`);
    });

    it("hands a cheap function no other workspace's answers, under the planner knobs a role may set", async () => {
      // `join_collapse_limit` and `from_collapse_limit` are `USERSET`, so any role may
      // choose the plan shape that pushed this qual below the filter before the barrier.
      for (const view of [
        `${HOME_WORKSPACE.slug}_responses`,
        `${HOME_WORKSPACE.slug}_answers_flat`,
      ]) {
        const column = view.endsWith("_responses") ? "answers::text" : "value::text";
        const seen = await noticesFrom(
          `set join_collapse_limit = 1; set from_collapse_limit = 1;
           select count(*) from reporting_prod.${view} where pg_temp.saw(${column})`,
        );
        expect(seen.join("\n"), view).not.toContain(OTHER_SECRET);
        expect(seen.join("\n"), view).toContain(`${HOME_WORKSPACE.slug.toUpperCase()}_SECRET`);
      }
    });

    it("still serves the legitimate read, which is what the barrier must not cost", async () => {
      const res = await clients
        .get(HOME_PROD_REPORTING_ROLE)!
        .query<{ form_id: string }>(
          `select form_id from reporting_prod.${HOME_WORKSPACE.slug}_responses`,
        );
      expect(res.rows.map((row) => row.form_id)).toEqual([`frm_${HOME_WORKSPACE.slug}_lp`]);
    });
  });

  it("reaches no data-plane table, no control-plane table and no DDL", async () => {
    const client = consumer();
    for (const statement of [
      "select * from data_prod.answers limit 1",
      "select * from data_prod.submissions limit 1",
      "select * from control.forms limit 1",
      `select * from control."user" limit 1`,
      "select * from control.organization limit 1",
    ]) {
      expect(await refusalFor(client, statement), statement).toMatch(/permission denied/i);
    }
    expect(
      await refusalFor(client, `delete from reporting_prod.${HOME_WORKSPACE.slug}_responses`),
    ).toBeDefined();
    expect(await refusalFor(client, "create table probe (id int)")).toBeDefined();
  });
});

describe("the roles are the operator's to create, not a migration's", () => {
  it("ships no role-creating migration", async () => {
    // Roles are cluster-level and `qcms_migrate` holds no CREATEROLE, so the recipe in
    // `docs/operations.md` creates them and the baseline only grants.
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
        // The per-(workspace, environment) consumer of Q26, created by this file the way
        // `docs/operations.md` has an operator create one: as a superuser, before the
        // grants that are guarded on it existing.
        HOME_PROD_REPORTING_ROLE,
      ].sort(),
    );
  });
});
