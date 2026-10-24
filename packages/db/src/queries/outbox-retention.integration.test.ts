/** Driven against the Testcontainers harness DB. Requires Docker. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId } from "@roonga/qcms-core";

import {
  SEED_WORKSPACE_ID,
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";
// Deep import on purpose: the budget is not on the package's public surface.
import { ANTI_JOIN_CANDIDATE_BUDGET } from "./outbox.js";
import {
  claimDue,
  claimDueDeliveries,
  createForm,
  enqueue,
  insertDelivery,
  insertWebhook,
  markDelivered,
  markDeliveryDelivered,
  outboxRedeliveryRefusalFor,
  OUTBOX_MAX_ATTEMPTS,
  recordDeliveryFailure,
  recordFailure,
  redactAgedOutboxPayloads,
  redeliveryRefusalFor,
  resetDeliveryForRedelivery,
  resetForRedelivery,
} from "./index.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const LONG_AGO = new Date("2026-01-02T03:04:05.000Z");
const HORIZON = new Date("2026-07-07T00:00:00.000Z");
const RECENT = new Date("2026-07-20T00:00:00.000Z");

interface Seeded {
  readonly outboxId: string;
  readonly webhookId: string;
  readonly formId: FormId;
}

let seq = 0;

async function seedEvent(options: { answers?: boolean; repeat?: boolean } = {}): Promise<Seeded> {
  seq += 1;
  const formId = FormId.parse(`frm_retain_${seq}`);
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug: `retain-${seq}`,
    defaultLocale: "en",
  });
  const webhookId = `whk_retain_${seq}`;
  await insertWebhook(testDb.db, {
    webhookId,
    formId,
    url: `https://consumer.example.com/retain-${seq}`,
    secretEncrypted: "v1.opaque-ciphertext",
    active: true,
  });
  const withAnswers = options.answers !== false;
  const event = await enqueue(testDb.db, {
    eventType: withAnswers ? "response.submitted" : "form.released",
    payload: withAnswers
      ? {
          sessionId: `ses_retain_${seq}`,
          formId,
          formVersion: 1,
          submittedAt: "2026-01-02T03:04:05.000Z",
          contentHash: "0".repeat(64),
          answers:
            options.repeat === true
              ? [
                  { questionId: "q_booking_ref", value: "ABC123" },
                  { questionId: "q_name", instanceId: "ins_pax_a", value: "Ada Lovelace" },
                  { questionId: "q_name", instanceId: "ins_pax_b", value: "Grace Hopper" },
                ]
              : { q_name: "Ada Lovelace", q_age: 36 },
        }
      : { formId, formVersion: 1 },
  });
  return { outboxId: event.id, webhookId, formId };
}

async function addDelivery(seeded: Seeded, suffix = ""): Promise<string> {
  const webhookId = `${seeded.webhookId}${suffix}`;
  if (suffix !== "") {
    await insertWebhook(testDb.db, {
      webhookId,
      formId: seeded.formId,
      url: `https://consumer.example.com/${webhookId}`,
      secretEncrypted: "v1.opaque-ciphertext",
      active: true,
    });
  }
  await insertDelivery(testDb.db, { outboxId: seeded.outboxId, webhookId });
  const res = await testDb.client.query<{ id: string }>(
    `select id from webhook_deliveries where outbox_id = $1 and webhook_id = $2`,
    [seeded.outboxId, webhookId],
  );
  return res.rows[0]!.id;
}

async function deadLetter(deliveryId: string, at: Date): Promise<void> {
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
    await recordDeliveryFailure(testDb.db, deliveryId, "http_500", at);
  }
}

async function outboxRow(outboxId: string): Promise<{
  eventType: string;
  payload: Record<string, unknown>;
  payloadRedactedAt: Date | null;
}> {
  const res = await testDb.client.query<{
    event_type: string;
    payload: Record<string, unknown>;
    payload_redacted_at: Date | null;
  }>(`select event_type, payload, payload_redacted_at from outbox where id = $1`, [outboxId]);
  const row = res.rows[0]!;
  return {
    eventType: row.event_type,
    payload: row.payload,
    payloadRedactedAt: row.payload_redacted_at,
  };
}

describe("redactAgedOutboxPayloads (issue #329)", () => {
  it("drops the answers of a settled event, keeps the envelope, and says it did", async () => {
    const seeded = await seedEvent();
    const deliveryId = await addDelivery(seeded);
    await markDeliveryDelivered(testDb.db, deliveryId, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    const before = await outboxRow(seeded.outboxId);
    expect(before.payload["answers"]).toEqual({ q_name: "Ada Lovelace", q_age: 36 });
    expect(before.payloadRedactedAt).toBeNull();

    const result = await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect(result.redactedCount).toBeGreaterThanOrEqual(1);
    const after = await outboxRow(seeded.outboxId);
    expect(after.payload).not.toHaveProperty("answers");
    expect(after.payloadRedactedAt).not.toBeNull();
    expect(after.eventType).toBe("response.submitted");
    expect(after.payload).toEqual({
      sessionId: `ses_retain_${seq}`,
      formId: seeded.formId,
      formVersion: 1,
      submittedAt: "2026-01-02T03:04:05.000Z",
      contentHash: "0".repeat(64),
    });
    const delivery = await testDb.client.query<{ delivered_at: Date | null }>(
      `select delivered_at from webhook_deliveries where id = $1`,
      [deliveryId],
    );
    expect(delivery.rows[0]!.delivered_at).toEqual(LONG_AGO);
  });

  it("drops a repeat payload's instances with the same one-key drop (task 075, case 52)", async () => {
    const seeded = await seedEvent({ repeat: true });
    const deliveryId = await addDelivery(seeded);
    await markDeliveryDelivered(testDb.db, deliveryId, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    const before = await outboxRow(seeded.outboxId);
    expect(JSON.stringify(before.payload["answers"])).toContain("ins_pax_b");

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const after = await outboxRow(seeded.outboxId);
    expect(after.payload).not.toHaveProperty("answers");
    expect(after.payloadRedactedAt).not.toBeNull();
    const remaining = JSON.stringify(after.payload);
    expect(remaining).not.toContain("ins_");
    expect(remaining).not.toContain("Lovelace");
    expect(remaining).not.toContain("ABC123");
    expect(Object.values(after.payload).filter((value) => typeof value === "number")).toEqual([1]);
  });

  it("leaves an event inside the redelivery window alone", async () => {
    const seeded = await seedEvent();
    const deliveryId = await addDelivery(seeded);
    await markDeliveryDelivered(testDb.db, deliveryId, RECENT);
    await markDelivered(testDb.db, seeded.outboxId, RECENT);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const row = await outboxRow(seeded.outboxId);
    expect(row.payload["answers"]).toBeDefined();
    expect(row.payloadRedactedAt).toBeNull();
  });

  it("never redacts an event that has not been consumed, however old it is", async () => {
    const seeded = await seedEvent();

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const row = await outboxRow(seeded.outboxId);
    expect(row.payload["answers"]).toBeDefined();
    expect(row.payloadRedactedAt).toBeNull();
  });

  it("waits for a delivery that is still pending, then redacts once it settles", async () => {
    const seeded = await seedEvent();
    const settled = await addDelivery(seeded);
    const pending = await addDelivery(seeded, "_b");
    await markDeliveryDelivered(testDb.db, settled, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload["answers"]).toBeDefined();
    const claimed = await claimDueDeliveries(testDb.db, 50, new Date(Date.now() + 1000));
    expect(claimed.some((d) => d.deliveryId === pending)).toBe(true);

    await markDeliveryDelivered(testDb.db, pending, LONG_AGO);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
  });

  it("restarts the window when an operator redelivers a dead letter", async () => {
    const seeded = await seedEvent();
    const deliveryId = await addDelivery(seeded);
    await deadLetter(deliveryId, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);
    await resetDeliveryForRedelivery(testDb.db, seeded.formId, deliveryId, RECENT);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload["answers"]).toBeDefined();
  });

  it("covers rows that predate the control - no backfill migration needed", async () => {
    const ancient = await seedEvent();
    const ancientDelivery = await addDelivery(ancient);
    await markDeliveryDelivered(testDb.db, ancientDelivery, new Date("2020-01-01T00:00:00.000Z"));
    await markDelivered(testDb.db, ancient.outboxId, new Date("2020-01-01T00:00:00.000Z"));

    const recent = await seedEvent();
    const recentDelivery = await addDelivery(recent);
    await markDeliveryDelivered(testDb.db, recentDelivery, RECENT);
    await markDelivered(testDb.db, recent.outboxId, RECENT);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(ancient.outboxId)).payload).not.toHaveProperty("answers");
    expect((await outboxRow(ancient.outboxId)).payloadRedactedAt).not.toBeNull();
    expect((await outboxRow(recent.outboxId)).payload["answers"]).toBeDefined();
  });

  it("redacts a dead-lettered fan-out whose redelivery window has closed", async () => {
    const seeded = await seedEvent();
    const deliveryId = await addDelivery(seeded);
    await deadLetter(deliveryId, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
    expect(await redeliveryRefusalFor(testDb.db, seeded.formId, deliveryId)).toBe(
      "payloadRedacted",
    );
  });

  it("redacts an event that fanned out to nobody", async () => {
    const seeded = await seedEvent();
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
  });

  it("does not mark an event that never carried answers", async () => {
    const seeded = await seedEvent({ answers: false });
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const row = await outboxRow(seeded.outboxId);
    expect(row.payloadRedactedAt).toBeNull();
    expect(row.payload).toEqual({ formId: seeded.formId, formVersion: 1 });
  });

  it("is idempotent: a second sweep finds nothing and does not move the marker", async () => {
    const seeded = await seedEvent();
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);
    const first = (await outboxRow(seeded.outboxId)).payloadRedactedAt;

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payloadRedactedAt).toEqual(first);
  });
});

describe("redactAgedOutboxPayloads above its candidate budget (issue #781)", () => {
  /** The probe reads `budget + 1` rows, so `+ 1` would not separate the two strategies. */
  const SEEDED_ROWS = ANTI_JOIN_CANDIDATE_BUDGET + 2;

  async function seedBacklog(): Promise<string[]> {
    const res = await testDb.client.query<{ id: string }>(
      `insert into outbox (event_type, payload, created_at, delivered_at)
       select 'response.submitted',
              jsonb_build_object(
                'sessionId', 'ses_budget_' || g,
                'formId', 'frm_budget',
                'formVersion', 1,
                'submittedAt', $2::text,
                'contentHash', repeat('0', 64),
                'answers', jsonb_build_object('q_name', 'Ada Lovelace', 'q_age', 36)),
              $2::timestamptz,
              $2::timestamptz
       from generate_series(1, $1::int) g
       returning id`,
      [SEEDED_ROWS, LONG_AGO.toISOString()],
    );
    return res.rows.map((row) => row.id);
  }

  /**
   * 60 s rather than Vitest's 5 s default: the 10,002-row insert costs whatever the
   * host is otherwise doing, and it overran 5 s under a parallel verify.
   */
  it("redacts the whole backlog, not the subset the probe could name", async () => {
    const ids = await seedBacklog();
    expect(ids).toHaveLength(SEEDED_ROWS);

    const result = await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const leftBehind = await testDb.client.query<{ id: string }>(
      `select id from outbox
       where id = any($1::uuid[])
         and (payload_redacted_at is null or jsonb_exists(payload, 'answers'))`,
      [ids],
    );
    expect(leftBehind.rows.map((row) => row.id)).toEqual([]);
    expect(result.redactedCount).toBeGreaterThanOrEqual(SEEDED_ROWS);
  }, 60_000);
});

describe("outbox_redacted_payload_has_no_answers (issue #329)", () => {
  it("refuses a row marked redacted while its answers are still there", async () => {
    const seeded = await seedEvent();

    await expect(
      testDb.client.query(`update outbox set payload_redacted_at = now() where id = $1`, [
        seeded.outboxId,
      ]),
    ).rejects.toThrow(/outbox_redacted_payload_has_no_answers/);

    const row = await outboxRow(seeded.outboxId);
    expect(row.payloadRedactedAt).toBeNull();
    expect(row.payload["answers"]).toBeDefined();
  });

  it("allows every row shape the outbox actually writes", async () => {
    const live = await seedEvent();
    expect((await outboxRow(live.outboxId)).payload["answers"]).toBeDefined();

    await markDelivered(testDb.db, live.outboxId, LONG_AGO);
    expect((await outboxRow(live.outboxId)).payloadRedactedAt).toBeNull();

    const answerFree = await seedEvent({ answers: false });
    expect((await outboxRow(answerFree.outboxId)).payloadRedactedAt).toBeNull();

    await redactAgedOutboxPayloads(testDb.db, HORIZON);
    const swept = await outboxRow(live.outboxId);
    expect(swept.payload).not.toHaveProperty("answers");
    expect(swept.payloadRedactedAt).not.toBeNull();

    await testDb.client.query(
      `update outbox set payload = payload || '{"note":"x"}' where id = $1`,
      [answerFree.outboxId],
    );
    expect((await outboxRow(answerFree.outboxId)).payload["note"]).toBe("x");
  });

  it("measures the harm: without it, a stamped-but-unstripped row is invisible forever", async () => {
    const seeded = await seedEvent();
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await testDb.client.query(
      `alter table outbox drop constraint outbox_redacted_payload_has_no_answers`,
    );
    try {
      await testDb.client.query(`update outbox set payload_redacted_at = now() where id = $1`, [
        seeded.outboxId,
      ]);

      await redactAgedOutboxPayloads(testDb.db, new Date("2099-01-01T00:00:00.000Z"));
      const leaked = await outboxRow(seeded.outboxId);
      expect(leaked.payload["answers"]).toEqual({ q_name: "Ada Lovelace", q_age: 36 });
    } finally {
      await testDb.client.query(`update outbox set payload_redacted_at = null where id = $1`, [
        seeded.outboxId,
      ]);
      await testDb.client.query(
        `alter table outbox add constraint outbox_redacted_payload_has_no_answers
           check (payload_redacted_at is null or not jsonb_exists(payload, 'answers'))`,
      );
    }

    await expect(
      testDb.client.query(`update outbox set payload_redacted_at = now() where id = $1`, [
        seeded.outboxId,
      ]),
    ).rejects.toThrow(/outbox_redacted_payload_has_no_answers/);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);
    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
  });
});

describe("resetForRedelivery redaction guard (issue #433)", () => {
  async function resetState(outboxId: string): Promise<{
    deliveredAt: Date | null;
    deadLetteredAt: Date | null;
    attempts: number;
    nextAttemptAt: Date;
    lastError: string | null;
    payloadRedactedAt: Date | null;
  }> {
    const res = await testDb.client.query<{
      delivered_at: Date | null;
      dead_lettered_at: Date | null;
      attempts: number;
      next_attempt_at: Date;
      last_error: string | null;
      payload_redacted_at: Date | null;
    }>(
      `select delivered_at, dead_lettered_at, attempts, next_attempt_at, last_error,
              payload_redacted_at
         from outbox where id = $1`,
      [outboxId],
    );
    const row = res.rows[0]!;
    return {
      deliveredAt: row.delivered_at,
      deadLetteredAt: row.dead_lettered_at,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      lastError: row.last_error,
      payloadRedactedAt: row.payload_redacted_at,
    };
  }

  async function deadLetterEvent(outboxId: string, at: Date): Promise<void> {
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await recordFailure(testDb.db, outboxId, "http_500", at);
    }
  }

  it("resets an intact dead letter and leaves it claimable", async () => {
    const seeded = await seedEvent();
    await deadLetterEvent(seeded.outboxId, LONG_AGO);
    expect((await resetState(seeded.outboxId)).payloadRedactedAt).toBeNull();

    expect(await outboxRedeliveryRefusalFor(testDb.db, seeded.outboxId)).toBeUndefined();
    const at = new Date();
    const reset = await resetForRedelivery(testDb.db, seeded.outboxId, at);

    expect(reset?.id).toBe(seeded.outboxId);
    expect(reset?.deadLetteredAt).toBeNull();
    expect(reset?.attempts).toBe(0);
    const due = await claimDue(testDb.db, 200, new Date(at.getTime() + 1000));
    expect(due.some((r) => r.id === seeded.outboxId)).toBe(true);
  });

  it("refuses a redacted dead letter and leaves the row byte-for-byte as it was", async () => {
    const seeded = await seedEvent();
    await deadLetterEvent(seeded.outboxId, LONG_AGO);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const before = await resetState(seeded.outboxId);
    expect(before.payloadRedactedAt).not.toBeNull();
    expect(before.deadLetteredAt).toEqual(LONG_AGO);
    expect(before.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");

    expect(await outboxRedeliveryRefusalFor(testDb.db, seeded.outboxId)).toBe("payloadRedacted");
    const reset = await resetForRedelivery(testDb.db, seeded.outboxId, new Date());

    expect(reset).toBeUndefined();
    const after = await resetState(seeded.outboxId);
    expect(after.deadLetteredAt).toEqual(before.deadLetteredAt);
    expect(after.deliveredAt).toEqual(before.deliveredAt);
    expect(after.attempts).toBe(before.attempts);
    expect(after.nextAttemptAt).toEqual(before.nextAttemptAt);
    expect(after.lastError).toBe(before.lastError);
    expect(after.payloadRedactedAt).toEqual(before.payloadRedactedAt);
  });

  it("refuses a redacted delivered event without clearing delivered_at", async () => {
    const seeded = await seedEvent();
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);
    const before = await resetState(seeded.outboxId);
    expect(before.payloadRedactedAt).not.toBeNull();
    expect(before.deliveredAt).toEqual(LONG_AGO);

    expect(await resetForRedelivery(testDb.db, seeded.outboxId, new Date())).toBeUndefined();

    const after = await resetState(seeded.outboxId);
    expect(after.deliveredAt).toEqual(LONG_AGO);
    expect(after.deadLetteredAt).toBeNull();
  });

  it("never leaves a redacted event reading as pending", async () => {
    const seeded = await seedEvent();
    await deadLetterEvent(seeded.outboxId, LONG_AGO);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const at = new Date();
    await resetForRedelivery(testDb.db, seeded.outboxId, at);

    const after = await resetState(seeded.outboxId);
    expect(after.deadLetteredAt).not.toBeNull();
    const due = await claimDue(testDb.db, 200, new Date(at.getTime() + 1000));
    expect(due.some((r) => r.id === seeded.outboxId)).toBe(false);
  });

  it("distinguishes a refusal from an id that does not exist", async () => {
    const absent = "00000000-0000-0000-0000-000000000000";
    const seeded = await seedEvent();
    await deadLetterEvent(seeded.outboxId, LONG_AGO);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect(await outboxRedeliveryRefusalFor(testDb.db, absent)).toBeUndefined();
    expect(await resetForRedelivery(testDb.db, absent)).toBeUndefined();

    expect(await outboxRedeliveryRefusalFor(testDb.db, seeded.outboxId)).toBe("payloadRedacted");
    expect(await resetForRedelivery(testDb.db, seeded.outboxId)).toBeUndefined();
  });
});
