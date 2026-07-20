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
import { and, eq } from "drizzle-orm";
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
  markDeliveryDelivered,
  OUTBOX_MAX_ATTEMPTS,
  recordDeliveryFailure,
  resetDeliveryForRedelivery,
  type DeliveryRow,
} from "./index.js";

const { Pool } = pg;
const BOOT_TIMEOUT = 120_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
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
    const { outboxId, webhookId } = await seedEventWithWebhook();
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

    const reset = await resetDeliveryForRedelivery(testDb.db, deliveryId);
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
    expect(await recordDeliveryFailure(testDb.db, ghost, "x")).toBeUndefined();
    expect(await resetDeliveryForRedelivery(testDb.db, ghost)).toBeUndefined();
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
