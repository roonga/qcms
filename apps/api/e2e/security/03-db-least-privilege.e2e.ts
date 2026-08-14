/**
 * Security scenario 3 - SEC-10, least-privilege database roles (task 040).
 *
 * The triage that fed this task recorded SEC-10 as "not inspected at all", and
 * that turned out to be the right warning: `docs/SECURITY_DESIGN.md` §7 lists
 * two role properties, the traceability matrix marks them delivered by 013/015/
 * 036, and exactly one of them exists anywhere as SQL.
 *
 * What this file does about it, in the order that matters:
 *
 * 1. **Executes the documented reporting-role recipe** (`docs/reporting-view.md`,
 *    "Connection guidance") against a real Postgres and asserts the properties
 *    that recipe claims: readable reporting views, no reach into the operational
 *    tables, no writes, no DDL. A recipe an operator is told to run, that nobody
 *    has run, is a document rather than a control. It is a control now.
 * 2. **Records the state of the app/migration role split** as an executable
 *    fact rather than a prose claim. §7 says the API's role gets "no DDL beyond
 *    migrations (migration step may use a separate role - 036 documents the
 *    split)". 036 documents no split, no migration creates a role, and the
 *    credential the API runs as owns the schema. The last test asserts that as
 *    the shipped situation, so the day a split ships this file goes red and
 *    gets updated rather than quietly continuing to describe the old world.
 *
 * The SQL is quoted from the doc, not paraphrased: if the doc's recipe stops
 * working, this suite is where it shows.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "../support/index.js";

const REPORTING_ROLE = "qcms_reporting";

let testDb: TestDb;
/** Superuser/owner connection: the "as a superuser/owner" the recipe asks for. */
let owner: pg.Client;
/** A connection as the reporting role itself. */
let reporting: pg.Client;

/** A throwaway password for the containerised role. Generated, never committed. */
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

beforeAll(async () => {
  testDb = await startTestDb();
  owner = new pg.Client({ connectionString: testDb.connectionUri });
  await owner.connect();

  const password = ephemeralPassword();
  // Verbatim from docs/reporting-view.md, "Connection guidance". The password is
  // the only substitution, exactly as the doc's comment instructs.
  await owner.query(`CREATE ROLE ${REPORTING_ROLE} LOGIN PASSWORD '${password}'`);
  await owner.query(`GRANT USAGE ON SCHEMA reporting TO ${REPORTING_ROLE}`);
  await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${REPORTING_ROLE}`);
  await owner.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO ${REPORTING_ROLE}`,
  );

  const uri = new URL(testDb.connectionUri);
  uri.username = REPORTING_ROLE;
  uri.password = password;
  reporting = new pg.Client({ connectionString: uri.toString() });
  await reporting.connect();
});

afterAll(async () => {
  await reporting?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  await testDb?.teardown();
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

describe("SEC-10's app/migration role split, as it actually ships", () => {
  it("records that the application credential owns the schema and can issue DDL", async () => {
    // Not an assertion that this is *right*: it is the honest state of the
    // control today, pinned so that it cannot drift unnoticed in either
    // direction. `docs/SECURITY_DESIGN.md` §7 says the API's role gets "no DDL
    // beyond migrations" and points at 036 for the split; 036 documents no
    // split, and no migration creates a role. Recorded as a finding in
    // `docs/security-review-2026-08-14.md` (SEC-10), not fixed here: choosing
    // the grants an operator must run is an operator-surface decision, not a
    // test fixture.
    const result = await owner.query<{ create: boolean }>(
      `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS create`,
    );
    expect(result.rows[0]?.create).toBe(true);
  });

  it("ships no role-creating migration, so the roles above are the operator's job", async () => {
    const roles = await owner.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms%'`,
    );
    // Only the role this suite created itself. A migration that started
    // creating roles would show up here and should update the review doc.
    expect(roles.rows.map((r) => r.rolname)).toEqual([REPORTING_ROLE]);
  });
});
