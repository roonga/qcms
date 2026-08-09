/**
 * Outbox payload retention (issue #329), driven against the 013 Testcontainers
 * harness DB. Requires Docker.
 *
 * `outbox.payload` for a `response.submitted` event is the respondent's whole locked
 * answer set: QCMS's own second copy of the ledger, kept so a delivery can be
 * re-sent. Task 059 made erasure reach that copy, but erasure is a request somebody
 * has to make; until this sweep there was nothing at all for the ordinary case, so
 * every response ever submitted left its answers in plaintext `jsonb` indefinitely.
 *
 * These tests assert the observable effect - the answers are gone, the envelope and
 * the delivery record are not, and nothing in flight was stranded to get there -
 * rather than that a sweep exists.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId } from "@qcms/core";

import { startTestDb, type TestDb } from "../testing/harness.js";
import {
  claimDueDeliveries,
  createForm,
  enqueue,
  insertDelivery,
  insertWebhook,
  markDelivered,
  markDeliveryDelivered,
  OUTBOX_MAX_ATTEMPTS,
  recordDeliveryFailure,
  redactAgedOutboxPayloads,
  redeliveryRefusalFor,
  resetDeliveryForRedelivery,
} from "./index.js";

const BOOT_TIMEOUT = 120_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

/** Long before any horizon these tests use: the shape of the back catalogue. */
const LONG_AGO = new Date("2026-01-02T03:04:05.000Z");
/** The sweep horizon: `now` (2026-08-06) minus the 30-day default. */
const HORIZON = new Date("2026-07-07T00:00:00.000Z");
/** After the horizon: still inside the redelivery window. */
const RECENT = new Date("2026-07-20T00:00:00.000Z");

interface Seeded {
  readonly outboxId: string;
  readonly webhookId: string;
  readonly formId: FormId;
}

let seq = 0;

/**
 * A form, one active webhook, and one queued event. `answers: false` seeds a
 * `form.published` event instead: the same lifecycle, no respondent content.
 */
async function seedEvent(options: { answers?: boolean } = {}): Promise<Seeded> {
  seq += 1;
  const formId = FormId.parse(`frm_retain_${seq}`);
  await createForm(testDb.db, { formId, slug: `retain-${seq}`, defaultLocale: "en" });
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
    eventType: withAnswers ? "response.submitted" : "form.published",
    payload: withAnswers
      ? {
          sessionId: `ses_retain_${seq}`,
          formId,
          formVersion: 1,
          submittedAt: "2026-01-02T03:04:05.000Z",
          contentHash: "0".repeat(64),
          answers: { q_name: "Ada Lovelace", q_age: 36 },
        }
      : { formId, formVersion: 1 },
  });
  return { outboxId: event.id, webhookId, formId };
}

/** Materialize one delivery for this event, against a second endpoint if asked. */
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

/** Drive a delivery to its dead letter through the real backoff path. */
async function deadLetter(deliveryId: string, at: Date): Promise<void> {
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
    await recordDeliveryFailure(testDb.db, deliveryId, "http_500", at);
  }
}

/**
 * Raw row reads, so the assertions are about the database rather than about a
 * helper. `testDb.client` parses timestamptz into a `Date`.
 */
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
    // The answers are gone...
    expect(after.payload).not.toHaveProperty("answers");
    // ...and the row says so, rather than reading as an event that never had any.
    expect(after.payloadRedactedAt).not.toBeNull();
    // Existence without content: the envelope and the event type survive, so the
    // audit question "did this response's event exist, and where did it go" is still
    // answerable.
    expect(after.eventType).toBe("response.submitted");
    expect(after.payload).toEqual({
      sessionId: `ses_retain_${seq}`,
      formId: seeded.formId,
      formVersion: 1,
      submittedAt: "2026-01-02T03:04:05.000Z",
      contentHash: "0".repeat(64),
    });
    // And the delivery record is untouched: it is value-free and it is the answer to
    // "was this person's data sent anywhere".
    const delivery = await testDb.client.query<{ delivered_at: Date | null }>(
      `select delivered_at from webhook_deliveries where id = $1`,
      [deliveryId],
    );
    expect(delivery.rows[0]!.delivered_at).toEqual(LONG_AGO);
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
    // An event still waiting for its first fan-out - a deliverer that was stopped for
    // a month, say. Redacting it would silently drop a submission that never went
    // anywhere: a stuck queue is an operations problem, not a retention one, and the
    // claim query skips redacted rows, so this would strand it permanently.
    const seeded = await seedEvent();

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    const row = await outboxRow(seeded.outboxId);
    expect(row.payload["answers"]).toBeDefined();
    expect(row.payloadRedactedAt).toBeNull();
  });

  it("waits for a delivery that is still pending, then redacts once it settles", async () => {
    // The harm the fan-out half of the predicate prevents. `claimDueDeliveries` joins
    // this payload and skips redacted rows, so redacting while a delivery is still
    // sendable would leave that delivery reading "pending" on the operator dashboard
    // forever while nothing ever sends it.
    const seeded = await seedEvent();
    const settled = await addDelivery(seeded);
    const pending = await addDelivery(seeded, "_b");
    await markDeliveryDelivered(testDb.db, settled, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload["answers"]).toBeDefined();
    // Still claimable, which is the point: the sweep took nothing out from under it.
    const claimed = await claimDueDeliveries(testDb.db, 50, new Date(Date.now() + 1000));
    expect(claimed.some((d) => d.deliveryId === pending)).toBe(true);

    await markDeliveryDelivered(testDb.db, pending, LONG_AGO);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
  });

  it("restarts the window when an operator redelivers a dead letter", async () => {
    // The window is the redelivery window, so exercising the capability reopens it.
    // A reset clears the delivery's terminal timestamps, which is exactly what the
    // predicate reads.
    const seeded = await seedEvent();
    const deliveryId = await addDelivery(seeded);
    await deadLetter(deliveryId, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);
    await resetDeliveryForRedelivery(testDb.db, deliveryId, RECENT);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload["answers"]).toBeDefined();
  });

  it("covers rows that predate the control - no backfill migration needed", async () => {
    // The rows a deployment already holds when it upgrades, which are the data this
    // issue is about. The predicate is over `delivered_at`, `dead_lettered_at` and
    // `cancelled_at` - columns every such row already carries, written long before
    // this control existed - so the first sweep after an upgrade reaches the whole
    // back catalogue and a row from years back is *more* eligible than one written
    // today. A control that only governed rows created after it shipped would have
    // left exactly the data the issue names.
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
    // Nobody fixed the consumer within the window. The dead letter stays on the
    // dashboard as the audit record; what it no longer carries is the answers.
    const seeded = await seedEvent();
    const deliveryId = await addDelivery(seeded);
    await deadLetter(deliveryId, LONG_AGO);
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
    // And the refusal the operator meets is the one rule the scheduler also reads.
    expect(await redeliveryRefusalFor(testDb.db, deliveryId)).toBe("payloadRedacted");
  });

  it("redacts an event that fanned out to nobody", async () => {
    // A form with no active webhook still enqueues the event, and materialize
    // consumes it with zero delivery rows. Those payloads are the quietest half of
    // the leak: no delivery ever existed to make anyone look at them.
    const seeded = await seedEvent();
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    await redactAgedOutboxPayloads(testDb.db, HORIZON);

    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
  });

  it("does not mark an event that never carried answers", async () => {
    // `form.published` holds no respondent content. Marking it would claim a removal
    // that never happened, and make "was this redacted?" unanswerable for the rows
    // where it matters.
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

/**
 * The invariant the marker stands for, enforced by the database (issue #329,
 * migration `0016`).
 *
 * `payload_redacted_at` is read as proof that the answers are gone: a row carrying
 * it is skipped by `claimDue`, by `claimDueDeliveries`, by the redeliver endpoint,
 * and by every future run of the sweep. So a writer that stamped the marker without
 * dropping `answers` would leave the whole answer set in a row nothing ever looks at
 * again - the leak this control exists to close, reappearing through the control
 * itself. The two halves are written together by `outboxPayloadRedactionColumns()`
 * today, but that is a call-site convention, and a convention cannot fail when a
 * future writer breaks it. Hence a CHECK constraint, and hence these tests, which
 * watch it refuse and then measure what it is refusing.
 */
describe("outbox_redacted_payload_has_no_answers (issue #329)", () => {
  it("refuses a row marked redacted while its answers are still there", async () => {
    const seeded = await seedEvent();

    await expect(
      testDb.client.query(`update outbox set payload_redacted_at = now() where id = $1`, [
        seeded.outboxId,
      ]),
    ).rejects.toThrow(/outbox_redacted_payload_has_no_answers/);

    // Refused, not partially applied: the row is exactly as it was.
    const row = await outboxRow(seeded.outboxId);
    expect(row.payloadRedactedAt).toBeNull();
    expect(row.payload["answers"]).toBeDefined();
  });

  it("allows every row shape the outbox actually writes", async () => {
    // The constraint has to refuse precisely one combination and no more, or it would
    // break the live queue, the answer-free event types, or the redaction itself.
    const live = await seedEvent();
    expect((await outboxRow(live.outboxId)).payload["answers"]).toBeDefined();

    // 1. Answers, no marker: every live `response.submitted` event.
    await markDelivered(testDb.db, live.outboxId, LONG_AGO);
    expect((await outboxRow(live.outboxId)).payloadRedactedAt).toBeNull();

    // 2. No answers, no marker: `form.published`, and any adopter event type.
    const answerFree = await seedEvent({ answers: false });
    expect((await outboxRow(answerFree.outboxId)).payloadRedactedAt).toBeNull();

    // 3. No answers, marker set: what both redaction paths write.
    await redactAgedOutboxPayloads(testDb.db, HORIZON);
    const swept = await outboxRow(live.outboxId);
    expect(swept.payload).not.toHaveProperty("answers");
    expect(swept.payloadRedactedAt).not.toBeNull();

    // 4. And an answer-free payload can still be re-written without the marker: the
    //    constraint is one-directional, so nothing about the ordinary event types
    //    needs to know it exists.
    await testDb.client.query(
      `update outbox set payload = payload || '{"note":"x"}' where id = $1`,
      [answerFree.outboxId],
    );
    expect((await outboxRow(answerFree.outboxId)).payload["note"]).toBe("x");
  });

  it("measures the harm: without it, a stamped-but-unstripped row is invisible forever", async () => {
    const seeded = await seedEvent();
    await markDelivered(testDb.db, seeded.outboxId, LONG_AGO);

    // Drop the guard and produce exactly the row a careless future writer would: the
    // marker set, the answers still in the payload.
    await testDb.client.query(
      `alter table outbox drop constraint outbox_redacted_payload_has_no_answers`,
    );
    try {
      await testDb.client.query(`update outbox set payload_redacted_at = now() where id = $1`, [
        seeded.outboxId,
      ]);

      // Now no control will ever look at it again. The sweep filters on the marker,
      // so even a horizon in the far future steps over the row, and the answers stay
      // in the database for good.
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

    // With the guard back, that row cannot be created at all - and the sweep, which
    // writes both halves together, still reaches this one.
    await expect(
      testDb.client.query(`update outbox set payload_redacted_at = now() where id = $1`, [
        seeded.outboxId,
      ]),
    ).rejects.toThrow(/outbox_redacted_payload_has_no_answers/);
    await redactAgedOutboxPayloads(testDb.db, HORIZON);
    expect((await outboxRow(seeded.outboxId)).payload).not.toHaveProperty("answers");
  });
});
