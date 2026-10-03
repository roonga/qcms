/**
 * The organisation plugin's mirror, against a real Postgres (ADR-40, ADR-41, Q32, Q39).
 *
 * # Why this file exists, and why the work order says to write it first
 *
 * Task 064's baseline creates the plugin's five tables and every additional field QCMS
 * declares on them, and **the whole grant model of tasks 068 to 070 rests on two columns
 * being a Postgres `text[]`**: a team's `environments` and `forms` are the scope of one
 * grant, and every later authorisation check reads them. If `@better-auth/drizzle-adapter`
 * mapped a `string[]` additional field to something else - `jsonb`, or `text` holding a
 * serialised list - then every scope check written against an array operator would be
 * wrong, and finding that out after the baseline was written would be expensive.
 *
 * So this is the verification rather than an argument. It writes an access-group row
 * through the same Drizzle handle the adapter uses, reads it back, and asserts the
 * **column type in the catalogue** as well as the value: a round trip alone would pass if
 * Drizzle serialised and parsed a `text` column, which is exactly the outcome worth ruling
 * out.
 *
 * Nothing in task 064 writes a team row in production. The tables and the mirror are this
 * task's; the role, the statements and the write path are 069's.
 *
 * # The other half of the pair
 *
 * The work order names two verifications against a real Postgres. The second - better-auth
 * signing in, enrolling a second factor and verifying a recovery code against its tables
 * in the **non-default** `control` schema, which the library validates on the first request
 * through its handler - lives in `apps/api/src/features/auth/auth.integration.test.ts` and
 * `reset-two-factor.integration.test.ts`, where the handler is actually mounted.
 *
 * Requires Docker, like every `*.integration.test.ts`.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../../testing/harness.js";

import { authOrganization, authTeam } from "./auth.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("a team's scope columns are a Postgres text[]", () => {
  it("is declared as an array of text in the catalogue, not jsonb and not a serialised text", async () => {
    // Read before the round trip, because this is the assertion that cannot be satisfied
    // by Drizzle doing the work: `information_schema` reports `ARRAY` for `text[]` and
    // names the element type in `element_types`. A `jsonb` or `text` column would report
    // its own type here and still round-trip a JavaScript array through the ORM.
    const columns = await testDb.client.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
    }>(
      `select column_name, data_type, udt_name
         from information_schema.columns
        where table_schema = 'control' and table_name = 'team'
          and column_name in ('environments', 'forms')
        order by column_name`,
    );
    expect(columns.rows).toEqual([
      // `_text` is Postgres's internal name for `text[]`.
      { column_name: "environments", data_type: "ARRAY", udt_name: "_text" },
      { column_name: "forms", data_type: "ARRAY", udt_name: "_text" },
    ]);
  });

  it("round-trips a multi-element scope, and an `all` scope, with the elements intact", async () => {
    await testDb.db
      .insert(authOrganization)
      .values({ id: "org_mirror", name: "Mirror", slug: "mirror" });
    await testDb.db.insert(authTeam).values({
      id: "team_mirror",
      // Q37's stored access-group name. Task 069 owns the ordering and the refusal; this
      // is only a value the column has to hold.
      name: "test-prod.responses.viewer",
      organizationId: "org_mirror",
      role: "responses.viewer",
      // The two scopes, one a set and one the single-element `all`, because they are read
      // differently by every later check and a mapping defect could reach one and not the
      // other.
      environments: ["test", "prod"],
      forms: ["all"],
    });

    const [row] = await testDb.db
      .select({ environments: authTeam.environments, forms: authTeam.forms })
      .from(authTeam)
      .where(eq(authTeam.id, "team_mirror"));

    expect(row?.environments).toEqual(["test", "prod"]);
    expect(row?.forms).toEqual(["all"]);
  });

  it("is queryable with an array operator, which is what every later scope check needs", async () => {
    // The point of the type, stated as the query it makes possible: `= ANY` over the
    // column rather than a `LIKE` over a serialised list. A `text` column holding
    // `{test,prod}` would fail this, and a `jsonb` one would need a different operator
    // entirely - so this is the assertion that says the grant model's reads will work.
    //
    // Reads the row the test above inserted, deliberately: the value has to survive a
    // commit for the operator to be tested against stored bytes rather than against
    // whatever the ORM held in memory. Vitest runs a file's tests in order.
    const found = await testDb.client.query<{ id: string }>(
      `select id from control.team where 'prod' = any("environments")`,
    );
    expect(found.rows.map((r) => r.id)).toContain("team_mirror");

    const absent = await testDb.client.query<{ id: string }>(
      `select id from control.team where 'staging' = any("environments")`,
    );
    expect(absent.rows).toEqual([]);
  });
});

describe("every table and declared additional field the mirror carries (Q32, Q39)", () => {
  it("holds the plugin's five tables in `control`", async () => {
    // The plugin's startup check runs in **both** directions, so a table it declares that
    // the mirror lacks is fatal on the first request through its handler. Task 068 creates
    // these instead only if it lands first; this asserts that this task's baseline did.
    const tables = await testDb.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'control'
          and table_name in ('organization', 'member', 'invitation', 'team', 'teamMember')
        order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "invitation",
      "member",
      "organization",
      "team",
      "teamMember",
    ]);
  });

  it("carries Q39's two fields, one unique and one defaulted off", async () => {
    // `team.externalGroupId`: string, unique, written only by task C3's sync path, so
    // nullable - every team that exists before C3 has none. Declared now precisely so that
    // C3 is a sync path rather than a migration against a live deployment.
    const external = await testDb.client.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_schema = 'control' and table_name = 'team'
          and column_name = 'externalGroupId'`,
    );
    expect(external.rows[0]?.is_nullable).toBe("YES");
    const unique = await testDb.client.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'control' and t.relname = 'team' and c.contype = 'u'
          and (select array_agg(a.attname::text order by a.attname::text)
                 from unnest(c.conkey) k
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
              = array['externalGroupId']::text[]`,
    );
    expect(unique.rows[0]?.n).toBe(1);

    // `organization.seedNewEditorsWithTestData`: boolean, default off. A `NOT NULL` column
    // the library never writes would be fatal on the first request, which is why it
    // carries a default rather than merely being declared.
    const seed = await testDb.client.query<{ column_default: string | null }>(
      `select column_default from information_schema.columns
        where table_schema = 'control' and table_name = 'organization'
          and column_name = 'seedNewEditorsWithTestData'`,
    );
    expect(seed.rows[0]?.column_default).toBe("false");
  });
});
