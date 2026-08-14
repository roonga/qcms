/**
 * Per-(event, webhook) delivery helpers (task 025), driven against the 013
 * Testcontainers harness DB. Requires Docker.
 *
 * Proves the fan-out unit's independent state machine: idempotent materialization,
 * the joined due-claim, backoff/dead-letter/reset, and - via genuine concurrent
 * pooled transactions - that `FOR UPDATE OF webhook_deliveries SKIP LOCKED` never
 * hands the same delivery to two claimers (the multi-instance-safety guarantee).
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, notInArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId } from "@qcms/core";

import * as schema from "../schema/index.js";
import { webhookDeliveries } from "../schema/index.js";
import { startTestDb, type TestDb } from "../testing/harness.js";
import {
  claimDueDeliveries,
  createForm,
  enqueue,
  insertDelivery,
  insertWebhook,
  listDeadLetterDeliveries,
  listRecentDeliveries,
  markDeliveryDelivered,
  redactAgedResponseSnippets,
  OUTBOX_MAX_ATTEMPTS,
  recordDeliveryFailure,
  resetDeliveryForRedelivery,
  type DeliveryAttemptRecord,
  type DeliveryRow,
} from "./index.js";

const { Pool } = pg;
const BOOT_TIMEOUT = 120_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

let seq = 0;

/** Seed a form, one active webhook, and one outbox event; return their ids. */
async function seedEventWithWebhook(): Promise<{
  outboxId: string;
  webhookId: string;
  formId: FormId;
}> {
  seq += 1;
  const formId = FormId.parse(`frm_deliv_${seq}`);
  await createForm(testDb.db, { formId, slug: `deliv-${seq}`, defaultLocale: "en" });
  const webhookId = `whk_deliv_${seq}`;
  await insertWebhook(testDb.db, {
    webhookId,
    formId,
    url: `https://consumer.example.com/hook-${seq}`,
    secretEncrypted: "v1.opaque-ciphertext",
    active: true,
  });
  const event = await enqueue(testDb.db, {
    eventType: "response.submitted",
    payload: { sessionId: `ses_${seq}`, formId },
  });
  return { outboxId: event.id, webhookId, formId };
}

async function readDelivery(id: string): Promise<DeliveryRow | undefined> {
  const [row] = await testDb.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, id));
  return row;
}

async function deliveryIdFor(outboxId: string, webhookId: string): Promise<string> {
  const [row] = await testDb.db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(eq(webhookDeliveries.outboxId, outboxId), eq(webhookDeliveries.webhookId, webhookId)),
    );
  return row!.id;
}

describe("webhook-delivery helpers", () => {
  it("materializes idempotently: a repeated insert is a no-op (one row per event/webhook)", async () => {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    await insertDelivery(testDb.db, { outboxId, webhookId }); // repeat → ON CONFLICT DO NOTHING
    const rows = await testDb.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.outboxId, outboxId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(0);
    expect(rows[0]!.deliveredAt).toBeNull();
  });

  it("claims a due delivery joined to its event + webhook, and markDelivered removes it from the due set", async () => {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const due = new Date(Date.now() + 1000);

    const claimed = (await claimDueDeliveries(testDb.db, 50, due)).filter(
      (d) => d.outboxId === outboxId,
    );
    expect(claimed).toHaveLength(1);
    const one = claimed[0]!;
    expect(one.eventType).toBe("response.submitted");
    expect(one.url).toBe(`https://consumer.example.com/hook-${seq}`);
    expect(one.secretEncrypted).toBe("v1.opaque-ciphertext");

    await markDeliveryDelivered(testDb.db, one.deliveryId, new Date());
    const after = (await claimDueDeliveries(testDb.db, 50, due)).filter(
      (d) => d.outboxId === outboxId,
    );
    expect(after).toHaveLength(0);
    expect((await readDelivery(one.deliveryId))?.deliveredAt).toBeInstanceOf(Date);
  });

  it("records failures with advancing backoff, dead-letters after max attempts, then resets for redelivery", async () => {
    const { outboxId, webhookId, formId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);
    const from = new Date("2026-07-20T00:00:00.000Z");

    let row = await recordDeliveryFailure(testDb.db, deliveryId, "http_500", from);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe("http_500");
    const firstNext = row!.nextAttemptAt.getTime();

    row = await recordDeliveryFailure(testDb.db, deliveryId, "http_500", from);
    expect(row?.attempts).toBe(2);
    // Backoff advances: the second retry is scheduled later than the first.
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(firstNext);
    expect(row?.deadLetteredAt).toBeNull();

    // Exhaust the remaining attempts → dead-lettered.
    for (let i = 3; i <= OUTBOX_MAX_ATTEMPTS; i++) {
      row = await recordDeliveryFailure(testDb.db, deliveryId, `http_500 attempt ${i}`, from);
    }
    expect(row?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(row?.deadLetteredAt).toBeInstanceOf(Date);

    const dead = (await listDeadLetterDeliveries(testDb.db)).filter(
      (d) => d.deliveryId === deliveryId,
    );
    expect(dead).toHaveLength(1);
    expect(dead[0]!.lastError).toContain("http_500");
    expect(dead[0]!.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(dead[0]!.eventType).toBe("response.submitted");

    // A dead-lettered row is not claimable until reset.
    const beforeReset = (
      await claimDueDeliveries(testDb.db, 50, new Date(Date.now() + 1000))
    ).filter((d) => d.deliveryId === deliveryId);
    expect(beforeReset).toHaveLength(0);

    const reset = await resetDeliveryForRedelivery(testDb.db, formId, deliveryId);
    expect(reset?.deadLetteredAt).toBeNull();
    expect(reset?.attempts).toBe(0);
    expect(reset?.lastError).toBeNull();
    const afterReset = (
      await claimDueDeliveries(testDb.db, 50, new Date(Date.now() + 1000))
    ).filter((d) => d.deliveryId === deliveryId);
    expect(afterReset).toHaveLength(1);
  });

  it("recordDeliveryFailure and reset return undefined for a missing row", async () => {
    const ghost = "00000000-0000-0000-0000-000000000000";
    const { formId } = await seedEventWithWebhook();
    expect(await recordDeliveryFailure(testDb.db, ghost, "x")).toBeUndefined();
    expect(await resetDeliveryForRedelivery(testDb.db, formId, ghost)).toBeUndefined();
  });
});

/**
 * The form a delivery belongs to, resolved through its webhook - the ownership
 * chain the redelivery helpers are scoped by (issue #305). Tests that only hold a
 * delivery id use this rather than threading the form through every seed helper.
 */
async function formOfDelivery(deliveryId: string): Promise<FormId> {
  const { rows } = await testDb.client.query<{ form_id: string }>(
    `select w.form_id
       from webhook_deliveries d
       join webhooks w on w.webhook_id = d.webhook_id
      where d.id = $1`,
    [deliveryId],
  );
  return FormId.parse(rows[0]!.form_id);
}

// --- the last-attempt record and the form-scoped list (task 035) -------------

/**
 * A stand-in for what the deliverer writes after one attempt.
 *
 * The header map arrives here already masked, because masking happens at the
 * deliverer, before this layer ever sees it - so a record built by hand carries a
 * mask too, and no test in this file can accidentally assert that the query layer
 * is what keeps an HMAC out of the column.
 */
function attemptRecord(overrides: Partial<DeliveryAttemptRecord> = {}): DeliveryAttemptRecord {
  return {
    lastAttemptAt: new Date("2026-07-20T00:00:05.000Z"),
    lastStatus: 200,
    lastLatencyMs: 42,
    lastRequestHeaders: {
      "x-qcms-event": "response.submitted",
      "x-qcms-signature": "v1=<masked>",
    },
    lastResponseSnippet: "ok",
    ...overrides,
  };
}

/**
 * Seed one form with `count` webhooks fanned out from a single event, and stamp
 * each delivery's `created_at` a second apart.
 *
 * The stamp is not cosmetic: `listRecentDeliveries` orders by `created_at`, and
 * rows inserted back to back can land close enough together that "newest first"
 * would be asserting on insert timing rather than on the query. Returned ids are
 * oldest-first, so the expected list order is the reverse.
 */
async function seedFormWithDeliveries(
  count: number,
): Promise<{ formId: FormId; deliveryIds: string[] }> {
  seq += 1;
  const formId = FormId.parse(`frm_list_${seq}`);
  await createForm(testDb.db, { formId, slug: `list-${seq}`, defaultLocale: "en" });
  const event = await enqueue(testDb.db, {
    eventType: "response.submitted",
    payload: { formId },
  });
  const deliveryIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const webhookId = `whk_list_${seq}_${i}`;
    await insertWebhook(testDb.db, {
      webhookId,
      formId,
      url: `https://consumer.example.com/list-${seq}-${i}`,
      secretEncrypted: "v1.opaque",
      active: true,
    });
    await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
    const id = await deliveryIdFor(event.id, webhookId);
    await testDb.db
      .update(webhookDeliveries)
      .set({ createdAt: new Date(Date.UTC(2026, 6, 20, 0, 0, i)) })
      .where(eq(webhookDeliveries.id, id));
    deliveryIds.push(id);
  }
  return { formId, deliveryIds };
}

describe("last-attempt record + listRecentDeliveries (task 035)", () => {
  it("markDeliveryDelivered persists the attempt record and leaves attempts at 0", async () => {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);

    const attempt = attemptRecord();
    await markDeliveryDelivered(testDb.db, deliveryId, new Date(), attempt);

    const row = await readDelivery(deliveryId);
    expect(row?.lastAttemptAt?.toISOString()).toBe(attempt.lastAttemptAt.toISOString());
    expect(row?.lastStatus).toBe(200);
    expect(row?.lastLatencyMs).toBe(42);
    expect(row?.lastRequestHeaders).toEqual(attempt.lastRequestHeaders);
    expect(row?.lastResponseSnippet).toBe("ok");
    // `attempts` counts FAILED attempts - it is the retry schedule's input - so a
    // first-time success deliberately stays at 0 even though an attempt was made.
    expect(row?.attempts).toBe(0);
  });

  it("recordDeliveryFailure persists the attempt record alongside the error", async () => {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);

    const attempt = attemptRecord({
      lastStatus: 500,
      lastLatencyMs: 7,
      lastResponseSnippet: "upstream unavailable",
    });
    const row = await recordDeliveryFailure(
      testDb.db,
      deliveryId,
      "http_500",
      new Date("2026-07-20T00:00:00.000Z"),
      attempt,
    );

    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe("http_500");
    expect(row?.lastStatus).toBe(500);
    expect(row?.lastLatencyMs).toBe(7);
    expect(row?.lastResponseSnippet).toBe("upstream unavailable");
    expect(row?.lastRequestHeaders).toEqual(attempt.lastRequestHeaders);
    expect(row?.lastAttemptAt?.toISOString()).toBe(attempt.lastAttemptAt.toISOString());
  });

  it("an attempt record is optional: omitting it leaves the last_* columns untouched", async () => {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);

    await recordDeliveryFailure(testDb.db, deliveryId, "http_500", new Date(), attemptRecord());
    // A caller that has no attempt to describe (an SSRF rejection, say) must not
    // wipe the record of the attempt that did happen.
    await recordDeliveryFailure(testDb.db, deliveryId, "url_rejected", new Date());

    const row = await readDelivery(deliveryId);
    expect(row?.lastError).toBe("url_rejected");
    expect(row?.lastStatus).toBe(200);
    expect(row?.lastRequestHeaders).not.toBeNull();
  });

  it("resetDeliveryForRedelivery clears the whole attempt record, not just lastError", async () => {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);
    await recordDeliveryFailure(
      testDb.db,
      deliveryId,
      "http_500",
      new Date(),
      attemptRecord({ lastStatus: 500 }),
    );
    expect((await readDelivery(deliveryId))?.lastStatus).toBe(500);

    const reset = await resetDeliveryForRedelivery(
      testDb.db,
      await formOfDelivery(deliveryId),
      deliveryId,
    );

    // No contradictory statements on one screen: a reset row has made no attempt
    // since, so every field describing "the last attempt" reads empty, not stale.
    expect(reset?.lastError).toBeNull();
    expect(reset?.lastAttemptAt).toBeNull();
    expect(reset?.lastStatus).toBeNull();
    expect(reset?.lastLatencyMs).toBeNull();
    expect(reset?.lastRequestHeaders).toBeNull();
    expect(reset?.lastResponseSnippet).toBeNull();
  });

  it("listRecentDeliveries is form-scoped and newest first, and honours the limit", async () => {
    const a = await seedFormWithDeliveries(3);
    const b = await seedFormWithDeliveries(1);
    const newestFirst = [...a.deliveryIds].reverse();

    const all = await listRecentDeliveries(testDb.db, a.formId, 10);
    expect(all.map((r) => r.deliveryId)).toEqual(newestFirst);
    // Form B's delivery is invisible from form A, and vice versa: the list is
    // scoped through the webhook's form, not filtered by the caller.
    expect(all.some((r) => b.deliveryIds.includes(r.deliveryId))).toBe(false);
    expect((await listRecentDeliveries(testDb.db, b.formId, 10)).map((r) => r.deliveryId)).toEqual(
      b.deliveryIds,
    );

    const limited = await listRecentDeliveries(testDb.db, a.formId, 2);
    expect(limited.map((r) => r.deliveryId)).toEqual(newestFirst.slice(0, 2));

    // The joined columns an operator reads the row by are present.
    expect(all[0]?.eventType).toBe("response.submitted");
    expect(all[0]?.url).toContain("https://consumer.example.com/list-");
  });

  it("listRecentDeliveries carries the attempt record and the lifecycle timestamps", async () => {
    const { formId, deliveryIds } = await seedFormWithDeliveries(2);
    const [pendingId, failedId] = deliveryIds as [string, string];

    const attempt = attemptRecord({ lastStatus: 502, lastResponseSnippet: "bad gateway" });
    await recordDeliveryFailure(testDb.db, failedId, "http_502", new Date(), attempt);

    const rows = await listRecentDeliveries(testDb.db, formId, 10);
    const failed = rows.find((r) => r.deliveryId === failedId);
    expect(failed?.lastStatus).toBe(502);
    expect(failed?.lastLatencyMs).toBe(42);
    expect(failed?.lastResponseSnippet).toBe("bad gateway");
    expect(failed?.lastRequestHeaders).toEqual(attempt.lastRequestHeaders);
    expect(failed?.lastAttemptAt?.toISOString()).toBe(attempt.lastAttemptAt.toISOString());
    expect(failed?.lastError).toBe("http_502");
    expect(failed?.deliveredAt).toBeNull();

    // An untouched delivery reads as "nothing attempted yet" on every field.
    const pending = rows.find((r) => r.deliveryId === pendingId);
    expect(pending?.deliveredAt).toBeNull();
    expect(pending?.deadLetteredAt).toBeNull();
    expect(pending?.lastAttemptAt).toBeNull();
    expect(pending?.lastStatus).toBeNull();
    expect(pending?.lastRequestHeaders).toBeNull();

    // A delivered row carries its success timestamp into the same view.
    await markDeliveryDelivered(testDb.db, pendingId, new Date(), attemptRecord());
    const after = await listRecentDeliveries(testDb.db, formId, 10);
    expect(after.find((r) => r.deliveryId === pendingId)?.deliveredAt).toBeInstanceOf(Date);
  });
});

// Genuine concurrency needs a real pool: the single harness client cannot run
// two transactions with overlapping open locks.
describe("delivery claim concurrency (live, pooled connections)", () => {
  let pool: pg.Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(() => {
    pool = new Pool({ connectionString: testDb.connectionUri, max: 8 });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("two concurrent claimers never claim the same delivery (FOR UPDATE OF ... SKIP LOCKED)", async () => {
    // One form + event, six webhooks → six independent delivery rows.
    seq += 1;
    const formId = FormId.parse(`frm_deliv_race_${seq}`);
    await createForm(testDb.db, { formId, slug: `deliv-race-${seq}`, defaultLocale: "en" });
    const event = await enqueue(testDb.db, {
      eventType: "response.submitted",
      payload: { formId },
    });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const webhookId = `whk_race_${seq}_${i}`;
      await insertWebhook(testDb.db, {
        webhookId,
        formId,
        url: `https://consumer.example.com/race-${seq}-${i}`,
        secretEncrypted: "v1.opaque",
        active: true,
      });
      await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
      ids.push(await deliveryIdFor(event.id, webhookId));
    }
    const idSet = new Set(ids);
    const due = new Date(Date.now() + 1000);

    // Park every other still-due delivery this file left behind. The claim limit
    // below is per claimer and deliberately smaller than the two claimers' combined
    // budget, so any unrelated due row eats into it and the pair stops seeing all
    // six - which reads as a SKIP LOCKED failure but is only fixture bleed. Pinning
    // the due set to exactly these six makes the assertion about the lock again.
    await testDb.db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.UTC(2099, 0, 1)) })
      .where(notInArray(webhookDeliveries.id, ids));

    // Barrier: both transactions hold their claimed locks until both have claimed,
    // so SKIP LOCKED must hand them disjoint delivery rows.
    let resolveA!: () => void;
    let resolveB!: () => void;
    const aClaimed = new Promise<void>((r) => (resolveA = r));
    const bClaimed = new Promise<void>((r) => (resolveB = r));
    let claimedA: string[] = [];
    let claimedB: string[] = [];

    const txA = db.transaction(async (tx) => {
      claimedA = (await claimDueDeliveries(tx, 5, due))
        .map((d) => d.deliveryId)
        .filter((id) => idSet.has(id));
      resolveA();
      await bClaimed;
    });
    const txB = db.transaction(async (tx) => {
      claimedB = (await claimDueDeliveries(tx, 5, due))
        .map((d) => d.deliveryId)
        .filter((id) => idSet.has(id));
      resolveB();
      await aClaimed;
    });
    await Promise.all([txA, txB]);

    const overlap = claimedA.filter((id) => claimedB.includes(id));
    expect(overlap).toEqual([]); // no delivery claimed by both
    expect(new Set([...claimedA, ...claimedB])).toEqual(idSet); // all six claimed once
  });
});

/**
 * Response-snippet retention (issue #304).
 *
 * `last_response_snippet` is the one column on this table that can hold a
 * respondent's own words: it is a consumer's response body kept verbatim, and a
 * consumer that echoes the request in a validation error puts answers there without
 * QCMS ever choosing to write them. These tests assert the observable effect - the
 * bytes are gone, the value-free record is not - rather than that a sweep exists.
 */
describe("redactAgedResponseSnippets (issue #304)", () => {
  /** Seed one delivery carrying an attempt whose snippet echoes the request. */
  async function seedAttempt(
    attemptAt: Date,
    snippet: string | null = '{"error":"invalid","received":{"q_name":"Ada Lovelace"}}',
  ): Promise<string> {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);
    await recordDeliveryFailure(
      testDb.db,
      deliveryId,
      "http_400",
      attemptAt,
      attemptRecord({ lastAttemptAt: attemptAt, lastStatus: 400, lastResponseSnippet: snippet }),
    );
    return deliveryId;
  }

  it("removes an aged snippet, marks it, and keeps the value-free attempt record", async () => {
    const attemptAt = new Date("2026-07-01T00:00:00.000Z");
    const deliveryId = await seedAttempt(attemptAt);

    const before = await readDelivery(deliveryId);
    expect(before?.lastResponseSnippet).toContain("Ada Lovelace");
    expect(before?.lastResponseSnippetRedactedAt).toBeNull();

    const result = await redactAgedResponseSnippets(
      testDb.db,
      new Date("2026-07-08T00:00:00.000Z"),
    );

    expect(result.redactedCount).toBeGreaterThanOrEqual(1);
    const after = await readDelivery(deliveryId);
    // The bytes are gone...
    expect(after?.lastResponseSnippet).toBeNull();
    // ...and the row says so, rather than reading as "the body was empty".
    expect(after?.lastResponseSnippetRedactedAt).not.toBeNull();
    // Everything an operator's audit question needs is value-free and survives.
    expect(after?.lastStatus).toBe(400);
    expect(after?.lastError).toBe("http_400");
    expect(after?.lastLatencyMs).toBe(42);
    expect(after?.lastRequestHeaders).toEqual(attemptRecord().lastRequestHeaders);
    expect(after?.lastAttemptAt?.toISOString()).toBe(attemptAt.toISOString());
  });

  it("leaves a snippet inside the retention window alone", async () => {
    const deliveryId = await seedAttempt(new Date("2026-07-07T12:00:00.000Z"));

    await redactAgedResponseSnippets(testDb.db, new Date("2026-07-07T00:00:00.000Z"));

    const row = await readDelivery(deliveryId);
    expect(row?.lastResponseSnippet).toContain("Ada Lovelace");
    expect(row?.lastResponseSnippetRedactedAt).toBeNull();
  });

  it("covers rows that predate the control - no backfill migration needed", async () => {
    // The row a deployment already holds when it upgrades: an attempt from long
    // before this sweep existed. The predicate is over `last_attempt_at`, which
    // every such row already has, so the first sweep after the upgrade reaches the
    // whole back catalogue. That is the data the issue is about; a control that only
    // governed rows written after it shipped would have left exactly it behind.
    const ancient = await seedAttempt(new Date("2020-01-01T00:00:00.000Z"));
    const recent = await seedAttempt(new Date("2026-07-07T23:00:00.000Z"));

    await redactAgedResponseSnippets(testDb.db, new Date("2026-07-07T00:00:00.000Z"));

    expect((await readDelivery(ancient))?.lastResponseSnippet).toBeNull();
    expect((await readDelivery(ancient))?.lastResponseSnippetRedactedAt).not.toBeNull();
    expect((await readDelivery(recent))?.lastResponseSnippet).toContain("Ada Lovelace");
  });

  it("does not mark a row that never held a snippet", async () => {
    // A timeout records an attempt with no body at all. Marking it would claim a
    // removal that never happened, and put "the body was removed" on a screen where
    // "no response arrived" is the truth.
    const deliveryId = await seedAttempt(new Date("2026-07-01T00:00:00.000Z"), null);

    await redactAgedResponseSnippets(testDb.db, new Date("2026-07-08T00:00:00.000Z"));

    const row = await readDelivery(deliveryId);
    expect(row?.lastResponseSnippet).toBeNull();
    expect(row?.lastResponseSnippetRedactedAt).toBeNull();
  });

  it("is idempotent: a second sweep finds nothing and does not move the marker", async () => {
    const deliveryId = await seedAttempt(new Date("2026-07-01T00:00:00.000Z"));
    const horizon = new Date("2026-07-08T00:00:00.000Z");

    await redactAgedResponseSnippets(testDb.db, horizon);
    const first = (await readDelivery(deliveryId))?.lastResponseSnippetRedactedAt;

    const second = await redactAgedResponseSnippets(testDb.db, horizon);

    expect(second.redactedCount).toBe(0);
    expect((await readDelivery(deliveryId))?.lastResponseSnippetRedactedAt?.toISOString()).toBe(
      first?.toISOString(),
    );
  });

  it("a redelivery reset clears the marker along with the rest of the attempt record", async () => {
    const deliveryId = await seedAttempt(new Date("2026-07-01T00:00:00.000Z"));
    await redactAgedResponseSnippets(testDb.db, new Date("2026-07-08T00:00:00.000Z"));

    await resetDeliveryForRedelivery(testDb.db, await formOfDelivery(deliveryId), deliveryId);

    // The row has made no attempt since the reset, so "the last attempt's body was
    // removed" would be a statement about an attempt this row no longer records.
    const row = await readDelivery(deliveryId);
    expect(row?.lastResponseSnippet).toBeNull();
    expect(row?.lastResponseSnippetRedactedAt).toBeNull();
    expect(row?.lastStatus).toBeNull();
  });
});

/**
 * The precondition the retention sweep ages from, enforced by the database
 * (issue #304, migration `0015`).
 *
 * `redactAgedResponseSnippets` finds rows with `last_attempt_at < horizon`, and under
 * three-valued logic that is never true for a NULL. So a row carrying a snippet with
 * no attempt time would be skipped by every sweep forever - the leak the retention
 * story exists to close, reappearing through the control itself. `attemptColumns`
 * pairs the two columns today and its input types both as required, but that is a
 * call-site convention: a future writer can break it silently, and a comment saying
 * "these are written together" cannot fail when one does. Hence a CHECK constraint,
 * and hence this test, which watches it refuse.
 */
describe("webhook_deliveries_snippet_requires_attempt (issue #304)", () => {
  it("refuses a snippet stored without the attempt time it belongs to", async () => {
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);

    await expect(
      testDb.client.query(
        `update webhook_deliveries
            set last_response_snippet = $1, last_attempt_at = null
          where id = $2`,
        ['{"error":"invalid","received":{"q_name":"Ada Lovelace"}}', deliveryId],
      ),
    ).rejects.toThrow(/webhook_deliveries_snippet_requires_attempt/);

    // Refused, not partially applied: the row is exactly as it was.
    const row = await readDelivery(deliveryId);
    expect(row?.lastResponseSnippet).toBeNull();
    expect(row?.lastAttemptAt).toBeNull();
  });

  it("allows the three shapes the delivery path actually writes", async () => {
    // The constraint has to refuse precisely one combination and no more, or it
    // would break the timeout path (an attempt with no body) and the initial state.
    const { outboxId, webhookId } = await seedEventWithWebhook();
    await insertDelivery(testDb.db, { outboxId, webhookId });
    const deliveryId = await deliveryIdFor(outboxId, webhookId);
    const at = new Date("2026-07-20T00:00:05.000Z");

    // 1. Neither: a materialized row that has not been attempted.
    expect((await readDelivery(deliveryId))?.lastAttemptAt).toBeNull();

    // 2. An attempt with a body.
    await markDeliveryDelivered(testDb.db, deliveryId, at, attemptRecord({ lastAttemptAt: at }));
    expect((await readDelivery(deliveryId))?.lastResponseSnippet).toBe("ok");

    // 3. An attempt with no body - the timeout/network-error shape.
    await recordDeliveryFailure(
      testDb.db,
      deliveryId,
      "timeout",
      at,
      attemptRecord({ lastAttemptAt: at, lastStatus: null, lastResponseSnippet: null }),
    );
    const row = await readDelivery(deliveryId);
    expect(row?.lastResponseSnippet).toBeNull();
    expect(row?.lastAttemptAt).not.toBeNull();

    // 4. And the sweep's own write - snippet cleared, attempt time kept - is legal.
    await markDeliveryDelivered(testDb.db, deliveryId, at, attemptRecord({ lastAttemptAt: at }));
    await redactAgedResponseSnippets(testDb.db, new Date("2026-07-21T00:00:00.000Z"));
    const swept = await readDelivery(deliveryId);
    expect(swept?.lastResponseSnippet).toBeNull();
    expect(swept?.lastResponseSnippetRedactedAt).not.toBeNull();
  });
});
