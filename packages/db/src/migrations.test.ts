import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, startTestDb, type TestDb } from "./testing/harness.js";

// Testcontainers boots a real Postgres; give container startup room.
const BOOT_TIMEOUT = 120_000;

/** Every table the schema declares (13 domain + 5 better-auth). */
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

describe("@qcms/db migrations", () => {
  describe("migrate from zero", () => {
    let testDb: TestDb;

    beforeEach(async () => {
      // Fresh container, then the full package-owned migration set via the
      // official Drizzle migrator - the exact path adopters run.
      testDb = await startTestDb();
    }, BOOT_TIMEOUT);

    afterEach(async () => {
      await testDb.teardown();
    }, BOOT_TIMEOUT);

    it("creates every table on an empty database", async () => {
      const tables = await publicTables(testDb);
      for (const expected of EXPECTED_TABLES) {
        expect(tables, `missing table ${expected}`).toContain(expected);
      }
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
    }, BOOT_TIMEOUT);

    afterEach(async () => {
      await testDb.teardown();
    }, BOOT_TIMEOUT);

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
  });
});
