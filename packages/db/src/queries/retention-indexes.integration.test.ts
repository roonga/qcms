/**
 * The two retention sweeps can actually USE their supporting indexes (issue #434),
 * driven against the 013 Testcontainers harness DB. Requires Docker.
 *
 * ## Why this test exists in this shape
 *
 * #434 asked for a measurement before an index, and the measurement's central
 * finding was a negative one: the two obvious candidates - a bare expression index
 * on `greatest(delivered_at, dead_lettered_at)` for the outbox, a bare
 * `(last_attempt_at)` for the deliveries - were built, measured, and **never chosen
 * by the planner at any scale**. Neither can exclude the rows a previous pass
 * already redacted, so the estimated row count stays near the table size and a
 * sequential scan always wins. What makes each index usable is the partial
 * predicate mirroring the sweep's own filters.
 *
 * That is a property of the index definition matching the query, and it is exactly
 * the kind of thing that breaks silently: add a filter to a sweep, or relax a
 * predicate here, and the index stops being applicable while every functional test
 * stays green and the sweep quietly goes back to scanning the table.
 *
 * So these assert **applicability**, not speed. `enable_seqscan = off` makes the
 * planner cost a sequential scan absurdly rather than forbidding it, so the index
 * is chosen whenever it CAN be; if the predicate no longer implies the query's
 * filters, Postgres still falls back to a scan and the assertion fails. A timing
 * assertion would be the wrong instrument here - it would be flaky on a laptop and
 * meaningless on a table this size, where a sequential scan is genuinely faster.
 *
 * The performance numbers themselves are not re-derived here. They were measured
 * once at 10k / 100k / 1M rows and are recorded where the decision lives: beside
 * each index in `src/schema/outbox.ts` and `src/schema/deliveries.ts`, and in
 * `migrations/0018_retention_sweep_indexes.sql`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../testing/harness.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** The plan for `statement`, as one string, with sequential scans priced out. */
async function planFor(statement: string): Promise<string> {
  await testDb.client.query("set enable_seqscan = off");
  try {
    const res = await testDb.client.query<{ "QUERY PLAN": string }>(`explain ${statement}`);
    return res.rows.map((row) => row["QUERY PLAN"]).join("\n");
  } finally {
    await testDb.client.query("reset enable_seqscan");
  }
}

describe("the retention sweeps' supporting indexes (issue #434)", () => {
  it("exist on a database migrated to head", async () => {
    const res = await testDb.client.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1)`,
      [["outbox_payload_retention_idx", "webhook_deliveries_snippet_retention_idx"]],
    );
    expect(res.rows.map((row) => row.indexname).sort()).toEqual([
      "outbox_payload_retention_idx",
      "webhook_deliveries_snippet_retention_idx",
    ]);
  });

  it("lets the snippet sweep reach its rows by index rather than by scan", async () => {
    // The predicate `redactAgedResponseSnippets` issues, verbatim in shape: the
    // partial half (`last_response_snippet is not null`) is what the index is
    // restricted by, and the ordered half is the column it is keyed on. Drop
    // either from the index and this falls back to a scan.
    const plan = await planFor(
      `select id from webhook_deliveries
       where last_response_snippet is not null and last_attempt_at < now()`,
    );
    expect(plan).toContain("webhook_deliveries_snippet_retention_idx");
  });

  it("lets the payload sweep reach its rows by index rather than by scan", async () => {
    // `greatest(...)` over two columns is why `outbox_delivery_idx` could never
    // serve this, and the two-part partial predicate is why a bare expression
    // index could not either. Both halves are asserted by asking for the plan of
    // the real filter set.
    const plan = await planFor(
      `select id from outbox
       where payload_redacted_at is null
         and jsonb_exists(payload, 'answers')
         and greatest(delivered_at, dead_lettered_at) < now()`,
    );
    expect(plan).toContain("outbox_payload_retention_idx");
  });
});
