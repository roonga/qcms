/**
 * Requires Docker. These assert index applicability rather than speed: a timing
 * assertion would be flaky on a laptop and meaningless at this table size.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  DEFAULT_TEST_ENVIRONMENT,
  SEED_WORKSPACE_ID,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** `enable_seqscan = off` prices a scan absurdly rather than forbidding it. */
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
      `select indexname from pg_indexes where schemaname = $2 and indexname = any($1)`,
      [
        ["outbox_payload_retention_idx", "webhook_deliveries_snippet_retention_idx"],
        `data_${DEFAULT_TEST_ENVIRONMENT}`,
      ],
    );
    expect(res.rows.map((row) => row.indexname).sort()).toEqual([
      "outbox_payload_retention_idx",
      "webhook_deliveries_snippet_retention_idx",
    ]);
  });

  it("lets the snippet sweep reach its rows by index rather than by scan", async () => {
    const plan = await planFor(
      `select id from webhook_deliveries
       where last_response_snippet is not null and last_attempt_at < now()`,
    );
    expect(plan).toContain("webhook_deliveries_snippet_retention_idx");
  });

  it("lets the payload sweep reach its rows by index rather than by scan", async () => {
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
 * Postgres does not apply the partial expression index's statistics to
 * `greatest(delivered_at, dead_lettered_at) < $1`, so only an explicit id list
 * gives the planner a cardinality it cannot get wrong.
 */
describe("the payload sweep's anti-join does not read the deliveries table (issue #781)", () => {
  /** On an empty database every plan is free, so the negative control needs rows. */
  beforeAll(async () => {
    await testDb.client.query(
      `insert into forms (form_id, slug, workspace_id, default_locale)
         values ('f-781', 's-781', $1, 'en')`,
      [SEED_WORKSPACE_ID],
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

  /** `enable_seqscan` is left on: the claim is that Postgres does not want the scan. */
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
    expect(plan).toContain("webhook_deliveries_event_webhook_uq");
    expect(plan).not.toMatch(/Seq Scan on webhook_deliveries/);
  });

  it("falls back to reading the deliveries table when they are not", async () => {
    const plan = await naturalPlanFor(
      `select id from outbox where ${OUTBOX_PREDICATE} and ${ANTI_JOIN}`,
    );
    expect(plan).toMatch(/Seq Scan on webhook_deliveries/);
  });
});
