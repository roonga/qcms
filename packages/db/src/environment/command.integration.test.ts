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
    // The distinction is the whole of the rule. A name one byte over the limit still
    // fits `data_<env>` and does not fit the longest identifier the name reaches, which
    // since task 067 is the per-(workspace, environment) reporting role's
    // `qcms_reporting_<env>_<slug>` (Q26). Postgres would truncate that one silently,
    // producing an object whose name is not the one anybody asked for, and two of which
    // could collide with each other with no error anywhere.
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
    // 63 minus the longest of `data_`, `reporting_`, `qcms_app_` and - since task 067
    // named the per-(workspace, environment) reporting consumer role (Q26) -
    // `qcms_reporting_` at fifteen. So the limit is **48** where it was 53, which is
    // exactly what ADR-40 said would happen when this task named its prefix. The figure
    // is asserted as the arithmetic, which is why adding the fourth prefix moved it here
    // and in the command together and nowhere else.
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
    // The application's own unprefixed pair (Q52, this task's), **and** the seeded
    // workspace's set beside it (Q26, task 067): a new environment arrives with every
    // existing workspace's views already in it, because there is no `ALTER DEFAULT
    // PRIVILEGES` in this design and an object a later environment needs has to be
    // emitted by whatever creates the environment. The harness seeds one workspace,
    // `default`, so one set is what this expects.
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
    // **A gap task 067 closed.** 064 created these columns and this argument, 066 reads
    // the challenge provider and 067 reads the two retention windows - and nothing was
    // passing any of them, because the CLI had no flags for them. A column no command can
    // write is a feature an operator cannot use.
    await createEnvironment(testDb.db, {
      name: "settings",
      settings: {
        challengeProvider: "turnstile",
        // `0` is a supported setting and means "at the next sweep", so it has to survive
        // as a value rather than being read as absent.
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

    // And an environment created with none of them has `NULL` in all three, which is what
    // "the installation-wide typed value stands" is stored as.
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

    // Dropped again: this file shares one container and two later assertions read the live
    // set by name.
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
    // **A gap task 067 closed rather than a case 064 wrote.** The `--password` path had no
    // test behind it, and it could not have worked: it built `CREATE ROLE` inside a `DO`
    // block whose body is a dollar-quoted string literal, so the `$1` placeholders in it
    // were text and the driver's bind failed outright. The quoting is Postgres's own now
    // (`./role.ts`), and this is the assertion that says so.
    //
    // A generated throwaway credential, never a committed one, and it is never printed:
    // what is asserted is the role's existence and its ability to log in.
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

    // Dropped again, because this file shares one container and two later assertions read
    // the live set by name. The role outlives it, which is correct: roles are
    // cluster-level and the operator's, and `dropEnvironment` deliberately removes only
    // the schemas (`dropEnvironmentStatements` says why).
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
      // `workspace_id` names the workspace the harness seeds after migrating (task 068):
      // the column is `NOT NULL` with no default, so a fixture form has to belong to one.
      `insert into control.forms (form_id, slug, workspace_id, default_locale)
         values ('frm_drop', 'drop', $1, 'en')`,
      [SEED_WORKSPACE_ID],
    );
    await testDb.client.query(
      `insert into control.form_versions
         (form_id, version, definition, compiled, compiler_version, a2ui_spec_version, semantics_version)
       values ('frm_drop', 1, '{}'::jsonb, '{}'::jsonb, '0.0.0', '0.0.0', '0.0.0')`,
    );
    // A session in `dev` with nothing released there: the refusal below is about `rel`,
    // and this is what keeps the success case further down a real drop of a non-empty
    // environment emptied through the sanctioned door.
    await testDb.client.query(
      `insert into data_dev.sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ('ses_drop', 'frm_drop', 1, 'anonymous', 'dev', now() + interval '1 day')`,
    );
    // Released to `dev` and not closed there, which is what "open in this environment"
    // means since task 066 (Q18): the state is the newest `form_releases` row for the
    // pair, not a column on the form. The release goes into an environment of its own
    // rather than into `dev`, because a release record pins the environment row it names
    // and would make `dev` undroppable for the case below - see that case.
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
    // Not a bare refusal: an operator who has been refused needs to know what to do
    // next, so the count and the forms are in the message as well as on the object.
    expect(refusal?.sessionCount).toBe(1);
    expect(refusal?.openForms).toEqual(["frm_drop"]);
    expect(refusal?.reason).toContain("frm_drop");
    expect(refusal?.reason).toContain("1 session");
  });

  it("refuses an environment anything was ever released to, even once it is empty", async () => {
    // **A consequence of 065's schema rather than a rule anybody wrote, and recorded here
    // because it narrows ADR-40's drop rule in practice.**
    // `control.form_releases.environment` is a foreign key into `control.environments`,
    // and the history rejects DELETE (`form_releases_reject_delete`), so deleting the
    // environment row violates that key and there is no sanctioned door to the rows
    // holding it. An environment anybody released into is therefore undroppable - which
    // is most environments that were used at all.
    //
    // What this task changed is only how the refusal READS: the count turns a foreign-key
    // violation into a sentence an operator can act on. Whether such an environment
    // should be droppable at all is a question for the record, not for this command.
    await testDb.client.query(`delete from data_rel.sessions where session_id = 'ses_rel'`);
    const refusal = await dropEnvironment(testDb.db, "rel");
    expect(refusal?.sessionCount).toBe(0);
    expect(refusal?.releaseCount).toBe(1);
    expect(refusal?.reason).toMatch(/append-only/);
    // And the schema is still there, which is the half that matters: a refusal that had
    // dropped half of it would be worse than the violation it replaced.
    const still = await testDb.client.query(
      `select 1 from pg_namespace where nspname = 'data_rel'`,
    );
    expect(still.rowCount).toBe(1);
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
    // `rel` is still there, and permanently: the case above is why.
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
    /**
     * The clause Q44 moved here from task 064, because a team carrying an `environments`
     * field exists only from task 069.
     *
     * The drop **refuses** while any access group names the environment, and **names
     * those groups** the way `dev:seed:clear` names what it leaves, so an operator sees
     * which grants the drop would silence rather than discovering it afterwards. It
     * refuses and never archives (Q43): a command that quietly re-scoped a grant an owner
     * wrote would be editing the authorisation model as a side effect of an operator act.
     */
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
      // The **derived** full name, `<workspace>.<team>`, which is what an operator reads
      // in a cross-workspace list and what the directory name at task C3 is built from.
      // Neither derived form is stored.
      expect(refusal?.reason).toContain("default.scratch.responses.viewer");
      expect(refusal?.reason).toContain("Remove or re-scope");
      // It holds no session and no open form, so the group is the only reason.
      expect(refusal?.sessionCount).toBe(0);
      expect(refusal?.openForms).toEqual([]);
      // And it refuses rather than archiving: the group is exactly as it was.
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

      // Re-scoped rather than removed, which is the operator's other way out.
      await updateAccessGroupScope(testDb.db, group.teamId, {
        name: "prod.responses.eraser",
        environments: ["prod"],
        forms: ["all"],
        updatedAt: new Date("2026-10-17T00:00:00.000Z"),
      });
      expect(await dropEnvironment(testDb.db, "scratchtwo")).toBeUndefined();
    });

    it("does not block on a group scoped to `all`, which names no environment", async () => {
      // `all` names no environment, so dropping one narrows what `all` means rather than
      // silencing that grant - which is what `all` is for, and the same line Q61 draws
      // where a grant scoped to `all` leaves the audit row's `environment` empty.
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
