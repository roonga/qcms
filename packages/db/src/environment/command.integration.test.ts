import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../testing/harness.js";

import {
  RESERVED_ENVIRONMENT_NAMES,
  createEnvironment,
  dropEnvironment,
  maxEnvironmentNameLength,
  ownsControlSchema,
  refuseEnvironmentName,
} from "./command.js";
import { environmentObjectNames } from "./sql.js";

/**
 * The environment command, against a real Postgres (criteria 4, 4a and 5).
 *
 * Criterion 5 is the one worth reading twice: **a third environment created by this
 * command is reached by every per-environment job without a code change**. What that
 * means in practice is that the environment the command creates is the same shape as
 * the two the baseline created, object for object, and that nothing about it is
 * special-cased anywhere. So the assertion is the derived set again, this time against a
 * schema no migration ever mentioned.
 */

const COMMAND_TIMEOUT_MS = 30_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the environment name rules (Q42)", { timeout: COMMAND_TIMEOUT_MS }, () => {
  it("accepts a lowercase alphanumeric name starting with a letter", () => {
    expect(refuseEnvironmentName("dev")).toBeUndefined();
    expect(refuseEnvironmentName("uat2")).toBeUndefined();
  });

  it("refuses a hyphen and an underscore, each for its own reason", () => {
    // The hyphen is the separator an access-group name joins a SET of environments
    // with, so `dev-test` has to read as two names. The underscore is the separator
    // `data_<env>` and `reporting_<env>` join on, so `data_my_env` would be ambiguous
    // about where the prefix ends. Both are asserted, because a rule tested only
    // through one of its cases is a rule half of which can be deleted unnoticed.
    expect(refuseEnvironmentName("dev-test")).toMatch(/no hyphen and no underscore/);
    expect(refuseEnvironmentName("my_env")).toMatch(/no hyphen and no underscore/);
  });

  it("refuses a leading digit, an upper-case letter and an empty name", () => {
    expect(refuseEnvironmentName("2dev")).toBeDefined();
    expect(refuseEnvironmentName("Dev")).toBeDefined();
    expect(refuseEnvironmentName("")).toBeDefined();
  });

  it("refuses a name too long for the LONGEST derived identifier, not for data_<env>", () => {
    // The distinction is the whole of the rule. A name of 58 bytes fits `data_<env>`
    // at 63 and does not fit `reporting_<env>` at 68, and Postgres would truncate the
    // second silently - producing an object whose name is not the one anybody asked
    // for, and two of which could collide with each other with no error anywhere.
    const limit = maxEnvironmentNameLength();
    const fits = "e".repeat(limit);
    const overflows = "e".repeat(limit + 1);
    expect(refuseEnvironmentName(fits)).toBeUndefined();
    expect(refuseEnvironmentName(overflows)).toBeDefined();
    // And it fits `data_<env>`, which is what makes this a test of the derivation
    // rather than of any length check at all.
    expect(`data_${overflows}`.length).toBeLessThanOrEqual(63);
  });

  it("names the derived identifier that would not fit, rather than a bare number", () => {
    // An operator who has been refused needs to know what to shorten.
    const refusal = refuseEnvironmentName("e".repeat(maxEnvironmentNameLength() + 1));
    expect(refusal).toMatch(/reporting_/);
  });

  it("computes the limit from the prefix list rather than reading a constant", () => {
    // 63 minus the longest of `data_`, `reporting_` and `qcms_app_`, which is
    // `reporting_` at ten. The figure is asserted as the arithmetic, so adding a longer
    // prefix moves it here and in the command together.
    expect(maxEnvironmentNameLength()).toBe(63 - "reporting_".length);
  });

  it.each(RESERVED_ENVIRONMENT_NAMES.filter((name) => /^[a-z][a-z0-9]*$/.test(name)))(
    "refuses the reserved name %s",
    (name) => {
      expect(refuseEnvironmentName(name)).toMatch(/reserved/);
    },
  );
});

describe("creating an environment", { timeout: COMMAND_TIMEOUT_MS }, () => {
  it("builds the same object set the baseline built, in a schema no migration names", async () => {
    const created = await createEnvironment(testDb.db, { name: "dev" });
    expect(created.schema).toBe("data_dev");
    expect(created.role).toBe("qcms_app_dev");

    const expected = environmentObjectNames("dev");
    const tables = await testDb.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'data_dev' and table_type = 'BASE TABLE'`,
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([...expected.tables].sort());

    const foreignKeys = await testDb.client.query<{ conname: string; target: string }>(
      `select con.conname, tn.nspname as target
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_class tc on tc.oid = con.confrelid
         join pg_namespace tn on tn.oid = tc.relnamespace
        where n.nspname = 'data_dev' and con.contype = 'f'`,
    );
    const byName = new Map(foreignKeys.rows.map((row) => [row.conname, row.target]));
    expect([...byName.keys()].sort()).toEqual([...expected.foreignKeys].sort());
    // The half a generator gets wrong quietly: an in-plane key that ended up pointing
    // at another environment's `sessions` would be a cross-environment reference the
    // search path would never reveal.
    for (const name of expected.inPlaneForeignKeys) expect(byName.get(name)).toBe("data_dev");
    for (const name of expected.crossingForeignKeys) expect(byName.get(name)).toBe("control");

    const check = await testDb.client.query<{ definition: string }>(
      `select pg_get_constraintdef(con.oid) as definition
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'data_dev' and con.conname = 'sessions_environment_matches'`,
    );
    expect(check.rows[0]?.definition).toContain("'dev'");

    const views = await testDb.client.query<{ table_name: string }>(
      `select table_name from information_schema.views where table_schema = 'reporting_dev'`,
    );
    expect(views.rows.map((row) => row.table_name).sort()).toEqual(["answers_flat", "responses"]);
  });

  it("appends to the live set, after the environments already there", async () => {
    const rows = await testDb.client.query<{ name: string; position: number }>(
      `select name, position from control.environments order by position`,
    );
    expect(rows.rows.map((row) => row.name)).toEqual(["test", "prod", "dev"]);
  });

  it("refuses a second environment of the same name", async () => {
    await expect(createEnvironment(testDb.db, { name: "dev" })).rejects.toThrow(/already exists/);
  });

  it("refuses a reserved name before it opens a transaction", async () => {
    await expect(createEnvironment(testDb.db, { name: "control" })).rejects.toThrow(/reserved/);
  });
});

describe("dropping an environment (Q24, Q43)", { timeout: COMMAND_TIMEOUT_MS }, () => {
  it("refuses prod unconditionally, even when it is empty", async () => {
    const refusal = await dropEnvironment(testDb.db, "prod");
    expect(refusal?.reason).toMatch(/can never be dropped/);
    const still = await testDb.client.query(
      `select 1 from pg_namespace where nspname = 'data_prod'`,
    );
    expect(still.rowCount).toBe(1);
  });

  it("refuses while the environment holds a session, naming the count and the open form", async () => {
    await testDb.client.query(
      `insert into control.forms (form_id, slug, default_locale) values ('frm_drop', 'drop', 'en')`,
    );
    await testDb.client.query(
      `insert into control.form_versions
         (form_id, version, definition, compiled, compiler_version, a2ui_spec_version, semantics_version)
       values ('frm_drop', 1, '{}'::jsonb, '{}'::jsonb, '0.0.0', '0.0.0', '0.0.0')`,
    );
    await testDb.client.query(
      `insert into data_dev.sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ('ses_drop', 'frm_drop', 1, 'anonymous', 'dev', now() + interval '1 day')`,
    );

    const refusal = await dropEnvironment(testDb.db, "dev");
    // Not a bare refusal: an operator who has been refused needs to know what to do
    // next, so the count and the forms are in the message as well as on the object.
    expect(refusal?.sessionCount).toBe(1);
    expect(refusal?.openForms).toEqual(["frm_drop"]);
    expect(refusal?.reason).toContain("frm_drop");
    expect(refusal?.reason).toContain("1 session");
  });

  it("succeeds once the environment is closed and empty, and removes it from the live set", async () => {
    // Through the sanctioned door: the session is deleted the way retention deletes
    // one, not by dropping the schema out from under it.
    await testDb.client.query(`delete from data_dev.sessions where session_id = 'ses_drop'`);
    expect(await dropEnvironment(testDb.db, "dev")).toBeUndefined();

    const schemas = await testDb.client.query(
      `select 1 from pg_namespace where nspname in ('data_dev', 'reporting_dev')`,
    );
    expect(schemas.rowCount).toBe(0);
    const rows = await testDb.client.query<{ name: string }>(
      `select name from control.environments order by position`,
    );
    expect(rows.rows.map((row) => row.name)).toEqual(["test", "prod"]);
  });

  it("refuses an environment that does not exist", async () => {
    await expect(dropEnvironment(testDb.db, "nosuch")).rejects.toThrow(/does not exist/);
  });
});

describe("the SEC-10 guard", { timeout: COMMAND_TIMEOUT_MS }, () => {
  it("reads ownership of the control schema rather than a role name", async () => {
    // The harness migrates as the container's superuser, which owns everything, so the
    // guard passes here. The refusal is asserted from the other side in
    // `apps/api/e2e/security/03-db-least-privilege.e2e.ts`, where a real application
    // role exists to be refused; the property this pins is that the guard reads
    // OWNERSHIP, which is what survives a deployment renaming its roles.
    const connected = await ownsControlSchema(testDb.db);
    expect(connected.owns).toBe(true);
    expect(connected.role).not.toBe("");
  });

  it("refuses a role that owns nothing", async () => {
    await testDb.client.query(`create role qcms_app_probe nologin`);
    const probe = await testDb.db.execute<{ owns: boolean }>(
      sql`select coalesce(bool_or(pg_catalog.pg_has_role('qcms_app_probe', n.nspowner, 'USAGE')), false) as owns
            from pg_catalog.pg_namespace n where n.nspname = 'control'`,
    );
    expect(probe.rows[0]?.owns).toBe(false);
  });
});
