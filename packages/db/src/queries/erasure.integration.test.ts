import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import { FormId, QuestionId, SessionId } from "@qcms/core";
import type { AnswerValue, FormDefinition, LockedSubmission } from "@qcms/core";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../testing/harness.js";
import {
  answerLedger,
  appendAnswer,
  claimDueDeliveries,
  createForm,
  createSession,
  DELIVERY_CANCELLED_SESSION_ERASED,
  enqueue,
  eraseSession,
  getSession,
  getSubmission,
  insertDelivery,
  insertFormVersion,
  insertSubmission,
  insertWebhook,
  latestAnswers,
  markDeliveryDelivered,
  markInProgress,
  markSubmitted,
  recordDeliveryFailure,
  redeliveryRefusalFor,
  SessionNotFoundError,
} from "./index.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

/** Seed a form + one published version so sessions have valid FKs. */
async function seedForm(id: string): Promise<{ formId: FormId; version: number }> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, { formId, slug: `${id}-slug`, defaultLocale: "en" });
  const v = await insertFormVersion(testDb.db, {
    formId,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  return { formId, version: v.version };
}

function lockedSubmission(
  entries: ReadonlyArray<{ questionId: string; value: AnswerValue }>,
): LockedSubmission {
  return {
    answers: entries.map((e) => ({ questionId: QuestionId.parse(e.questionId), value: e.value })),
    flowState: { visited: [], hidden: [] },
    contentHash: "0".repeat(64),
  } as unknown as LockedSubmission;
}

/**
 * Seed a submitted session that also carries a real append-only answer ledger
 * (two revisions of one question, plus a second question) so erasure has
 * content to remove.
 */
async function seedSubmittedWithLedger(
  formId: FormId,
  version: number,
  sessionId: SessionId,
): Promise<void> {
  await createSession(testDb.db, {
    sessionId,
    formId,
    formVersion: version,
    accessMode: "anonymous",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await appendAnswer(testDb.db, {
    sessionId,
    questionId: QuestionId.parse("q_text"),
    value: "first",
    answeredAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await appendAnswer(testDb.db, {
    sessionId,
    questionId: QuestionId.parse("q_text"),
    value: "second",
    answeredAt: new Date("2026-01-01T01:00:00.000Z"),
  });
  await appendAnswer(testDb.db, {
    sessionId,
    questionId: QuestionId.parse("q_num"),
    value: 42,
    answeredAt: new Date("2026-01-01T02:00:00.000Z"),
  });
  await markSubmitted(testDb.db, sessionId);
  await insertSubmission(testDb.db, {
    sessionId,
    contentHash: "0".repeat(64),
    lockedAnswers: lockedSubmission([
      { questionId: "q_text", value: "second" },
      { questionId: "q_num", value: 42 },
    ]),
    submittedAt: new Date("2026-01-02T03:04:05.000Z"),
  });
}

/**
 * A queued `response.submitted` event carrying the session's whole locked answer set
 * (the shape the submit slice enqueues), fanned out to one webhook.
 *
 * `webhookSeq` keeps every fixture's endpoint distinct, because a delivery row is
 * unique per (event, webhook) and the tests seed several against one form.
 */
let webhookSeq = 0;
async function seedQueuedEvent(
  formId: FormId,
  version: number,
  sessionId: SessionId,
): Promise<{ outboxId: string; deliveryId: string }> {
  webhookSeq += 1;
  const webhookId = `whk_erase_${webhookSeq}`;
  await insertWebhook(testDb.db, {
    webhookId,
    formId,
    url: `https://consumer.example.com/erase-${webhookSeq}`,
    secretEncrypted: "v1.opaque-ciphertext",
    active: true,
  });
  const event = await enqueue(testDb.db, {
    eventType: "response.submitted",
    payload: {
      sessionId,
      formId,
      formVersion: version,
      submittedAt: "2026-01-02T03:04:05.000Z",
      contentHash: "0".repeat(64),
      answers: { q_text: "second", q_num: 42 },
    },
  });
  await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
  const found = await testDb.client.query<{ id: string }>(
    `select id from webhook_deliveries where outbox_id = $1 and webhook_id = $2`,
    [event.id, webhookId],
  );
  return { outboxId: event.id, deliveryId: found.rows[0]!.id };
}

/**
 * Raw row reads, so the assertions are about the database and not about a helper.
 *
 * `testDb.client` is a `pg` client, whose default type parser turns a timestamptz
 * into a `Date` (a drizzle raw ``sql`` `` read hands back the string instead), so
 * these come back as Dates and compare with `toEqual` rather than `toBe`.
 */
async function outboxRow(
  outboxId: string,
): Promise<{ payload: Record<string, unknown>; payloadRedactedAt: Date | null }> {
  const res = await testDb.client.query<{
    payload: Record<string, unknown>;
    payload_redacted_at: Date | null;
  }>(`select payload, payload_redacted_at from outbox where id = $1`, [outboxId]);
  const row = res.rows[0]!;
  return { payload: row.payload, payloadRedactedAt: row.payload_redacted_at };
}

async function deliveryRow(deliveryId: string): Promise<{
  deliveredAt: Date | null;
  deadLetteredAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  lastStatus: number | null;
  lastResponseSnippet: string | null;
  lastResponseSnippetRedactedAt: Date | null;
}> {
  const res = await testDb.client.query<{
    delivered_at: Date | null;
    dead_lettered_at: Date | null;
    cancelled_at: Date | null;
    cancelled_reason: string | null;
    last_status: number | null;
    last_response_snippet: string | null;
    last_response_snippet_redacted_at: Date | null;
  }>(
    `select delivered_at, dead_lettered_at, cancelled_at, cancelled_reason,
            last_status, last_response_snippet, last_response_snippet_redacted_at
       from webhook_deliveries where id = $1`,
    [deliveryId],
  );
  const row = res.rows[0]!;
  return {
    deliveredAt: row.delivered_at,
    deadLetteredAt: row.dead_lettered_at,
    cancelledAt: row.cancelled_at,
    cancelledReason: row.cancelled_reason,
    lastStatus: row.last_status,
    lastResponseSnippet: row.last_response_snippet,
    lastResponseSnippetRedactedAt: row.last_response_snippet_redacted_at,
  };
}

async function tombstoneCount(sessionId: SessionId): Promise<number> {
  const res = await testDb.client.query(`select 1 from erasure_tombstones where session_id = $1`, [
    sessionId,
  ]);
  return res.rowCount ?? 0;
}

async function inReportingResponses(sessionId: SessionId): Promise<boolean> {
  const res = await testDb.client.query(`select 1 from reporting.responses where session_id = $1`, [
    sessionId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

async function inAnswersFlat(sessionId: SessionId): Promise<boolean> {
  const res = await testDb.client.query(
    `select 1 from reporting.answers_flat where session_id = $1`,
    [sessionId],
  );
  return (res.rowCount ?? 0) > 0;
}

describe("eraseSession - post-erasure state (I11, exit criterion 2)", () => {
  it("removes ledger, submission, and reporting rows; leaves a tombstone", async () => {
    const { formId, version } = await seedForm("frm_erase_post");
    const sessionId = SessionId.parse("ses_erase_post");
    await seedSubmittedWithLedger(formId, version, sessionId);

    // Pre-conditions: ledger + submission present; session visible in reporting.
    expect((await answerLedger(testDb.db, sessionId)).length).toBe(3);
    expect((await latestAnswers(testDb.db, sessionId)).size).toBe(2);
    expect(await getSubmission(testDb.db, sessionId)).toBeDefined();
    expect(await inReportingResponses(sessionId)).toBe(true);
    expect(await inAnswersFlat(sessionId)).toBe(true);

    const outcome = await eraseSession(testDb.db, formId, sessionId, "subject_request");

    // The outcome is the tombstone the caller can surface to the operator.
    expect(outcome).toMatchObject({
      sessionId,
      formId,
      formVersion: version,
      reason: "subject_request",
      alreadyErased: false,
    });
    expect(outcome.erasedAt).toBeInstanceOf(Date);

    // Content is gone.
    expect((await answerLedger(testDb.db, sessionId)).length).toBe(0);
    expect((await latestAnswers(testDb.db, sessionId)).size).toBe(0);
    expect(await getSubmission(testDb.db, sessionId)).toBeUndefined();

    // Tombstone stands; the scrubbed session shell is retained.
    expect(await tombstoneCount(sessionId)).toBe(1);
    expect(await getSession(testDb.db, sessionId)).toBeDefined();

    // Excluded from both reporting views. The submission hard-delete removes the
    // row here; the tombstone anti-join excludes it independently (verified with
    // the submission still present in reporting-retention.integration.test.ts).
    expect(await inReportingResponses(sessionId)).toBe(false);
    expect(await inAnswersFlat(sessionId)).toBe(false);
  });

  it("erases a never-submitted (in_progress) session - any state may erase", async () => {
    const { formId, version } = await seedForm("frm_erase_inprogress");
    const sessionId = SessionId.parse("ses_erase_inprogress");
    await createSession(testDb.db, {
      sessionId,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: QuestionId.parse("q_text"),
      value: "wip",
    });
    await markInProgress(testDb.db, sessionId);

    const outcome = await eraseSession(testDb.db, formId, sessionId, "subject_request");
    expect(outcome.alreadyErased).toBe(false);
    expect((await answerLedger(testDb.db, sessionId)).length).toBe(0);
    expect(await tombstoneCount(sessionId)).toBe(1);
  });
});

describe("eraseSession - idempotency and nonexistent session (exit criterion 3)", () => {
  it("is idempotent: re-erasing returns the existing tombstone unchanged", async () => {
    const { formId, version } = await seedForm("frm_erase_idem");
    const sessionId = SessionId.parse("ses_erase_idem");
    await seedSubmittedWithLedger(formId, version, sessionId);

    const first = await eraseSession(testDb.db, formId, sessionId, "subject_request");
    expect(first.alreadyErased).toBe(false);

    // A second call with a different reason must not overwrite anything.
    const second = await eraseSession(testDb.db, formId, sessionId, "different_reason");
    expect(second.alreadyErased).toBe(true);
    expect(second.reason).toBe("subject_request");
    expect(second.erasedAt).toEqual(first.erasedAt);

    expect(await tombstoneCount(sessionId)).toBe(1);
    expect((await answerLedger(testDb.db, sessionId)).length).toBe(0);
  });

  it("throws a typed SessionNotFoundError for a session that never existed", async () => {
    const { formId } = await seedForm("frm_erase_ghost");
    const sessionId = SessionId.parse("ses_erase_ghost");
    await expect(
      eraseSession(testDb.db, formId, sessionId, "subject_request"),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    try {
      await eraseSession(testDb.db, formId, sessionId, "subject_request");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SessionNotFoundError);
      expect((e as SessionNotFoundError).code).toBe("SESSION_NOT_FOUND");
    }
    expect(await tombstoneCount(sessionId)).toBe(0);
  });
});

describe("eraseSession - transactionality (I11, exit criterion 1)", () => {
  it("rolls everything back when the tombstone insert fails after the answer delete", async () => {
    const { formId, version } = await seedForm("frm_erase_rollback");
    const sessionId = SessionId.parse("ses_erase_rollback");
    await seedSubmittedWithLedger(formId, version, sessionId);
    // 059: the redaction and the cancellations run *before* the tombstone insert, so
    // the induced failure below now proves all four roll back together, not just the
    // deletes. A partial commit here would be the worst outcome the change can have:
    // a payload with no answers and no tombstone recording why.
    const queued = await seedQueuedEvent(formId, version, sessionId);
    // #304: and the snippet redaction, which runs in the same place.
    await recordDeliveryFailure(testDb.db, queued.deliveryId, "http_400", new Date(), {
      lastAttemptAt: new Date(),
      lastStatus: 400,
      lastLatencyMs: 9,
      lastRequestHeaders: null,
      lastResponseSnippet: '{"error":"invalid","received":{"q_text":"second"}}',
    });

    // Induce a real failure *after* the answer delete: a fault trigger that
    // aborts the tombstone insert, which eraseSession performs last.
    await testDb.client.query(
      `create function __fail_tombstone() returns trigger as $$
       begin raise exception 'induced failure'; end; $$ language plpgsql`,
    );
    await testDb.client.query(
      `create trigger __fail_tombstone before insert on erasure_tombstones
         for each row execute function __fail_tombstone()`,
    );

    try {
      // The induced pg error ('induced failure') is wrapped by drizzle as a
      // "Failed query" error and surfaced on `.cause`; asserting it rejects at
      // all is enough - the rollback-state checks below are the real proof.
      await expect(eraseSession(testDb.db, formId, sessionId, "subject_request")).rejects.toThrow();
    } finally {
      await testDb.client.query(`drop trigger __fail_tombstone on erasure_tombstones`);
      await testDb.client.query(`drop function __fail_tombstone()`);
    }

    // Nothing was committed: ledger intact, submission intact, no tombstone.
    expect((await answerLedger(testDb.db, sessionId)).length).toBe(3);
    expect(await getSubmission(testDb.db, sessionId)).toBeDefined();
    expect(await tombstoneCount(sessionId)).toBe(0);
    // And the session is still fully visible in reporting (nothing changed).
    expect(await inReportingResponses(sessionId)).toBe(true);

    // 059: the redaction and the cancellation rolled back with them. The payload
    // still holds the answers and the delivery is still sendable, which is the only
    // state consistent with "no erasure happened".
    const rolledBack = await outboxRow(queued.outboxId);
    expect(rolledBack.payload["answers"]).toBeDefined();
    expect(rolledBack.payloadRedactedAt).toBeNull();
    const rolledBackDelivery = await deliveryRow(queued.deliveryId);
    expect(rolledBackDelivery.cancelledAt).toBeNull();
    // #304: the snippet redaction is inside the same transaction, so a failed
    // erasure leaves the stored body exactly as it was rather than half-removing it.
    expect(rolledBackDelivery.lastResponseSnippet).toContain("second");
    expect(rolledBackDelivery.lastResponseSnippetRedactedAt).toBeNull();
  });
});

describe("eraseSession - the outbox and its deliveries (059, exit criterion 1)", () => {
  it("redacts every payload and cancels the undelivered deliveries, sparing the delivered one", async () => {
    const { formId, version } = await seedForm("frm_erase_outbox");
    const sessionId = SessionId.parse("ses_erase_outbox");
    await seedSubmittedWithLedger(formId, version, sessionId);

    // Three deliveries in the three states a real queue holds at erasure time.
    const done = await seedQueuedEvent(formId, version, sessionId);
    const pending = await seedQueuedEvent(formId, version, sessionId);
    const dead = await seedQueuedEvent(formId, version, sessionId);
    await markDeliveryDelivered(testDb.db, done.deliveryId);
    await testDb.client.query(
      `update webhook_deliveries set dead_lettered_at = now(), attempts = 10 where id = $1`,
      [dead.deliveryId],
    );

    // A second, unrelated session's event on the same form must be untouched by all
    // of this - erasure is whole-session, and nothing wider.
    const bystanderId = SessionId.parse("ses_erase_outbox_bystander");
    await seedSubmittedWithLedger(formId, version, bystanderId);
    const bystander = await seedQueuedEvent(formId, version, bystanderId);

    // Pre-condition: the answers really are sitting in every payload.
    for (const e of [done, pending, dead]) {
      const before = await outboxRow(e.outboxId);
      expect(before.payload["answers"]).toBeDefined();
      expect(before.payloadRedactedAt).toBeNull();
    }

    await eraseSession(testDb.db, formId, sessionId, "subject_request");

    // 1. All three payloads: answers gone, envelope kept, marked redacted. The mark
    //    is a column rather than the payload's shape, so "was this redacted?" is
    //    answerable for an event type that never carried answers in the first place.
    for (const e of [done, pending, dead]) {
      const after = await outboxRow(e.outboxId);
      expect(after.payload).not.toHaveProperty("answers");
      expect(after.payload).toMatchObject({
        sessionId,
        formId,
        formVersion: version,
        submittedAt: "2026-01-02T03:04:05.000Z",
        contentHash: "0".repeat(64),
      });
      expect(after.payloadRedactedAt).not.toBeNull();
    }

    // 2. The pending and dead-lettered deliveries are cancelled, with the reason.
    for (const e of [pending, dead]) {
      const row = await deliveryRow(e.deliveryId);
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelledReason).toBe(DELIVERY_CANCELLED_SESSION_ERASED);
    }
    // Cancelling a dead letter does not clear its dead-letter stamp: the row keeps
    // its whole history, and `cancelled_at` is the new terminal fact on top of it.
    expect((await deliveryRow(dead.deliveryId)).deadLetteredAt).not.toBeNull();

    // 3. The delivered one is untouched apart from its parent's redaction. That
    //    event has already left; marking it cancelled would be a fiction.
    const doneRow = await deliveryRow(done.deliveryId);
    expect(doneRow.deliveredAt).not.toBeNull();
    expect(doneRow.cancelledAt).toBeNull();
    expect(doneRow.cancelledReason).toBeNull();

    // 4. Nothing was deleted - redaction, not deletion (ADR-17 amendment). The rows
    //    are the audit record of what did and did not leave the building.
    const rows = await testDb.client.query(
      `select 1 from webhook_deliveries where id = any($1::uuid[])`,
      [[done.deliveryId, pending.deliveryId, dead.deliveryId]],
    );
    expect(rows.rowCount).toBe(3);

    // 5. The bystander session is completely unaffected.
    const other = await outboxRow(bystander.outboxId);
    expect(other.payload["answers"]).toBeDefined();
    expect(other.payloadRedactedAt).toBeNull();
    expect((await deliveryRow(bystander.deliveryId)).cancelledAt).toBeNull();
  });

  it("is idempotent: a second erase does not move the original redaction stamp", async () => {
    const { formId, version } = await seedForm("frm_erase_outbox_idem");
    const sessionId = SessionId.parse("ses_erase_outbox_idem");
    await seedSubmittedWithLedger(formId, version, sessionId);
    const queued = await seedQueuedEvent(formId, version, sessionId);

    await eraseSession(testDb.db, formId, sessionId, "subject_request");
    const first = await outboxRow(queued.outboxId);
    await eraseSession(testDb.db, formId, sessionId, "retention_policy");
    expect((await outboxRow(queued.outboxId)).payloadRedactedAt).toEqual(first.payloadRedactedAt);
  });
});

describe("the cancelled state closes the transport (059, exit criterion 3)", () => {
  it("claimDueDeliveries cannot return a cancelled row, and refuses redelivery of one", async () => {
    const { formId, version } = await seedForm("frm_erase_claim");
    const sessionId = SessionId.parse("ses_erase_claim");
    await seedSubmittedWithLedger(formId, version, sessionId);
    const queued = await seedQueuedEvent(formId, version, sessionId);

    // The testcontainer clock runs ahead of the host's, so "due" needs a margin.
    const due = new Date(Date.now() + 60_000);
    const before = await claimDueDeliveries(testDb.db, 50, due);
    expect(
      before.map((d) => d.deliveryId),
      "the delivery is claimable before erasure",
    ).toContain(queued.deliveryId);

    await eraseSession(testDb.db, formId, sessionId, "subject_request");

    const after = await claimDueDeliveries(testDb.db, 50, due);
    expect(
      after.map((d) => d.deliveryId),
      "no cancelled delivery is ever claimed",
    ).not.toContain(queued.deliveryId);

    // And the one rule the redeliver door reads agrees with the claim filter.
    expect(await redeliveryRefusalFor(testDb.db, formId, queued.deliveryId)).toBe("cancelled");
  });

  it("refuses redelivery of a delivered row whose payload was redacted", async () => {
    // Erasure cancels only the still-sendable deliveries, so a delivered row is not
    // cancelled. Its payload is redacted, which is the other half of the same rule:
    // re-sending it would post a message with no answers in it.
    const { formId, version } = await seedForm("frm_erase_redacted");
    const sessionId = SessionId.parse("ses_erase_redacted");
    await seedSubmittedWithLedger(formId, version, sessionId);
    const queued = await seedQueuedEvent(formId, version, sessionId);
    await markDeliveryDelivered(testDb.db, queued.deliveryId);

    expect(await redeliveryRefusalFor(testDb.db, formId, queued.deliveryId)).toBeUndefined();
    await eraseSession(testDb.db, formId, sessionId, "subject_request");
    expect(await redeliveryRefusalFor(testDb.db, formId, queued.deliveryId)).toBe(
      "payloadRedacted",
    );
  });
});

/**
 * Erasure reaches the delivery response snippet (issue #304).
 *
 * The gap 059 did not close: 059 redacts `outbox.payload` and cancels undelivered
 * deliveries, but `webhook_deliveries.last_response_snippet` holds up to 500 bytes of
 * the *consumer's* response body, and a consumer that echoes the request back in a
 * validation error puts the respondent's own answers there. That copy is ours, in our
 * database, and it survived erasure entirely.
 */
describe("eraseSession - the stored response snippets (issue #304)", () => {
  /** The shape a rejecting consumer really sends: the request, quoted back. */
  const ECHOED = '{"error":"invalid","received":{"q_text":"second","q_num":42}}';

  it("clears the snippet on every delivery of the session, delivered ones included", async () => {
    const { formId, version } = await seedForm("frm_erase_snippet");
    const sessionId = SessionId.parse("ses_erase_snippet");
    await seedSubmittedWithLedger(formId, version, sessionId);

    // A delivered attempt and a failed one. The delivered row matters most: 059
    // deliberately spares it from cancellation, so if the snippet rode on
    // cancellation it would still be holding the respondent's answers afterwards.
    const done = await seedQueuedEvent(formId, version, sessionId);
    const failed = await seedQueuedEvent(formId, version, sessionId);
    await markDeliveryDelivered(testDb.db, done.deliveryId, new Date(), {
      lastAttemptAt: new Date(),
      lastStatus: 200,
      lastLatencyMs: 12,
      lastRequestHeaders: { "x-qcms-signature": "v1=<masked>" },
      lastResponseSnippet: ECHOED,
    });
    await recordDeliveryFailure(testDb.db, failed.deliveryId, "http_400", new Date(), {
      lastAttemptAt: new Date(),
      lastStatus: 400,
      lastLatencyMs: 9,
      lastRequestHeaders: { "x-qcms-signature": "v1=<masked>" },
      lastResponseSnippet: ECHOED,
    });

    // A bystander session on the same form, to prove erasure is whole-session here
    // too and not a table-wide wipe.
    const bystanderId = SessionId.parse("ses_erase_snippet_bystander");
    await seedSubmittedWithLedger(formId, version, bystanderId);
    const bystander = await seedQueuedEvent(formId, version, bystanderId);
    await recordDeliveryFailure(testDb.db, bystander.deliveryId, "http_400", new Date(), {
      lastAttemptAt: new Date(),
      lastStatus: 400,
      lastLatencyMs: 9,
      lastRequestHeaders: { "x-qcms-signature": "v1=<masked>" },
      lastResponseSnippet: ECHOED,
    });

    // Pre-condition: the respondent's answers really are in the column.
    for (const e of [done, failed, bystander]) {
      expect((await deliveryRow(e.deliveryId)).lastResponseSnippet).toContain("second");
    }

    await eraseSession(testDb.db, formId, sessionId, "subject_request");

    for (const e of [done, failed]) {
      const row = await deliveryRow(e.deliveryId);
      expect(row.lastResponseSnippet).toBeNull();
      expect(row.lastResponseSnippetRedactedAt).not.toBeNull();
      // The value-free half of the attempt record stays, so the dashboard can still
      // answer "was this person's data sent anywhere, and did it arrive".
      expect(row.lastStatus).not.toBeNull();
    }
    expect((await deliveryRow(done.deliveryId)).deliveredAt).not.toBeNull();

    const untouched = await deliveryRow(bystander.deliveryId);
    expect(untouched.lastResponseSnippet).toContain("second");
    expect(untouched.lastResponseSnippetRedactedAt).toBeNull();
  });
});
