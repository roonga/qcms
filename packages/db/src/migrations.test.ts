import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SHIPPED_ENVIRONMENTS } from "./environment/baseline.js";
import { environmentObjectNames } from "./environment/sql.js";
import { CONTROL_TABLE_NAMES } from "./schema/control/index.js";
import {
  DATA_PLANE_TABLE_NAMES,
  DATA_PLANE_TRIGGERS,
  SESSION_ENVIRONMENT_CHECK,
} from "./schema/data/index.js";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "./testing/harness.js";

/**
 * A fresh database is created in the target shape (ADR-40, criteria 1, 1a, 2 and 8).
 *
 * ## What changed here, and why the shape of the assertion had to change with it
 *
 * This file used to compare one flat set of tables in `public` against a hand-kept
 * list. Under ADR-40 there is no flat set: the control plane is one copy in `control`
 * and the data plane is one copy per environment in `data_<env>`, so the list becomes
 * **a fixed table list per schema** (section 4a). Keeping it an **exact** comparison is
 * what keeps the test's original purpose, which is that a migration creating a table
 * nobody listed fails naming it (issue #861) - a subset check passes a table nobody
 * listed, which is how `two_factor_resets` went unlisted for two months.
 *
 * ## The lists are derived, not re-typed
 *
 * `CONTROL_TABLE_NAMES` and `DATA_PLANE_TABLE_NAMES` come from the two schema modules,
 * which is the same place the baseline and the environment command emit from. A second
 * hand-kept copy here would be a list that agrees with the schema until somebody
 * changed one of them, and the whole point of issue #861's assertion is that it is the
 * thing that notices.
 *
 * That also gives criterion 3a's disjointness as a by-product: a name in both modules
 * would appear in both schemas and the search path would resolve it to the
 * environment's copy with no error anywhere. `scripts/check-schema-disjoint.mjs` is the
 * cheap check that runs in CI without a container; this is the one that runs against
 * the database the migration actually built.
 */

/**
 * Drizzle's own migration journal: bookkeeping the migrator writes about itself, not
 * schema this package declares. The node-postgres migrator keeps it in the `drizzle`
 * schema, so it never reaches a per-schema assertion below.
 */
const DRIZZLE_JOURNAL_SCHEMA = "drizzle";

/**
 * The per-test budget for a body that talks to the container (issue #932).
 *
 * Vitest's 5000 ms default is sized for in-process work. Every test here issues
 * catalogue queries against a Postgres container that the rest of this package's
 * Docker-backed files are booting at the same moment, so its wall time tracks how busy
 * the daemon is rather than how much the assertion asks of it. 30 s is the figure
 * PR #937 gave the same class of work in this package, so a migration that genuinely
 * became pathological still fails here rather than passing slowly.
 */
const MIGRATION_STEP_TIMEOUT_MS = 30_000;

let testDb: TestDb;

beforeAll(async () => {
  // One container for the whole file. The baseline is the only migration there is, so
  // there is no "apply N, then N+1" path left to exercise on a container of its own.
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
    // The whole of what "public is left empty" means, asserted rather than assumed. A
    // table here would be reachable by an unqualified name on any connection whose
    // search path fell back to the default, which is the failure Q20 removed.
    expect(await tablesIn("public")).toEqual([]);
  });

  it("puts `public` on no search path and grants CREATE on it to nobody", async () => {
    const searchPath = await testDb.client.query<{ search_path: string }>(
      `select current_setting('search_path') as search_path`,
    );
    expect(searchPath.rows[0]?.search_path).not.toContain("public");

    // PostgreSQL 15 revokes this by default and the baseline states it anyway; what is
    // asserted is the outcome, on the database the migration built.
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
      "form_versions_reject_update",
      "question_versions_freeze_published",
    ]);
  });

  describe.each(SHIPPED_ENVIRONMENTS)("the per-environment set in data_%s", (environment) => {
    const expected = environmentObjectNames(environment);
    const schema = `data_${environment}`;

    it("carries every guard the data-plane module declares, and only those", async () => {
      // Criterion 1, the half whose absence is silent. An environment missing
      // `answers_reject_delete` has an erasable ledger and nothing anywhere says so, so
      // this is an exact set rather than a presence check per name.
      //
      // Postgres backs a UNIQUE constraint and a PRIMARY KEY with an index of the same
      // name, so a naive union double-counts the unique and adds the primary keys. The
      // primary keys ride `CREATE TABLE` and are not guards; the unique is one, counted
      // once.
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
      // Criterion 1a. The in-plane keys are the ones a generator gets wrong quietly:
      // written once against `data_test` and copied, they can end up pointing at
      // another environment's `sessions`, which is a cross-environment reference the
      // search path would never reveal. So the target schema is read back per key.
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
      // A CHECK passes when the column is NULL, and a composite foreign key under the
      // default MATCH SIMPLE is not checked at all when any referencing column is NULL.
      // So a nullable `environment` would skip both halves, and neither half's presence
      // would say so. The key's other end, `control.secure_links.environment`, is
      // asserted once below rather than once per environment, since there is one of it;
      // the refusals the pair actually produces are asserted there too.
      const res = await testDb.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = $1 and table_name = 'sessions' and column_name = 'environment'`,
        [schema],
      );
      expect(res.rows[0]?.is_nullable).toBe("NO");
    });

    it("runs each ledger trigger against the single function body in `control`", async () => {
      // The functions stay single so a fix to one is one edit rather than one per
      // environment. A trigger carrying its own copy would drift silently.
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

  /**
   * Criterion 1a's behavioural half: the thirteenth guard **refused a real insert**.
   *
   * Every other assertion in this file reads the catalogue, which proves the guard was
   * declared. None of them proves it bites. The two clauses criterion 1a states
   * (`plan/environments-and-workspaces.md`, criterion 1a) are about what the database
   * does to a row:
   *
   * - a session started in one environment from a link row naming another is refused;
   * - a public session with a NULL `link_id` still carries its environment and is
   *   still pinned by the CHECK.
   *
   * Both halves matter because each guard alone is satisfiable. The composite foreign
   * key is `MATCH SIMPLE`, so it is **not checked at all** when `link_id` is NULL,
   * which is every anonymous session; the CHECK is what pins those. And the CHECK only
   * compares the row against its own schema, so a link minted elsewhere is the foreign
   * key's job. A change that dropped `environment` from the composite key would leave
   * the catalogue assertions above passing while a `prod` link quietly started a `test`
   * session, which is the scenario these four inserts close.
   */
  describe("refuses the cross-environment session rather than merely declaring it (Q46)", () => {
    // Derived, not re-typed: the home environment is the first shipped one and the
    // foreign one is the second, so adding a third environment does not silently turn
    // this into a test of one schema against itself.
    //
    // Two is a real precondition rather than a type-checker formality: with one
    // environment there is no "another environment" to be refused from, and every
    // refusal below would be asserting nothing. So it throws at collection time instead
    // of defaulting to a name, which would build `data_undefined` and fail obscurely.
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
      // One form and one version, because `sessions_form_version_fk` has to be
      // satisfiable for the row to reach the guard under test. Then one link per
      // environment, which is what makes "a link naming another environment" a real
      // row rather than a dangling id.
      await testDb.client.query(
        `insert into control.forms (form_id, slug, default_locale)
         values ($1, $1, 'en')`,
        [FORM_ID],
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

    /**
     * Attempts one session insert and reports what the database said about it: `null`
     * when the row was accepted, or the SQLSTATE and the constraint that refused it.
     * Asserting the constraint by name and not just the class of error is the point -
     * a row refused by the wrong guard would otherwise read as a pass.
     */
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
      // The clause in full: the link row exists, is not expired and is not revoked, and
      // the only thing wrong with it is the environment it names. 23503 is
      // foreign_key_violation.
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
      // 23514 is check_violation. The second case is the one the foreign key cannot
      // catch: with a NULL `link_id`, MATCH SIMPLE skips the key entirely, so the CHECK
      // is the only thing standing between a `prod` row and the `test` schema.
      const refusal = await attemptSession(homeSchema, {
        sessionId: `q46-claims-foreign-${withLink ? "linked" : "anonymous"}`,
        linkId: withLink ? linkIdFor(foreignEnvironment) : null,
        environment: foreignEnvironment,
      });
      expect(refusal).toEqual({ code: "23514", constraint: SESSION_ENVIRONMENT_CHECK });
    });

    it("accepts the anonymous session that carries its own environment", async () => {
      // Criterion 1a's positive half, and the reason the CHECK cannot simply be
      // replaced by a stricter key: every public response starts life as this row.
      expect(
        await attemptSession(homeSchema, {
          sessionId: "q46-anonymous-home",
          linkId: null,
          environment: homeEnvironment,
        }),
      ).toBeNull();
    });

    it("accepts the secure session whose link, schema and environment all agree", async () => {
      // The other positive half, in the other schema, so a guard that refused
      // everything would fail here rather than read as four passes above.
      expect(
        await attemptSession(foreignSchema, {
          sessionId: "q46-secure-foreign",
          linkId: linkIdFor(foreignEnvironment),
          environment: foreignEnvironment,
        }),
      ).toBeNull();
    });

    it("keeps `control.secure_links.environment` NOT NULL, the half the per-schema CHECK cannot reach", async () => {
      // The sessions side of this is asserted per environment above. This is the other
      // end of the composite key: a nullable column here would let a link match a
      // session in any environment under MATCH SIMPLE, and no per-schema CHECK would
      // see it, because the CHECK lives on the referencing table.
      const res = await testDb.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = 'control' and table_name = 'secure_links'
            and column_name = 'environment'`,
      );
      expect(res.rows[0]?.is_nullable).toBe("NO");
    });

    it("keeps the unique key the composite foreign key references, by name", async () => {
      // A composite foreign key needs a unique constraint on exactly those columns to
      // reference. Dropping it does not fail quietly later; it fails the baseline. The
      // name is asserted because that is what a future migration would have to keep.
      expect(await constraintNamesOn("control", "u")).toContain("secure_links_link_environment_uq");
    });
  });

  it("holds every environment the live set names, and no schema it does not", async () => {
    // Criterion 1's other direction: `control.environments` is the source of the live
    // set and `data_%` is the consistency check, so the two agreeing is the assertion.
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
    // better-auth 1.7.7 recognizes an account by `(providerId, accountId)`, as 1.6 did,
    // and never writes `issuer` (issue #849). A `NOT NULL` column the library does not
    // write is not dead weight: it refuses to boot against one, so the shape of this
    // table is a startup precondition rather than tidiness. Asserted against a real
    // Postgres because that is what the running API meets; the Drizzle mirror it is
    // checked against is source, not evidence.
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
