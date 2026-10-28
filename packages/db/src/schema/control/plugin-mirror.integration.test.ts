/**
 * If `@better-auth/drizzle-adapter` mapped a `string[]` field to `jsonb` or a serialised
 * `text`, every scope check written against an array operator would be wrong and a round
 * trip alone would not notice.
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
      name: "test-prod.responses.viewer",
      organizationId: "org_mirror",
      role: "responses.viewer",
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
    // Depends on the row the previous test inserted; Vitest runs a file's tests in order.
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
    // A table the plugin declares and the mirror lacks is fatal on the first request
    // through its handler.
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

    // A `NOT NULL` column the library never writes would be fatal on the first request.
    const seed = await testDb.client.query<{ column_default: string | null }>(
      `select column_default from information_schema.columns
        where table_schema = 'control' and table_name = 'organization'
          and column_name = 'seedNewEditorsWithTestData'`,
    );
    expect(seed.rows[0]?.column_default).toBe("false");
  });
});
