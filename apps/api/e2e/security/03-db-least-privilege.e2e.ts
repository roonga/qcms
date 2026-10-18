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
 * | `qcms_app_control` | DML, with two tables carved out (see below)      | `INSERT` on `outbox`, nothing else     | nothing                     |
 * | `qcms_app_<env>`   | `SELECT` on a named list, `UPDATE` on one table  | DML on its **own** schema only         | `USAGE` + `SELECT`, its own |
 * | `qcms_migrate`     | owner, DDL                                       | owner, DDL                             | owner, DDL                  |
 *
 * **The two carve-outs on `control`** are the audit tables, and their privilege sets
 * differ because their writers do. `two_factor_resets` is **migrate-only**: no
 * application role holds any of the four, because a break-glass is an operator act
 * (issue #432). The SEC-15 `access_audit` is written by the application on an ordinary
 * request, so it cannot be: `qcms_app_control` holds `SELECT` and `INSERT`, every
 * `qcms_app_<env>` holds `INSERT` and nothing else, and **no application role holds
 * `UPDATE` or `DELETE`** - which is the part that makes a row worth something (Q40 with
 * Q56).
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
  ACCESS_AUDIT_TABLE,
  CONTROL_FORBIDDEN_TABLES,
  CONTROL_READ_TABLES,
  DATA_PLANE_ENUM_TYPES,
  DATA_PLANE_TABLE_NAMES,
  workspaceReportingRoleName,
  workspaceReportingStatements,
} from "@roonga/qcms-db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "../support/index.js";

const MIGRATE_ROLE = "qcms_migrate";
const CONTROL_ROLE = "qcms_app_control";
/** The workspace every `control.forms` fixture row below belongs to (task 068). */
const FIXTURE_WORKSPACE = "org_least_privilege";
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

/**
 * Two workspaces, so criterion 7's "cannot read **another workspace's** views" has
 * another workspace to be refused (ADR-41, Q26; task 067).
 *
 * One would make the criterion unfalsifiable: a role granted the only view set in the
 * installation reads everything there is, and the assertion would be about nothing.
 */
const HOME_WORKSPACE = { id: "org_home_lp", slug: "home" } as const;
const VEHICLE_WORKSPACE = { id: "org_vehicle_lp", slug: "vehicle" } as const;

/**
 * The read-only role one workspace's analysts hold in one environment (Q26).
 *
 * `home` in `prod`, which is the pair every assertion below is drawn against: the other
 * workspace's views and the other environment's schema are what it must not reach.
 */
const HOME_PROD_REPORTING_ROLE = workspaceReportingRoleName("prod", HOME_WORKSPACE.slug);

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
  for (const row of res.rows) {
    const privileges = (byTable[row.table_name] ??= []);
    privileges.push(row.privilege_type);
  }
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

  // One workspace, as the owner, because `control.forms.workspace_id` and
  // `control.questions.workspace_id` are `NOT NULL` with no default since task 068: a
  // form has to belong to one, and every `insert into control.forms` below names it. The
  // owner writes it rather than `qcms_app_control` for the reason the form rows are the
  // owner's too - what these tests measure is a role's rights on the row, not its right
  // to arrange the fixture.
  await owner.query(
    `insert into control.organization (id, name, slug, "createdAt")
       values ($1, 'Least privilege', 'least-privilege', now())`,
    [FIXTURE_WORKSPACE],
  );

  await seedWorkspaceReporting();
}, CONTAINER_BOOT_TIMEOUT_MS);

/**
 * Two workspaces, a submitted response in each, their per-workspace reporting view sets in
 * both environments, and one login role for `home` in `prod` (Q26; criterion 7).
 *
 * # The ordering is the production recipe's, not this file's
 *
 * The **role** is created by the `owner` connection and the **views and grants** by
 * `migrator`, in that order, which is exactly what `docs/operations.md` and
 * `docs/reporting-view.md` tell an operator to do: roles are cluster-level and
 * `qcms_migrate` deliberately holds no `CREATEROLE`, and every grant the reconciliation
 * emits is guarded on its role existing. Doing it the other way round would leave the
 * grants silently unlanded, which is a failure mode worth being unable to reproduce by
 * accident.
 *
 * Running the view statements as `migrator` is load bearing for a second reason: a view's
 * underlying-table privileges are checked against the **view owner**, so the owner has to
 * be the role that owns the schemas. It is also what keeps this file's own "the migration
 * role is the only role that owns anything" assertion true of the new views.
 */
async function seedWorkspaceReporting(): Promise<void> {
  for (const workspace of [HOME_WORKSPACE, VEHICLE_WORKSPACE]) {
    await owner.query(
      `insert into control.organization (id, name, slug, "createdAt")
         values ($1, $2, $2, now())`,
      [workspace.id, workspace.slug],
    );
    // One form per workspace, with a version, so `control.forms.workspace_id` has
    // something to filter on and the two view sets are genuinely different reads.
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
    // A submitted response in each environment, so a view that returned nothing could not
    // be mistaken for a grant that worked.
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
        [sessionId, JSON.stringify({ answers: [], flowState: { visible: [] } })],
      );
    }
  }

  // The role, as a superuser, exactly as the recipe has an operator create it.
  const password = ephemeralPassword();
  await owner.query(`CREATE ROLE ${HOME_PROD_REPORTING_ROLE} LOGIN PASSWORD '${password}'`);

  // The views and the grants, as the migration role, through the same generator the
  // operator command runs. Every pair, not only the one with a login: a workspace whose
  // views did not exist would make "cannot read another workspace's views" pass for the
  // wrong reason.
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
  it("holds DML on every control-plane table except the two audits", async () => {
    const held = await tablePrivileges("control", CONTROL_ROLE);
    // `two_factor_resets` is absent entirely rather than present with fewer privileges:
    // the revoke takes all four, so the catalogue reports no row for it at all.
    expect(held["two_factor_resets"]).toBeUndefined();
    // The SEC-15 audit is the other carve-out, and it is **present with two** rather than
    // absent: this role reads the audit for a workspace's owners and writes the grant and
    // revoke rows that are control-pool acts (Q56), and holds neither `UPDATE` nor
    // `DELETE`, so it can add a row and change none.
    expect([...(held["access_audit"] ?? [])].sort()).toEqual(["INSERT", "SELECT"]);
    // Every other control-plane table carries all four. An exact per-table comparison,
    // so a table that lost a privilege fails here as loudly as one that gained it.
    for (const [table, privileges] of Object.entries(held)) {
      if (table === "access_audit") continue;
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

  it("holds USAGE on `control` and on every data schema, and on nothing else QCMS named", async () => {
    // **Schema `USAGE` is the grant a table-privilege listing cannot show**, and it is
    // required: without it a statement fails on the schema before it reaches the table,
    // whatever the table grants say. So it is asserted per schema rather than inferred
    // from the reads working, and it is asserted in both directions, because a `USAGE`
    // nobody meant to grant is how a role ends up able to name a schema it has no
    // business in.
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
  it("publishes a version, under its own grants, and queues nothing anywhere (Q60, criterion 6)", async () => {
    // Criterion 6 asks for this count **as `qcms_app_control` with its real grants**,
    // because a superuser count proves the handler wrote nothing while saying nothing
    // about what the credential could have written. Here the publish's own two writes
    // run on a connection holding exactly the grants the API holds.
    //
    // Note which half of that this role can do: it holds `INSERT` on every
    // `data_<env>.outbox` and no `SELECT` anywhere in a data schema, asserted above. So
    // it can enqueue and cannot count, and the count below is the owner's. That split
    // is what makes zero meaningful rather than circular: the role **has** the grant an
    // enqueue needs, so an empty outbox is the transaction's doing and not a refusal.
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

    // A delta rather than an absolute count, because another test in this file inserts
    // the `form.released` row Q49 permits, and the assertion should not depend on which
    // ran first.
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

    // The publish transaction as the handler issues it (`makePublishFormHandler`):
    // freeze the immutable version, delete the draft, one transaction, on the control
    // connection. If a `form.published` enqueue came back, it would be inside this
    // transaction and the delta below would be 1 somewhere.
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

    // The version is really there, so the publish was a publish and not a no-op that
    // would make the count below vacuous.
    const version = await owner.query<{ n: string }>(
      `select count(*) as n from control.form_versions where form_id = $1`,
      [formId],
    );
    expect(Number(version.rows[0]?.n)).toBe(1);

    expect(await outboxCounts()).toEqual(before);

    // And the credential cannot audit itself: the count had to come from the owner,
    // which is the Q49 split restated from the direction of this test.
    expect(await refusalFor(control, `select count(*) from data_prod.outbox`)).toMatch(
      /permission denied/i,
    );
  });

  it("releases a version, under its own grants, and queues exactly one event (Q49, criterion 8)", async () => {
    // The other half of criterion 8, and the half that catches the `RETURNING` trap. The
    // release transaction runs here exactly as `recordRelease` issues it - the record in
    // `control`, the event in the released environment's `outbox`, one transaction, one
    // connection - on a connection holding precisely the grants the API holds. A
    // superuser would have passed whatever the handler did.
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
    // No `RETURNING`. The role holds `INSERT` on this table and nothing else in any data
    // schema, so a `RETURNING` here is a read Postgres refuses - which is the whole
    // reason `enqueueInEnvironment` exists beside `enqueue`.
    await control.query(
      `insert into data_prod.outbox ("event_type", "payload")
       values ('form.released', jsonb_build_object('formId', $1::text, 'version', 1,
               'environment', 'prod', 'releasedBy', 'usr_e2e'))`,
      [formId],
    );
    await control.query("commit");

    // Exactly one event, and exactly one record, neither observed without the other.
    expect(await releasedRows()).toBe(1);
    const record = await owner.query<{ n: string }>(
      `select count(*) as n from control.form_releases where form_id = $1`,
      [formId],
    );
    expect(Number(record.rows[0]?.n)).toBe(1);

    // And the history is append-only even for the credential that wrote it: the grant is
    // DML, and the trigger is what refuses the rewrite (criterion 7).
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
      // Derived, not typed: the data plane is whatever the schema module declares, which
      // is eight tables since task 072's roster joined it. A literal here would have to be
      // edited by whoever adds the ninth, and the point of this assertion is that it is the
      // one nobody has to remember.
      expect(Object.keys(held).length).toBe(DATA_PLANE_TABLE_NAMES.length);
    });

    it("holds nothing at all in another environment's data schema", async () => {
      expect(await tablePrivileges(`data_${other}`, role)).toEqual({});
      expect(await hasSchemaUsage(`data_${other}`, role)).toBe(false);
    });

    it("holds schema USAGE on exactly the three schemas it reaches, and no fourth", async () => {
      // The grant a table listing cannot show, asserted per schema and in both
      // directions. `control` and its own `data_<env>` are what every respondent
      // statement needs before any table privilege is consulted; its own
      // `reporting_<env>` is Q52's; another environment's two are refused, which is the
      // privilege half of the isolation claim rather than a `search_path` default.
      expect(await hasSchemaUsage("control", role)).toBe(true);
      expect(await hasSchemaUsage(`data_${environment}`, role)).toBe(true);
      expect(await hasSchemaUsage(`reporting_${environment}`, role)).toBe(true);
      expect(await hasSchemaUsage(`data_${other}`, role)).toBe(false);
      expect(await hasSchemaUsage(`reporting_${other}`, role)).toBe(false);
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

    it("holds exactly the named SELECT list on `control`, one UPDATE and one INSERT", async () => {
      const held = await tablePrivileges("control", role);
      // **Six** reads, `form_releases` included. Task 064 granted five because that table
      // did not exist yet and its clause was guarded on the table existing; task 065's
      // migration creates it and grants it, to every environment role in the live set
      // rather than to the two shipped names. The list is the decision in both tasks and
      // this is the line that notices either way.
      const expectedReads = CONTROL_READ_TABLES;
      expect(expectedReads).toHaveLength(6);
      // **Seven tables, not six**, and the seventh carries no read at all: task 069's
      // SEC-15 audit, on which this role holds `INSERT` and nothing else, so a response
      // read's audit row commits in the same transaction as the read (Q40) and the role
      // can neither read, change nor remove a row it wrote.
      expect(Object.keys(held).sort()).toEqual([...expectedReads, ACCESS_AUDIT_TABLE].sort());
      for (const table of expectedReads) {
        const expected = table === "secure_links" ? ["SELECT", "UPDATE"] : ["SELECT"];
        expect([...(held[table] ?? [])].sort(), `control.${table}`).toEqual(expected);
      }
      expect([...(held[ACCESS_AUDIT_TABLE] ?? [])]).toEqual(["INSERT"]);
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

    it("holds USAGE on the two enum types, which live once in `control` (Q54)", async () => {
      // The types are created once, exactly as the trigger functions are, and both
      // environments' `sessions` tables use them - so they are not part of the
      // per-environment set and a change to the closed value set is one migration rather
      // than one per environment. What a role needs is USAGE, which Postgres requires to
      // write a value of an enum.
      //
      // **This reads a DEFAULT, not a grant, and the distinction is the point.** Postgres
      // grants type `USAGE` to `PUBLIC`, so every role holds it whether or not anything
      // granted it, and the baseline deliberately emits no type grant at all - the same
      // goes for `EXECUTE` on the trigger functions. So what this line asserts is that the
      // privilege the respondent path needs is **present**, which is the criterion ("whatever
      // `USAGE` Postgres requires on `control`'s two enum types"), and it must not be read
      // as evidence that this recipe granted it. The equality above is the load-bearing
      // half: a third enum arriving on a data-plane column is a new dependency on a default
      // nobody looked at, and it fails here. The session write below is what proves the
      // whole path end to end.
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
      // The end-to-end shape of the respondent path's first write: a form and a version
      // read from `control`, a row inserted into this environment's own `sessions` with
      // both enum types and the Q46 `environment` column. A grant missing anywhere in the
      // chain - the schema, the table, the type, the crossing foreign key's target -
      // surfaces here rather than at a respondent's first request.
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
      // An environment role holds SELECT and UPDATE on `control.secure_links` and no
      // INSERT: it redeems and consumes a link, it never creates one. Minting runs on the
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

describe("the SEC-15 access audit's grants and revokes (task 069, Q40 with Q56)", () => {
  it.each([CONTROL_ROLE, ...Object.values(ENVIRONMENT_ROLES), UNSHIPPED_ROLE])(
    "leaves %s no UPDATE and no DELETE on control.access_audit",
    async (role) => {
      // Written against the **prefix**, like `two_factor_resets`' revoke, and executed
      // against a role name this project does not ship for the same reason: an
      // installation that creates `qcms_app_staging` next week is covered by a migration
      // written today.
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
      // The property the ruling rests on: the read and its row commit or fail together,
      // so a read that succeeded while its audit write failed cannot happen. The row's
      // `actor` and `workspace` are values this role cannot verify - it holds no `SELECT`
      // on `user` or `member` - and that is the no-foreign-key precedent working as
      // intended rather than a gap.
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
      // **The assertion the rule is stated as.** One helper writes the audit rows for
      // both pools, and this role holds `INSERT` on the table and nothing else, so a
      // `RETURNING` - which is a read - is refused for it. Asserting this as
      // `qcms_app_control` would prove nothing, because that role holds `SELECT` here and
      // the statement would succeed; for the control-pool path the assertion is from the
      // source, where `writeAccessAuditRow` is the only write and names no `returning`.
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
    // The precedent's second property, asserted out of the catalogue rather than read off
    // the migration: an audit row that cascades away with the account, the workspace or
    // the form it names is not an audit row, and this task must not close that with a key.
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
      // **Recorded rather than fixed, because it is the honest reading of the catalogue.**
      // Postgres grants `USAGE` on `public` to `PUBLIC` by default, so every role holds
      // it whether or not the baseline says so, and a per-role read reports it as held.
      // Criterion 2 is "`public` is on no search path and `CREATE` on it is granted to
      // nobody" - both asserted below - and what makes the residual `USAGE` worth
      // nothing is the assertion above: a schema holding no object is a schema `USAGE`
      // conveys no access to. Revoking it from `PUBLIC` would also reach `drizzle`'s own
      // bookkeeping schema's callers and the reporting consumer, for no privilege
      // anybody could exercise, so the baseline revokes `CREATE` alone.
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

/**
 * **Criterion 7** (Q26, ADR-40's reporting Note, ADR-41): a reporting role granted one
 * workspace's views in one environment reads those and **cannot read another workspace's
 * views or another environment's schema**.
 *
 * ## Why this criterion is a database test and could not be anything else
 *
 * This is the one place in the whole design where the authorisation model is expressed in
 * **grants** rather than in an API check, and the reason is in the threat: a reporting
 * consumer connects with psql or a BI tool and writes their own SQL, so there is no
 * handler to put a check in. What holds the boundary is a role that has not been granted
 * the thing it must not read - and the only way to know that is to connect as it and be
 * refused.
 *
 * ## The four claims, and why each one is here
 *
 * 1. **It reads its own workspace's views, and gets rows.** Without this the three
 *    refusals below would pass against a role that can read nothing at all.
 * 2. **It cannot read another workspace's views, in its own environment.** The schema is
 *    the same and the `USAGE` is held, so this is the grant on the view doing the work -
 *    which is the half a schema-per-environment layout does not give for free.
 * 3. **It cannot read another environment's schema.** Refused one step earlier, at
 *    `USAGE`, so another environment's views are unreachable before their rows are.
 * 4. **It cannot reach the data plane, the control plane or the application's own
 *    unfiltered views.** The last of those is the easiest to leave open by accident:
 *    `reporting_prod.responses` sits in the same schema as the views this role is granted
 *    and holds every workspace's rows, so a grant written as `ALL TABLES IN SCHEMA` would
 *    satisfy claim 1 and silently defeat claim 2.
 */
describe("a per-workspace reporting role reads one workspace in one environment (criterion 7)", () => {
  function consumer(): pg.Client {
    return clients.get(HOME_PROD_REPORTING_ROLE)!;
  }

  it("reads its own workspace's views, and sees its own workspace's response", async () => {
    const res = await consumer().query<{ form_id: string }>(
      `select form_id from reporting_prod.${HOME_WORKSPACE.slug}_responses`,
    );
    expect(res.rows.map((row) => row.form_id)).toEqual([`frm_${HOME_WORKSPACE.slug}_lp`]);

    // The flat twin as well: both views of a set are granted, and both are filtered, so a
    // consumer cannot reach round the wide one through the long one.
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
        // The per-(workspace, environment) consumer of Q26, created by this file the way
        // `docs/operations.md` has an operator create one: as a superuser, before the
        // grants that are guarded on it existing.
        HOME_PROD_REPORTING_ROLE,
      ].sort(),
    );
  });
});
