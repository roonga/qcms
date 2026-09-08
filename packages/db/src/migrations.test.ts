import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  applyMigrations,
  startTestDb,
  type TestDb,
} from "./testing/harness.js";

/**
 * Every table the schema declares (13 domain + 1 break-glass audit + 5 better-auth).
 *
 * The assertion below is a subset check (`toContain` per entry), so a table added
 * by a later migration is covered only once it is listed here. `two_factor_resets`
 * (migration 0020) was added to this list for that reason and not because the
 * assertion complained: it would not have.
 */
const EXPECTED_TABLES = [
  "questions",
  "question_versions",
  "forms",
  "form_drafts",
  "form_versions",
  "secure_links",
  "webhooks",
  "sessions",
  "answers",
  "submissions",
  "erasure_tombstones",
  "outbox",
  "webhook_deliveries",
  "two_factor_resets",
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
] as const;

async function publicTables(testDb: TestDb): Promise<Set<string>> {
  const res = await testDb.client.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  return new Set(res.rows.map((r) => r.table_name));
}

async function triggerExists(testDb: TestDb, name: string): Promise<boolean> {
  const res = await testDb.client.query(`select 1 from pg_trigger where tgname = $1`, [name]);
  return res.rowCount === 1;
}

/**
 * `true` for `NOT NULL`, `false` for nullable, `undefined` for "no such column" - three
 * answers rather than two, because the assertions below turn on the difference between a
 * column that was relaxed and a column that is gone.
 */
async function columnIsNotNull(
  testDb: TestDb,
  table: string,
  column: string,
): Promise<boolean | undefined> {
  const res = await testDb.client.query<{ is_nullable: string }>(
    `select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  const row = res.rows[0];
  return row === undefined ? undefined : row.is_nullable === "NO";
}

async function indexExists(testDb: TestDb, name: string): Promise<boolean> {
  const res = await testDb.client.query(
    `select 1 from pg_indexes where schemaname = 'public' and indexname = $1`,
    [name],
  );
  return res.rowCount === 1;
}

describe("@roonga/qcms-db migrations", () => {
  describe("migrate from zero", () => {
    let testDb: TestDb;

    beforeEach(async () => {
      // Fresh container, then the full package-owned migration set via the
      // official Drizzle migrator - the exact path adopters run.
      testDb = await startTestDb();
    }, CONTAINER_BOOT_TIMEOUT_MS);

    afterEach(async () => {
      await testDb?.teardown();
    }, CONTAINER_BOOT_TIMEOUT_MS);

    it("creates every table on an empty database", async () => {
      const tables = await publicTables(testDb);
      for (const expected of EXPECTED_TABLES) {
        expect(tables, `missing table ${expected}`).toContain(expected);
      }
    });

    it("leaves account keyed on the provider pair, with no issuer column or index", async () => {
      // better-auth 1.7.3 recognizes an account by `(providerId, accountId)`, as 1.6 did,
      // and never writes `issuer` (issue #849, migration 0020). A `NOT NULL` column the
      // library does not write is not dead weight: 1.7.3 refuses to boot against one, so
      // the shape of this table at the end of the chain is a startup precondition rather
      // than tidiness. Asserted against a real Postgres because that is what the running
      // API meets; the Drizzle mirror it is checked against is source, not evidence.
      expect(await columnIsNotNull(testDb, "account", "issuer")).toBeUndefined();
      expect(await indexExists(testDb, "account_issuer_accountId_key")).toBe(false);

      // The floor under the two lines above: a query that found no `account` table at all
      // would make both of them pass while asserting nothing.
      expect(await columnIsNotNull(testDb, "account", "accountId")).toBe(true);
      expect(await columnIsNotNull(testDb, "account", "providerId")).toBe(true);
    });

    it("installs the append-only and immutability triggers", async () => {
      expect(await triggerExists(testDb, "answers_reject_update")).toBe(true);
      expect(await triggerExists(testDb, "answers_reject_delete")).toBe(true);
      expect(await triggerExists(testDb, "question_versions_freeze_published")).toBe(true);
      expect(await triggerExists(testDb, "form_versions_reject_update")).toBe(true);
    });
  });

  describe("migrate forward, one migration at a time (apply N, then N+1)", () => {
    let testDb: TestDb;

    beforeEach(async () => {
      // No migrations yet - we apply them incrementally below.
      testDb = await startTestDb({ migrate: false });
    }, CONTAINER_BOOT_TIMEOUT_MS);

    afterEach(async () => {
      await testDb?.teardown();
    }, CONTAINER_BOOT_TIMEOUT_MS);

    it("applies 0000 (tables), then 0001 (triggers), each taking effect in turn", async () => {
      // Apply only migration 0000: tables exist, triggers do not.
      await applyMigrations(testDb.client, { to: 0 });
      const tablesAfter0000 = await publicTables(testDb);
      expect(tablesAfter0000).toContain("answers");
      expect(tablesAfter0000).toContain("form_versions");
      expect(await triggerExists(testDb, "answers_reject_update")).toBe(false);

      // Apply the next migration 0001: the triggers now exist.
      await applyMigrations(testDb.client, { from: 1, to: 1 });
      expect(await triggerExists(testDb, "answers_reject_update")).toBe(true);
      expect(await triggerExists(testDb, "form_versions_reject_update")).toBe(true);
    });

    it("applies 0020 over a database that 0017 left carrying account.issuer", async () => {
      // The upgrade path a developer's own stack takes, which is the only one that can
      // fail: a database created after 0020 never has the column, so migrating from zero
      // proves nothing about the drop. Everything through 0019 first, so the starting
      // state is the one 0017 built.
      //
      // The two indices are literals rather than a derivation because migration history
      // is append-only and immutable once released (ADR-18): 0020 is index 20 for good,
      // and a later migration lands at 21 without moving this boundary.
      await applyMigrations(testDb.client, { to: 19 });
      expect(await columnIsNotNull(testDb, "account", "issuer")).toBe(true);
      expect(await indexExists(testDb, "account_issuer_accountId_key")).toBe(true);

      // A row of the shape 0017 made possible, written BEFORE the drop and carrying the
      // one issuer QCMS could produce. The changeset tells adopters that a database
      // created by 0017 needs nothing beyond applying 0020; that is a claim about what
      // `DROP COLUMN` does to existing rows, and this row is what makes it an asserted
      // fact here rather than an appeal to Postgres semantics.
      await testDb.client.query(
        `insert into "user" ("id", "name", "email") values ('u-0017', 'Pre-drop Admin', 'pre-drop@qcms.test')`,
      );
      await testDb.client.query(
        `insert into "account" ("id", "issuer", "accountId", "providerId", "userId")
           values ('a-0017', 'local:credential', 'pre-drop@qcms.test', 'credential', 'u-0017')`,
      );

      // 0020 alone, and the column is gone rather than relaxed. The upgrade guide's
      // Postgres tab would have left it nullable; its Drizzle tab regenerates, and the
      // regenerated model has no field to leave behind.
      await applyMigrations(testDb.client, { from: 20, to: 20 });
      expect(await columnIsNotNull(testDb, "account", "issuer")).toBeUndefined();
      expect(await indexExists(testDb, "account_issuer_accountId_key")).toBe(false);

      // The pre-drop account is still there, still linked to its user, and still keyed
      // on the pair better-auth now looks it up by. Only the column went.
      const survivor = await testDb.client.query(
        `select "id", "accountId", "providerId", "userId" from "account" where "id" = 'a-0017'`,
      );
      expect(survivor.rows).toEqual([
        {
          id: "a-0017",
          accountId: "pre-drop@qcms.test",
          providerId: "credential",
          userId: "u-0017",
        },
      ]);

      // And an insert better-auth's shape can satisfy now succeeds, which is the thing
      // the `NOT NULL` column actually broke: a sign-up naming no `issuer`.
      await testDb.client.query(
        `insert into "user" ("id", "name", "email") values ('u-849', 'Upgrade Probe', 'upgrade-probe@qcms.test')`,
      );
      await testDb.client.query(
        `insert into "account" ("id", "accountId", "providerId", "userId")
           values ('a-849', 'upgrade-probe@qcms.test', 'credential', 'u-849')`,
      );
      const accounts = await testDb.client.query(`select "id" from "account" order by "id"`);
      expect(accounts.rows).toEqual([{ id: "a-0017" }, { id: "a-849" }]);
    });
  });
});
