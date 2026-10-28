import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  SEED_WORKSPACE_ID,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";

import {
  createAccessGroup,
  deleteAccessGroup,
  getAccessGroup,
  listAccessGroups,
  updateAccessGroupScope,
} from "../queries/grants.js";

import { WORKSPACE_REPORTING_ROLE_PREFIX } from "../schema/schemas.js";

import {
  RESERVED_ENVIRONMENT_NAMES,
  createEnvironment,
  dropEnvironment,
  maxEnvironmentNameLength,
  ownsControlSchema,
  refuseEnvironmentName,
} from "./command.js";
import { environmentObjectNames } from "./sql.js";

/** Requires Docker, like every `*.integration.test.ts`. */

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
    expect(refuseEnvironmentName("dev-test")).toMatch(/no hyphen and no underscore/);
    expect(refuseEnvironmentName("my_env")).toMatch(/no hyphen and no underscore/);
  });

  it("refuses a leading digit, an upper-case letter and an empty name", () => {
    expect(refuseEnvironmentName("2dev")).toBeDefined();
    expect(refuseEnvironmentName("Dev")).toBeDefined();
    expect(refuseEnvironmentName("")).toBeDefined();
  });

  it("refuses a name too long for the LONGEST derived identifier, not for data_<env>", () => {
    // Postgres truncates an over-long identifier silently, so two could collide.
    const limit = maxEnvironmentNameLength();
    const fits = "e".repeat(limit);
    const overflows = "e".repeat(limit + 1);
    expect(refuseEnvironmentName(fits)).toBeUndefined();
    expect(refuseEnvironmentName(overflows)).toBeDefined();
    expect(`data_${overflows}`.length).toBeLessThanOrEqual(63);
  });

  it("names the derived identifier that would not fit, rather than a bare number", () => {
    const refusal = refuseEnvironmentName("e".repeat(maxEnvironmentNameLength() + 1));
    expect(refusal).toMatch(/reporting_/);
  });

  it("computes the limit from the prefix list rather than reading a constant", () => {
    expect(maxEnvironmentNameLength()).toBe(63 - WORKSPACE_REPORTING_ROLE_PREFIX.length);
    expect(maxEnvironmentNameLength()).toBe(48);
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
    expect(views.rows.map((row) => row.table_name).sort()).toEqual([
      "answers_flat",
      "default_answers_flat",
      "default_responses",
      "responses",
    ]);
  });

  it("appends to the live set, after the environments already there", async () => {
    const rows = await testDb.client.query<{ name: string; position: number }>(
      `select name, position from control.environments order by position`,
    );
    expect(rows.rows.map((row) => row.name)).toEqual(["test", "prod", "dev"]);
  });

  it("writes the per-environment settings an operator passes (Q11)", async () => {
    await createEnvironment(testDb.db, {
      name: "settings",
      settings: {
        challengeProvider: "turnstile",
        deliverySnippetTtlMs: 0,
        outboxPayloadTtlMs: 86_400_000,
      },
    });
    const row = await testDb.client.query<{
      challenge_provider: string | null;
      delivery_snippet_ttl_ms: string | null;
      outbox_payload_ttl_ms: string | null;
    }>(
      `select challenge_provider, delivery_snippet_ttl_ms, outbox_payload_ttl_ms
         from control.environments where name = 'settings'`,
    );
    expect(row.rows[0]?.challenge_provider).toBe("turnstile");
    expect(Number(row.rows[0]?.delivery_snippet_ttl_ms)).toBe(0);
    expect(Number(row.rows[0]?.outbox_payload_ttl_ms)).toBe(86_400_000);

    await createEnvironment(testDb.db, { name: "nosettings" });
    const bare = await testDb.client.query<{
      challenge_provider: string | null;
      delivery_snippet_ttl_ms: string | null;
      outbox_payload_ttl_ms: string | null;
    }>(
      `select challenge_provider, delivery_snippet_ttl_ms, outbox_payload_ttl_ms
         from control.environments where name = 'nosettings'`,
    );
    expect(bare.rows[0]).toEqual({
      challenge_provider: null,
      delivery_snippet_ttl_ms: null,
      outbox_payload_ttl_ms: null,
    });

    // One container for the file, and later assertions read the live set by name.
    expect(await dropEnvironment(testDb.db, "settings")).toBeUndefined();
    expect(await dropEnvironment(testDb.db, "nosettings")).toBeUndefined();
  });

  it("refuses a second environment of the same name", async () => {
    await expect(createEnvironment(testDb.db, { name: "dev" })).rejects.toThrow(/already exists/);
  });

  it("refuses a reserved name before it opens a transaction", async () => {
    await expect(createEnvironment(testDb.db, { name: "control" })).rejects.toThrow(/reserved/);
  });

  it("creates the environment's login role when it is given a credential", async () => {
    // A generated throwaway credential, never a committed one, and never printed.
    const password = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const created = await createEnvironment(testDb.db, { name: "withrole", password });
    expect(created.role).toBe("qcms_app_withrole");

    const role = await testDb.client.query<{ rolcanlogin: boolean }>(
      `select rolcanlogin from pg_roles where rolname = $1`,
      [created.role],
    );
    expect(role.rows[0]?.rolcanlogin, "the role exists and can log in").toBe(true);

    // One container for the file, and later assertions read the live set by name.
    expect(await dropEnvironment(testDb.db, "withrole")).toBeUndefined();
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
      `insert into control.forms (form_id, slug, workspace_id, default_locale)
         values ('frm_drop', 'drop', $1, 'en')`,
      [SEED_WORKSPACE_ID],
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
    // Not `dev`: a release record pins its environment row, making that one undroppable.
    await createEnvironment(testDb.db, { name: "rel" });
    await testDb.client.query(
      `insert into control.form_releases
         (form_id, environment, version, sequence, released_by)
       values ('frm_drop', 'rel', 1, 1, 'usr_fixture')`,
    );
    await testDb.client.query(
      `insert into data_rel.sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ('ses_rel', 'frm_drop', 1, 'anonymous', 'rel', now() + interval '1 day')`,
    );

    const refusal = await dropEnvironment(testDb.db, "rel");
    expect(refusal?.sessionCount).toBe(1);
    expect(refusal?.openForms).toEqual(["frm_drop"]);
    expect(refusal?.reason).toContain("frm_drop");
    expect(refusal?.reason).toContain("1 session");
  });

  it("refuses an environment anything was ever released to, even once it is empty", async () => {
    // `form_releases` rejects DELETE and its environment is a foreign key, so an
    // environment anything was released into is permanently undroppable.
    await testDb.client.query(`delete from data_rel.sessions where session_id = 'ses_rel'`);
    const refusal = await dropEnvironment(testDb.db, "rel");
    expect(refusal?.sessionCount).toBe(0);
    expect(refusal?.releaseCount).toBe(1);
    expect(refusal?.reason).toMatch(/append-only/);
    const still = await testDb.client.query(
      `select 1 from pg_namespace where nspname = 'data_rel'`,
    );
    expect(still.rowCount).toBe(1);
  });

  it("succeeds once the environment is closed and empty, and removes it from the live set", async () => {
    await testDb.client.query(`delete from data_dev.sessions where session_id = 'ses_drop'`);
    expect(await dropEnvironment(testDb.db, "dev")).toBeUndefined();

    const schemas = await testDb.client.query(
      `select 1 from pg_namespace where nspname in ('data_dev', 'reporting_dev')`,
    );
    expect(schemas.rowCount).toBe(0);
    const rows = await testDb.client.query<{ name: string }>(
      `select name from control.environments order by position`,
    );
    expect(rows.rows.map((row) => row.name)).toEqual(["test", "prod", "rel"]);
  });

  it("refuses an environment that does not exist", async () => {
    await expect(dropEnvironment(testDb.db, "nosuch")).rejects.toThrow(/does not exist/);
  });
});

describe(
  "the access-group half of the drop check (criterion 18, Q43 and Q44)",
  { timeout: COMMAND_TIMEOUT_MS },
  () => {
    it("refuses while a group names the environment, and names it by its derived full name", async () => {
      await createEnvironment(testDb.db, { name: "scratch" });
      const group = await createAccessGroup(testDb.db, {
        workspaceId: SEED_WORKSPACE_ID,
        name: "scratch.responses.viewer",
        role: "responses.viewer",
        environments: ["scratch"],
        forms: ["all"],
      });

      const refusal = await dropEnvironment(testDb.db, "scratch");
      expect(refusal?.accessGroups).toEqual(["default.scratch.responses.viewer"]);
      expect(refusal?.reason).toContain("default.scratch.responses.viewer");
      expect(refusal?.reason).toContain("Remove or re-scope");
      expect(refusal?.sessionCount).toBe(0);
      expect(refusal?.openForms).toEqual([]);
      const after = await getAccessGroup(testDb.db, group.teamId);
      expect([...(after?.environments ?? [])]).toEqual(["scratch"]);
    });

    it("succeeds once the group is removed", async () => {
      const groups = await listAccessGroups(testDb.db, SEED_WORKSPACE_ID);
      const naming = groups.find((group) => group.name === "scratch.responses.viewer");
      expect(naming).toBeDefined();
      await deleteAccessGroup(testDb.db, (naming as { teamId: string }).teamId);
      expect(await dropEnvironment(testDb.db, "scratch")).toBeUndefined();
    });

    it("succeeds once the group is re-scoped off the environment", async () => {
      await createEnvironment(testDb.db, { name: "scratchtwo" });
      const group = await createAccessGroup(testDb.db, {
        workspaceId: SEED_WORKSPACE_ID,
        name: "scratchtwo.responses.eraser",
        role: "responses.eraser",
        environments: ["scratchtwo"],
        forms: ["all"],
      });
      expect((await dropEnvironment(testDb.db, "scratchtwo"))?.accessGroups).toHaveLength(1);

      await updateAccessGroupScope(testDb.db, group.teamId, {
        name: "prod.responses.eraser",
        environments: ["prod"],
        forms: ["all"],
        updatedAt: new Date("2026-10-17T00:00:00.000Z"),
      });
      expect(await dropEnvironment(testDb.db, "scratchtwo")).toBeUndefined();
    });

    it("does not block on a group scoped to `all`, which names no environment", async () => {
      await createEnvironment(testDb.db, { name: "scratchthree" });
      await createAccessGroup(testDb.db, {
        workspaceId: SEED_WORKSPACE_ID,
        name: "all.forms.viewer",
        role: "forms.viewer",
        environments: ["all"],
        forms: ["all"],
      });
      expect(await dropEnvironment(testDb.db, "scratchthree")).toBeUndefined();
    });
  },
);

describe("the SEC-10 guard", { timeout: COMMAND_TIMEOUT_MS }, () => {
  it("reads ownership of the control schema rather than a role name", async () => {
    // The harness is a superuser, so the refusal side is asserted in
    // `apps/api/e2e/security/03-db-least-privilege.e2e.ts`.
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
