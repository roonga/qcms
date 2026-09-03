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

/**
 * The index above removed the sweep's own table scan and left one behind. #434
 * measured the residue and could not close it: the correlated `NOT EXISTS` was costed
 * from a row estimate around 200x too high, because Postgres does not apply the
 * partial expression index's statistics to `greatest(delivered_at, dead_lettered_at) <
 * $1`. From that premise a hash anti-join over the WHOLE `webhook_deliveries` table is
 * genuinely the cheaper plan, and it was chosen. Measured at 1M outbox rows and 1M
 * deliveries with 598 eligible: the lookup that finds those 598 takes 0.4 ms and the
 * pass takes 77.6 ms, of which about 69 ms per worker is a parallel sequential scan
 * that yields nothing.
 *
 * No index fixes an estimate; naming the candidates does, because an explicit id list
 * is a cardinality the planner cannot get wrong. These assertions pin the CONSEQUENCE
 * of that - a per-candidate index probe, and no scan of the deliveries table - rather
 * than a duration, for the reason the file header already gives: a timing assertion
 * against a harness database is meaningless, and the plan shape is the property a
 * future rewrite would silently lose.
 */
describe("the payload sweep's anti-join does not read the deliveries table (issue #781)", () => {
  /**
   * Rows, unlike the suite above. That suite asserts APPLICABILITY and can do it on an
   * empty database by pricing a scan absurdly; this one asserts a planner CHOICE, and
   * on an empty database every plan is free and every such assertion is vacuous - the
   * negative control below passes for the wrong reason and then never fails.
   *
   * 10k is enough for the estimate to matter and cheap enough to seed per run. Payloads
   * are minimal: what has to be big here is the row COUNT the planner reasons about,
   * not the bytes.
   */
  beforeAll(async () => {
    await testDb.client.query(
      `insert into forms (form_id, slug, default_locale) values ('f-781', 's-781', 'en')`,
    );
    await testDb.client.query(
      `insert into webhooks (webhook_id, form_id, url, secret_encrypted)
       values ('wh-781', 'f-781', 'https://example.invalid/hook', 'enc')`,
    );
    await testDb.client.query(
      `insert into outbox (id, event_type, payload, created_at, delivered_at)
       select ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
              'response.submitted',
              jsonb_build_object('answers', jsonb_build_object('q1', g)),
              now() - interval '90 days', now() - interval '89 days'
       from generate_series(1, 10000) g`,
    );
    await testDb.client.query(
      `insert into webhook_deliveries (outbox_id, webhook_id, attempts, next_attempt_at,
                                       delivered_at, created_at, last_attempt_at)
       select ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'wh-781', 1,
              now() - interval '89 days', now() - interval '89 days',
              now() - interval '90 days', now() - interval '89 days'
       from generate_series(1, 10000) g`,
    );
    await testDb.client.query("analyze outbox");
    await testDb.client.query("analyze webhook_deliveries");
  }, CONTAINER_BOOT_TIMEOUT_MS);

  const UNSETTLED_DELIVERY = `greatest(d.delivered_at, d.dead_lettered_at, d.cancelled_at) is null
     or greatest(d.delivered_at, d.dead_lettered_at, d.cancelled_at) >= now()`;

  const ANTI_JOIN = `not exists (
    select 1 from webhook_deliveries d
    where d.outbox_id = outbox.id and (${UNSETTLED_DELIVERY}))`;

  const OUTBOX_PREDICATE = `payload_redacted_at is null
    and jsonb_exists(payload, 'answers')
    and greatest(delivered_at, dead_lettered_at) < now()`;

  /**
   * The plan for `statement`, with `enable_seqscan` deliberately LEFT ON: the claim is
   * that Postgres does not WANT the scan, not that it was forbidden one.
   */
  async function naturalPlanFor(statement: string, params: unknown[] = []): Promise<string> {
    const res = await testDb.client.query<{ "QUERY PLAN": string }>(`explain ${statement}`, params);
    return res.rows.map((row) => row["QUERY PLAN"]).join("\n");
  }

  it("probes the deliveries index per candidate when the candidates are named", async () => {
    const plan = await naturalPlanFor(
      `select id from outbox
       where id = any($1::uuid[]) and ${OUTBOX_PREDICATE} and ${ANTI_JOIN}`,
      [["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]],
    );
    // The unique constraint on (outbox_id, webhook_id) is the index the deliveries
    // table already had, and the one the correlated lookup rides. #434 recorded that
    // no delivery-side index helped while the anti-join was hash-shaped; the id list
    // is what changed, not the index.
    expect(plan).toContain("webhook_deliveries_event_webhook_uq");
    expect(plan).not.toMatch(/Seq Scan on webhook_deliveries/);
  });

  it("falls back to reading the deliveries table when they are not", async () => {
    // The negative control, so the assertion above is known to be about the id list
    // rather than about an empty harness database. This is the shape #781 reported,
    // and the shape the sweep still uses above its candidate budget, where a single
    // read of the deliveries table beats one probe per candidate.
    const plan = await naturalPlanFor(
      `select id from outbox where ${OUTBOX_PREDICATE} and ${ANTI_JOIN}`,
    );
    expect(plan).toMatch(/Seq Scan on webhook_deliveries/);
  });
});
