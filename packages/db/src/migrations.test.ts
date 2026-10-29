import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SHIPPED_ENVIRONMENTS } from "./environment/baseline.js";
import { environmentObjectNames } from "./environment/sql.js";
import { CONTROL_TABLE_NAMES } from "./schema/control/index.js";
import {
  DATA_PLANE_TABLE_NAMES,
  DATA_PLANE_TRIGGERS,
  SESSION_ENVIRONMENT_CHECK,
} from "./schema/data/index.js";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  SEED_WORKSPACE_ID,
  startTestDb,
  type TestDb,
} from "./testing/harness.js";

/** Requires Docker, like every container-backed file in this package. */

const DRIZZLE_JOURNAL_SCHEMA = "drizzle";

/**
 * Raised from Vitest's 5000 ms default: these bodies query a container the rest of this
 * package's Docker-backed files are booting at the same moment.
 */
const MIGRATION_STEP_TIMEOUT_MS = 30_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

async function tablesIn(schema: string): Promise<string[]> {
  const res = await testDb.client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE'`,
    [schema],
  );
  return res.rows.map((row) => row.table_name).sort();
}

async function triggerNamesOn(schema: string): Promise<string[]> {
  const res = await testDb.client.query<{ tgname: string }>(
    `select t.tgname from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and not t.tgisinternal`,
    [schema],
  );
  return res.rows.map((row) => row.tgname).sort();
}

async function constraintNamesOn(schema: string, kind: string): Promise<string[]> {
  const res = await testDb.client.query<{ conname: string }>(
    `select con.conname from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and con.contype = $2`,
    [schema, kind],
  );
  return res.rows.map((row) => row.conname).sort();
}

async function indexNamesOn(schema: string): Promise<string[]> {
  const res = await testDb.client.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = $1`,
    [schema],
  );
  return res.rows.map((row) => row.indexname).sort();
}

describe("@roonga/qcms-db migrations", { timeout: MIGRATION_STEP_TIMEOUT_MS }, () => {
  it("creates exactly the control-plane tables in `control`, and only those", async () => {
    expect(await tablesIn("control")).toEqual([...CONTROL_TABLE_NAMES].sort());
  });

  it.each(SHIPPED_ENVIRONMENTS)(
    "creates exactly the data-plane tables in data_%s, and only those",
    async (environment) => {
      expect(await tablesIn(`data_${environment}`)).toEqual([...DATA_PLANE_TABLE_NAMES].sort());
    },
  );

  it("leaves `public` holding no QCMS object at all (criterion 2)", async () => {
    expect(await tablesIn("public")).toEqual([]);
  });

  it("puts `public` on no search path and grants CREATE on it to nobody", async () => {
    const searchPath = await testDb.client.query<{ search_path: string }>(
      `select current_setting('search_path') as search_path`,
    );
    expect(searchPath.rows[0]?.search_path).not.toContain("public");

    const create = await testDb.client.query<{ has: boolean }>(
      `select has_schema_privilege('public', 'public', 'CREATE') as has`,
    );
    expect(create.rows[0]?.has).toBe(false);
  });

  it("keeps drizzle's own bookkeeping in its own schema", async () => {
    const res = await testDb.client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_schema = $1`,
      [DRIZZLE_JOURNAL_SCHEMA],
    );
    expect(res.rows[0]?.n).toBeGreaterThan(0);
  });

  it("installs the control-plane immutability triggers", async () => {
    expect(await triggerNamesOn("control")).toEqual([
      "form_releases_reject_delete",
      "form_releases_reject_update",
      "form_versions_reject_update",
      "question_versions_freeze_published",
      "release_workflow_revisions_reject_delete",
      "release_workflow_revisions_reject_update",
      "release_workflow_rules_reject_delete",
      "release_workflow_rules_reject_update",
    ]);
  });

  describe.each(SHIPPED_ENVIRONMENTS)("the per-environment set in data_%s", (environment) => {
    const expected = environmentObjectNames(environment);
    const schema = `data_${environment}`;

    it("carries every guard the data-plane module declares, and only those", async () => {
      // Postgres backs a UNIQUE constraint and a PRIMARY KEY with an index of the same
      // name, and the primary keys are not guards.
      const primaryKeys = new Set(await constraintNamesOn(schema, "p"));
      const guards = new Set([
        ...(await triggerNamesOn(schema)),
        ...(await constraintNamesOn(schema, "c")),
        ...(await constraintNamesOn(schema, "u")),
        ...(await indexNamesOn(schema)).filter((name) => !primaryKeys.has(name)),
      ]);
      expect([...guards].sort()).toEqual([...new Set(expected.guards)].sort());
    });

    it("carries every foreign key, each pointing at the schema it should", async () => {
      const res = await testDb.client.query<{ conname: string; target: string }>(
        `select con.conname, tn.nspname as target
           from pg_constraint con
           join pg_class c on c.oid = con.conrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_class tc on tc.oid = con.confrelid
           join pg_namespace tn on tn.oid = tc.relnamespace
          where n.nspname = $1 and con.contype = 'f'`,
        [schema],
      );
      const byName = new Map(res.rows.map((row) => [row.conname, row.target]));

      expect([...byName.keys()].sort()).toEqual([...expected.foreignKeys].sort());
      for (const name of expected.inPlaneForeignKeys) expect(byName.get(name)).toBe(schema);
      for (const name of expected.crossingForeignKeys) expect(byName.get(name)).toBe("control");
    });

    it("pins every session row to this schema and nowhere else (Q46)", async () => {
      const res = await testDb.client.query<{ definition: string }>(
        `select pg_get_constraintdef(con.oid) as definition
           from pg_constraint con
           join pg_class c on c.oid = con.conrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1 and con.conname = $2`,
        [schema, SESSION_ENVIRONMENT_CHECK],
      );
      expect(res.rows[0]?.definition).toContain(`'${environment}'`);
    });

    it("keeps this schema's `sessions.environment` NOT NULL, which is what makes it a guard", async () => {
      // A CHECK passes on NULL, and a composite foreign key under the default MATCH
      // SIMPLE is not checked at all when a referencing column is NULL.
      const res = await testDb.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = $1 and table_name = 'sessions' and column_name = 'environment'`,
        [schema],
      );
      expect(res.rows[0]?.is_nullable).toBe("NO");
    });

    it("runs each ledger trigger against the single function body in `control`", async () => {
      const res = await testDb.client.query<{ tgname: string; nspname: string }>(
        `select t.tgname, fn.nspname
           from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_proc p on p.oid = t.tgfoid
           join pg_namespace fn on fn.oid = p.pronamespace
          where n.nspname = $1 and not t.tgisinternal`,
        [schema],
      );
      expect(res.rows.map((row) => row.tgname).sort()).toEqual(
        DATA_PLANE_TRIGGERS.map((trigger) => trigger.name).sort(),
      );
      for (const row of res.rows) expect(row.nspname).toBe("control");
    });

    it("holds the environment's own reporting views and nothing else", async () => {
      const res = await testDb.client.query<{ table_name: string }>(
        `select table_name from information_schema.views where table_schema = $1`,
        [`reporting_${environment}`],
      );
      expect(res.rows.map((row) => row.table_name).sort()).toEqual(["answers_flat", "responses"]);
    });
  });

  describe("refuses the cross-environment session rather than merely declaring it (Q46)", () => {
    // With one shipped environment every refusal below would assert nothing, so this
    // throws at collection time rather than building `data_undefined`.
    const [homeEnvironment, foreignEnvironment] = SHIPPED_ENVIRONMENTS;
    if (homeEnvironment === undefined || foreignEnvironment === undefined) {
      throw new Error(
        "the thirteenth guard needs two shipped environments to compare, " +
          `and SHIPPED_ENVIRONMENTS names ${SHIPPED_ENVIRONMENTS.length}`,
      );
    }
    const homeSchema = `data_${homeEnvironment}`;
    const foreignSchema = `data_${foreignEnvironment}`;

    const FORM_ID = "q46-guard-form";
    const linkIdFor = (environment: string) => `q46-link-${environment}`;

    beforeAll(async () => {
      await testDb.client.query(
        `insert into control.forms (form_id, slug, workspace_id, default_locale)
         values ($1, $1, $2, 'en')`,
        [FORM_ID, SEED_WORKSPACE_ID],
      );
      await testDb.client.query(
        `insert into control.form_versions
           (form_id, version, definition, compiled, compiler_version,
            a2ui_spec_version, semantics_version)
         values ($1, 1, '{}'::jsonb, '{}'::jsonb, '0', '0', '0')`,
        [FORM_ID],
      );
      for (const environment of SHIPPED_ENVIRONMENTS) {
        await testDb.client.query(
          `insert into control.secure_links (link_id, form_id, expires_at, environment)
           values ($1, $2, now() + interval '1 day', $3)`,
          [linkIdFor(environment), FORM_ID, environment],
        );
      }
    }, CONTAINER_BOOT_TIMEOUT_MS);

    /** The constraint by name, because a row refused by the wrong guard reads as a pass. */
    async function attemptSession(
      schema: string,
      row: { sessionId: string; linkId: string | null; environment: string },
    ): Promise<{ code: string; constraint: string } | null> {
      try {
        await testDb.client.query(
          `insert into "${schema}".sessions
             (session_id, form_id, form_version, access_mode, link_id, environment, expires_at)
           values ($1, $2, 1, $3, $4, $5, now() + interval '1 hour')`,
          [
            row.sessionId,
            FORM_ID,
            row.linkId === null ? "anonymous" : "secure_link",
            row.linkId,
            row.environment,
          ],
        );
        return null;
      } catch (error) {
        const failure = error as { code?: string; constraint?: string };
        return { code: failure.code ?? "", constraint: failure.constraint ?? "" };
      }
    }

    it("refuses a session in one environment started from another environment's link", async () => {
      // 23503 is foreign_key_violation.
      const refusal = await attemptSession(homeSchema, {
        sessionId: "q46-foreign-link",
        linkId: linkIdFor(foreignEnvironment),
        environment: homeEnvironment,
      });
      expect(refusal).toEqual({ code: "23503", constraint: "sessions_secure_link_fk" });
    });

    it.each([
      ["carrying that environment's link", true],
      ["carrying no link at all", false],
    ])("refuses a row claiming another environment's name, %s", async (_label, withLink) => {
      // 23514 is check_violation. With a NULL `link_id`, MATCH SIMPLE skips the foreign
      // key entirely and the CHECK is the only guard left.
      const refusal = await attemptSession(homeSchema, {
        sessionId: `q46-claims-foreign-${withLink ? "linked" : "anonymous"}`,
        linkId: withLink ? linkIdFor(foreignEnvironment) : null,
        environment: foreignEnvironment,
      });
      expect(refusal).toEqual({ code: "23514", constraint: SESSION_ENVIRONMENT_CHECK });
    });

    it("accepts the anonymous session that carries its own environment", async () => {
      expect(
        await attemptSession(homeSchema, {
          sessionId: "q46-anonymous-home",
          linkId: null,
          environment: homeEnvironment,
        }),
      ).toBeNull();
    });

    it("accepts the secure session whose link, schema and environment all agree", async () => {
      expect(
        await attemptSession(foreignSchema, {
          sessionId: "q46-secure-foreign",
          linkId: linkIdFor(foreignEnvironment),
          environment: foreignEnvironment,
        }),
      ).toBeNull();
    });

    it("keeps `control.secure_links.environment` NOT NULL, the half the per-schema CHECK cannot reach", async () => {
      // A nullable column here would let a link match a session in any environment under
      // MATCH SIMPLE, and the CHECK lives on the referencing table.
      const res = await testDb.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = 'control' and table_name = 'secure_links'
            and column_name = 'environment'`,
      );
      expect(res.rows[0]?.is_nullable).toBe("NO");
    });

    it("keeps the unique key the composite foreign key references, by name", async () => {
      expect(await constraintNamesOn("control", "u")).toContain("secure_links_link_environment_uq");
    });
  });

  it("holds every environment the live set names, and no schema it does not", async () => {
    const rows = await testDb.client.query<{ name: string }>(
      `select name from control.environments order by position`,
    );
    expect(rows.rows.map((row) => row.name)).toEqual([...SHIPPED_ENVIRONMENTS]);

    const schemas = await testDb.client.query<{ nspname: string }>(
      `select nspname from pg_namespace where nspname like 'data\\_%'`,
    );
    expect(schemas.rows.map((row) => row.nspname).sort()).toEqual(
      SHIPPED_ENVIRONMENTS.map((environment) => `data_${environment}`).sort(),
    );
  });

  it("leaves `account` keyed on the provider pair, with no issuer column or index", async () => {
    // better-auth never writes `issuer` and refuses to boot against a `NOT NULL` column
    // it does not write.
    const columns = await testDb.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'control' and table_name = 'account'`,
    );
    const byName = new Map(columns.rows.map((row) => [row.column_name, row.is_nullable]));
    expect(byName.has("issuer")).toBe(false);
    expect(byName.get("accountId")).toBe("NO");
    expect(byName.get("providerId")).toBe("NO");
  });
});
