import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  applyMigrations,
  startTestDb,
  type TestDb,
} from "./testing/harness.js";

/**
 * Every table the schema declares (14 domain + 1 break-glass audit + 5 better-auth).
 *
 * A new migration that creates a table must add the table to this list, or
 * "creates every table on an empty database" fails naming it.
 *
 * That is true because the assertion below compares the created set to this one
 * exactly (issue #861). It was a subset check (`toContain` per entry) until then, so
 * a table a later migration created passed while unlisted: `two_factor_resets`
 * (migration 0021) reached this list because a reviewer noticed it was missing, not
 * because the assertion complained, and it would not have.
 *
 * `answer_group_instances` (migration 0022, ADR-42) is the eighth **data-plane**
 * table, which is a smaller set than this one: ADR-40 counts the tables that carry
 * a session's respondent-linked state and multiply per environment, while this
 * list is every table in `public`.
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
  "answer_group_instances",
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

/**
 * Drizzle's own migration journal: bookkeeping the migrator writes about itself,
 * not schema this package declares. The node-postgres migrator keeps it in the
 * `drizzle` schema, so it does not reach the query below at all; excluded by name so
 * that a migrator default which moved it into `public` could not be mistaken for an
 * unlisted new table by the exact-set assertion.
 */
const DRIZZLE_JOURNAL_TABLE = "__drizzle_migrations";

/**
 * The per-test budget for a body that talks to the container (issue #932).
 *
 * Vitest's 5000 ms default is sized for in-process work. Every test in this file issues
 * real DDL and catalogue queries against a Postgres container that the rest of this
 * package's Docker-backed files are booting at the same moment, so its wall time tracks
 * how busy the daemon is rather than how much the assertion asks of it. Declared on the
 * suite rather than test by test, because that is the honest scope of the claim: it is
 * true of every body here, including the next one added.
 *
 * Measured alone on an idle host by bisecting the per-test budget, which is the only
 * reading that means anything here. A reporter duration counts the container-booting
 * `beforeEach` as part of the test (7010 ms reported against a 1.0 s body, measured with
 * a probe), and that hook is budgeted separately, at CONTAINER_BOOT_TIMEOUT_MS below.
 * Every body here clears 1500 ms; the two that apply migrations in the body clear
 * 1000 ms on a warm image and not on a cold one. So the bodies cost roughly 0.3 s to
 * 1.2 s, and the default left them 4x to 16x of headroom: enough alone, and not enough
 * during a forced `turbo run test`, where the #936 delta review recorded
 * `Test timed out in 5000ms` here while the whole file took 107.7 s and was 5/5 green
 * alone at load 0.44.
 *
 * 30 s is about 25x the slowest measured body. It is the figure PR #937 gave the same
 * class of work in this package (`packages/db/src/testing/harness-deps.test.ts`), and it
 * stays far below the 240 s hook budget, so a migration that genuinely became
 * pathological still fails here rather than passing slowly.
 */
const MIGRATION_STEP_TIMEOUT_MS = 30_000;

async function publicTables(testDb: TestDb): Promise<Set<string>> {
  const res = await testDb.client.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  return new Set(
    res.rows.map((r) => r.table_name).filter((name) => name !== DRIZZLE_JOURNAL_TABLE),
  );
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

describe("@roonga/qcms-db migrations", { timeout: MIGRATION_STEP_TIMEOUT_MS }, () => {
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

    it("creates every table on an empty database, and only those", async () => {
      // Exact equality, sorted, rather than a `toContain` per entry (issue #861): a
      // subset check passes a table nobody listed, which is how `two_factor_resets`
      // went unlisted. Compared as sorted arrays because the diff Vitest prints for
      // two arrays names the table that appeared or vanished, which is the whole
      // message this assertion has to carry.
      const tables = await publicTables(testDb);
      expect([...tables].sort()).toEqual([...EXPECTED_TABLES].sort());
    });

    it("leaves account keyed on the provider pair, with no issuer column or index", async () => {
      // better-auth 1.7.6 recognizes an account by `(providerId, accountId)`, as 1.6 did,
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

      // The roster's pair (migration 0022, ADR-42): the same two guards the answer
      // ledger carries, one table over, the delete one honouring the same door.
      expect(await triggerExists(testDb, "answer_group_instances_reject_update")).toBe(true);
      expect(await triggerExists(testDb, "answer_group_instances_reject_delete")).toBe(true);
    });

    it("keys the answer ledger by instance and pins the roster's event vocabulary", async () => {
      // The column is NULLABLE and that is the additive half of migration 0022: a row
      // written before it, and a row written after it for a question outside every
      // repeating group, are the same row (ADR-42).
      expect(await columnIsNotNull(testDb, "answers", "instance_id")).toBe(false);

      // The index keeps its name and gains `instance_id` before `answered_at`, so its
      // leading columns are exactly `latestAnswers`'s DISTINCT ON key. Read off the
      // live definition rather than off the mirror, which is source and not evidence.
      const definition = await testDb.client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
           where schemaname = 'public' and indexname = 'answers_session_question_answered_at_idx'`,
      );
      expect(definition.rows[0]?.indexdef).toContain("session_id, question_id, instance_id");

      // The CHECK is the third of this table's four guards, and it is hand-authored
      // in SQL rather than declared in the Drizzle mirror, exactly as
      // `answers_retraction_value` (0009) is. So the assertion has to be against the
      // database: the mirror would report nothing either way.
      await expect(
        testDb.client.query(
          `insert into answer_group_instances (session_id, group_id, instance_id, event)
             values ('ses_nope', 'grp_pax', 'ins_1', 'archived')`,
        ),
      ).rejects.toMatchObject({ constraint: "answer_group_instances_event" });
    });

    it("carries ADR-40's per-environment counts, derived from the live catalogue", async () => {
      // ADR-40's amendment states eight data-plane tables, seventeen guards and eight
      // foreign keys per environment, and task 072 is where those figures are checked
      // against real SQL rather than against the prose that produced them. Task 064
      // checks its generator against the same numbers, so a drift found here is found
      // before a generator is written to the wrong total.
      //
      // The criterion is ADR-40's own and is mechanical: any trigger, CHECK, UNIQUE
      // constraint or index declared on one of the data-plane tables. Primary keys ride
      // the CREATE TABLE and are excluded, and so is the index a UNIQUE constraint
      // creates for itself, which would otherwise be counted twice.
      const dataPlane = [
        "sessions",
        "answers",
        "submissions",
        "erasure_tombstones",
        "outbox",
        "webhook_deliveries",
        "webhooks",
        "answer_group_instances",
      ];
      const tables = await publicTables(testDb);
      expect(dataPlane.filter((name) => tables.has(name))).toEqual(dataPlane);

      const guards = await testDb.client.query<{ kind: string; name: string }>(
        `select 'trigger' as kind, t.tgname as name
           from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal and c.relname = any($1)
         union all
         select case con.contype when 'c' then 'check' else 'unique' end, con.conname
           from pg_constraint con join pg_class c on c.oid = con.conrelid
           where con.contype in ('c', 'u') and c.relname = any($1)
         union all
         select 'index', ic.relname
           from pg_index i
           join pg_class c on c.oid = i.indrelid
           join pg_class ic on ic.oid = i.indexrelid
           where c.relname = any($1)
             and not i.indisprimary
             and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)`,
        [dataPlane],
      );

      // Sixteen off the chain: twelve ADR-40 reads off migrations 0000 to 0018, plus the
      // four this task's table declares. The seventeenth is the `CHECK (environment =
      // '<env>')` on `data_<env>.sessions` that #995's design adds and task 064 writes,
      // so it cannot exist here and its absence is the honest reading of that record
      // rather than a shortfall. Named as a list so a failure says which guard moved.
      expect(guards.rows.map((row) => row.name).sort()).toEqual(
        [
          "answers_reject_update",
          "answers_reject_delete",
          "answers_retraction_value",
          "answers_session_question_answered_at_idx",
          "answer_group_instances_reject_update",
          "answer_group_instances_reject_delete",
          "answer_group_instances_event",
          "answer_group_instances_session_group_occurred_at_idx",
          "sessions_status_expires_at_idx",
          "outbox_delivery_idx",
          "outbox_payload_retention_idx",
          "outbox_redacted_payload_has_no_answers",
          "webhook_deliveries_due_idx",
          "webhook_deliveries_event_webhook_uq",
          "webhook_deliveries_snippet_requires_attempt",
          "webhook_deliveries_snippet_retention_idx",
        ].sort(),
      );

      const foreignKeys = await testDb.client.query<{ name: string }>(
        `select con.conname as name
           from pg_constraint con join pg_class c on c.oid = con.conrelid
           where con.contype = 'f' and c.relname = any($1)`,
        [dataPlane],
      );
      // Eight, the eighth being the roster's own `session_id` reference into the same
      // plane. ADR-40 names the other seven: three cross into `control` and four stay
      // inside one schema.
      expect(foreignKeys.rows.map((row) => row.name).sort()).toEqual(
        [
          // The three that cross into what ADR-40 calls `control`.
          "sessions_form_version_fk",
          "sessions_link_id_secure_links_link_id_fk",
          "webhooks_form_id_forms_form_id_fk",
          // The four that stay inside one plane, and the roster's, which is the
          // eighth and is also in-plane.
          "answers_session_id_sessions_session_id_fk",
          "submissions_session_id_sessions_session_id_fk",
          "webhook_deliveries_outbox_id_outbox_id_fk",
          "webhook_deliveries_webhook_id_webhooks_webhook_id_fk",
          "answer_group_instances_session_id_sessions_session_id_fk",
        ].sort(),
      );
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

    it("applies 0022 over a populated database without disturbing a stored answer", async () => {
      // The upgrade path an adopter takes, which is the only one that can fail: a
      // database created after 0022 has the column from the start and proves nothing
      // about adding it to a table that already holds rows. Everything through 0021
      // first, then a session and an answer of the shape that existed before ADR-42.
      //
      // The index is literal at 21/22 because migration history is append-only and
      // immutable once released (ADR-18): 0022 is index 22 for good.
      await applyMigrations(testDb.client, { to: 21 });
      expect(await columnIsNotNull(testDb, "answers", "instance_id")).toBeUndefined();

      await testDb.client.query(
        `insert into forms (form_id, slug, default_locale) values ('frm_0022', 'pre-0022', 'en')`,
      );
      await testDb.client.query(
        `insert into form_versions
           (form_id, version, definition, compiled, compiler_version, a2ui_spec_version, semantics_version)
         values ('frm_0022', 1, '{}'::jsonb, '{}'::jsonb, '0.0.0', '0.0.0', '0.0.0')`,
      );
      await testDb.client.query(
        `insert into sessions (session_id, form_id, form_version, access_mode, expires_at)
         values ('ses_0022', 'frm_0022', 1, 'anonymous', now() + interval '1 day')`,
      );
      await testDb.client.query(
        `insert into answers (session_id, question_id, value)
         values ('ses_0022', 'q_meal', '"vegetarian"'::jsonb)`,
      );

      await applyMigrations(testDb.client, { from: 22, to: 22 });

      // The column arrived nullable and the pre-existing row reads back with NULL in
      // it, which is the whole claim the changeset makes to adopters: the migration is
      // additive and there is no backfill, because "outside a repeating group" is
      // exactly what NULL already means for every row that existed.
      expect(await columnIsNotNull(testDb, "answers", "instance_id")).toBe(false);
      const survivor = await testDb.client.query(
        `select "question_id", "instance_id", "value" from answers where session_id = 'ses_0022'`,
      );
      expect(survivor.rows).toEqual([
        { question_id: "q_meal", instance_id: null, value: "vegetarian" },
      ]);

      // And the roster table with its guards is there, on the same existing chain.
      expect(await publicTables(testDb)).toContain("answer_group_instances");
      expect(await triggerExists(testDb, "answer_group_instances_reject_update")).toBe(true);
      expect(await triggerExists(testDb, "answer_group_instances_reject_delete")).toBe(true);
      expect(
        await indexExists(testDb, "answer_group_instances_session_group_occurred_at_idx"),
      ).toBe(true);
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
