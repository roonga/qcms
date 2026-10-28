import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import { FormId, GroupId, InstanceId, QuestionId, SessionId } from "@roonga/qcms-core";
import type { AnswerValue, FormDefinition, LockedSubmission } from "@roonga/qcms-core";

import {
  SEED_WORKSPACE_ID,
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
  DEFAULT_TEST_ENVIRONMENT,
} from "../testing/harness.js";
import {
  addInstances,
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
  removeInstance,
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

async function seedForm(id: string): Promise<{ formId: FormId; version: number }> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug: `${id}-slug`,
    defaultLocale: "en",
  });
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

async function seedSubmittedWithLedger(
  formId: FormId,
  version: number,
  sessionId: SessionId,
): Promise<void> {
  await createSession(testDb.db, {
    environment: DEFAULT_TEST_ENVIRONMENT,
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

/** A delivery row is unique per (event, webhook), so each fixture needs its own endpoint. */
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

/** `testDb.client` parses a timestamptz into a `Date`, so these compare with `toEqual`. */
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

/**
 * The table name is interpolated because an identifier cannot be a bind parameter.
 * Every call site below passes a literal from this file.
 */
async function sessionRowCount(table: string, sessionId: SessionId): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from ${table} where session_id = $1`,
    [sessionId],
  );
  return res.rows[0]?.n ?? 0;
}

async function inReportingResponses(sessionId: SessionId): Promise<boolean> {
  const res = await testDb.client.query(
    `select 1 from reporting_prod.responses where session_id = $1`,
    [sessionId],
  );
  return (res.rowCount ?? 0) > 0;
}

async function inAnswersFlat(sessionId: SessionId): Promise<boolean> {
  const res = await testDb.client.query(
    `select 1 from reporting_prod.answers_flat where session_id = $1`,
    [sessionId],
  );
  return (res.rowCount ?? 0) > 0;
}

describe("eraseSession - post-erasure state (I11, exit criterion 2)", () => {
  it("removes ledger, submission, and reporting rows; leaves a tombstone", async () => {
    const { formId, version } = await seedForm("frm_erase_post");
    const sessionId = SessionId.parse("ses_erase_post");
    await seedSubmittedWithLedger(formId, version, sessionId);

    expect((await answerLedger(testDb.db, sessionId)).length).toBe(3);
    expect((await latestAnswers(testDb.db, sessionId)).size).toBe(2);
    expect(await getSubmission(testDb.db, sessionId)).toBeDefined();
    expect(await inReportingResponses(sessionId)).toBe(true);
    expect(await inAnswersFlat(sessionId)).toBe(true);

    const outcome = await eraseSession(testDb.db, formId, sessionId, "subject_request");

    expect(outcome).toMatchObject({
      sessionId,
      formId,
      formVersion: version,
      reason: "subject_request",
      alreadyErased: false,
    });
    expect(outcome.erasedAt).toBeInstanceOf(Date);

    expect((await answerLedger(testDb.db, sessionId)).length).toBe(0);
    expect((await latestAnswers(testDb.db, sessionId)).size).toBe(0);
    expect(await getSubmission(testDb.db, sessionId)).toBeUndefined();

    expect(await tombstoneCount(sessionId)).toBe(1);
    expect(await getSession(testDb.db, sessionId)).toBeDefined();

    expect(await inReportingResponses(sessionId)).toBe(false);
    expect(await inAnswersFlat(sessionId)).toBe(false);
  });

  it("leaves no answers, submission or roster row for the session, by count", async () => {
    const { formId, version } = await seedForm("frm_erase_roster");
    const sessionId = SessionId.parse("ses_erase_roster");
    await seedSubmittedWithLedger(formId, version, sessionId);

    const pax = GroupId.parse("grp_pax");
    await addInstances(testDb.db, {
      sessionId,
      groupId: pax,
      instanceIds: [InstanceId.parse("ins_one"), InstanceId.parse("ins_two")],
    });
    await removeInstance(testDb.db, {
      sessionId,
      groupId: pax,
      instanceId: InstanceId.parse("ins_two"),
    });
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: QuestionId.parse("q_passport"),
      instanceId: InstanceId.parse("ins_one"),
      value: "P-1234",
    });

    expect(await sessionRowCount("answers", sessionId)).toBe(4);
    expect(await sessionRowCount("submissions", sessionId)).toBe(1);
    expect(await sessionRowCount("answer_group_instances", sessionId)).toBe(3);

    await eraseSession(testDb.db, formId, sessionId, "subject_request");

    expect(await sessionRowCount("answers", sessionId)).toBe(0);
    expect(await sessionRowCount("submissions", sessionId)).toBe(0);
    expect(await sessionRowCount("answer_group_instances", sessionId)).toBe(0);
    expect(await tombstoneCount(sessionId)).toBe(1);
  });

  it("erases a never-submitted (in_progress) session - any state may erase", async () => {
    const { formId, version } = await seedForm("frm_erase_inprogress");
    const sessionId = SessionId.parse("ses_erase_inprogress");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
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
    const queued = await seedQueuedEvent(formId, version, sessionId);
    await recordDeliveryFailure(testDb.db, queued.deliveryId, "http_400", new Date(), {
      lastAttemptAt: new Date(),
      lastStatus: 400,
      lastLatencyMs: 9,
      lastRequestHeaders: null,
      lastResponseSnippet: '{"error":"invalid","received":{"q_text":"second"}}',
    });

    // `eraseSession` inserts the tombstone last, so aborting that insert fails the
    // transaction after the answer delete.
    await testDb.client.query(
      `create function __fail_tombstone() returns trigger as $$
       begin raise exception 'induced failure'; end; $$ language plpgsql`,
    );
    await testDb.client.query(
      `create trigger __fail_tombstone before insert on erasure_tombstones
         for each row execute function __fail_tombstone()`,
    );

    try {
      // Drizzle wraps the induced pg error, so only the rejection itself is asserted.
      await expect(eraseSession(testDb.db, formId, sessionId, "subject_request")).rejects.toThrow();
    } finally {
      await testDb.client.query(`drop trigger __fail_tombstone on erasure_tombstones`);
      await testDb.client.query(`drop function __fail_tombstone()`);
    }

    expect((await answerLedger(testDb.db, sessionId)).length).toBe(3);
    expect(await getSubmission(testDb.db, sessionId)).toBeDefined();
    expect(await tombstoneCount(sessionId)).toBe(0);
    expect(await inReportingResponses(sessionId)).toBe(true);

    const rolledBack = await outboxRow(queued.outboxId);
    expect(rolledBack.payload["answers"]).toBeDefined();
    expect(rolledBack.payloadRedactedAt).toBeNull();
    const rolledBackDelivery = await deliveryRow(queued.deliveryId);
    expect(rolledBackDelivery.cancelledAt).toBeNull();
    expect(rolledBackDelivery.lastResponseSnippet).toContain("second");
    expect(rolledBackDelivery.lastResponseSnippetRedactedAt).toBeNull();
  });
});

describe("eraseSession - the outbox and its deliveries (059, exit criterion 1)", () => {
  it("redacts every payload and cancels the undelivered deliveries, sparing the delivered one", async () => {
    const { formId, version } = await seedForm("frm_erase_outbox");
    const sessionId = SessionId.parse("ses_erase_outbox");
    await seedSubmittedWithLedger(formId, version, sessionId);

    const done = await seedQueuedEvent(formId, version, sessionId);
    const pending = await seedQueuedEvent(formId, version, sessionId);
    const dead = await seedQueuedEvent(formId, version, sessionId);
    await markDeliveryDelivered(testDb.db, done.deliveryId);
    await testDb.client.query(
      `update webhook_deliveries set dead_lettered_at = now(), attempts = 10 where id = $1`,
      [dead.deliveryId],
    );

    const bystanderId = SessionId.parse("ses_erase_outbox_bystander");
    await seedSubmittedWithLedger(formId, version, bystanderId);
    const bystander = await seedQueuedEvent(formId, version, bystanderId);

    for (const e of [done, pending, dead]) {
      const before = await outboxRow(e.outboxId);
      expect(before.payload["answers"]).toBeDefined();
      expect(before.payloadRedactedAt).toBeNull();
    }

    await eraseSession(testDb.db, formId, sessionId, "subject_request");

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

    for (const e of [pending, dead]) {
      const row = await deliveryRow(e.deliveryId);
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelledReason).toBe(DELIVERY_CANCELLED_SESSION_ERASED);
    }
    expect((await deliveryRow(dead.deliveryId)).deadLetteredAt).not.toBeNull();

    const doneRow = await deliveryRow(done.deliveryId);
    expect(doneRow.deliveredAt).not.toBeNull();
    expect(doneRow.cancelledAt).toBeNull();
    expect(doneRow.cancelledReason).toBeNull();

    const rows = await testDb.client.query(
      `select 1 from webhook_deliveries where id = any($1::uuid[])`,
      [[done.deliveryId, pending.deliveryId, dead.deliveryId]],
    );
    expect(rows.rowCount).toBe(3);

    const other = await outboxRow(bystander.outboxId);
    expect(other.payload["answers"]).toBeDefined();
    expect(other.payloadRedactedAt).toBeNull();
    expect((await deliveryRow(bystander.deliveryId)).cancelledAt).toBeNull();
  });

  it("leaves a repeat payload with no answers, no instance id and no count (case 52)", async () => {
    const { formId, version } = await seedForm("frm_erase_repeat");
    const sessionId = SessionId.parse("ses_erase_repeat");
    await seedSubmittedWithLedger(formId, version, sessionId);

    const webhookId = "whk_erase_repeat";
    await insertWebhook(testDb.db, {
      webhookId,
      formId,
      url: "https://consumer.example.com/erase-repeat",
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
        answers: [
          { questionId: "q_booking_ref", value: "ABC123" },
          { questionId: "q_name", instanceId: "ins_pax_a", value: "Ada" },
          { questionId: "q_name", instanceId: "ins_pax_b", value: "Grace" },
        ],
      },
    });
    await insertDelivery(testDb.db, { outboxId: event.id, webhookId });

    const before = await outboxRow(event.id);
    expect(JSON.stringify(before.payload)).toContain("ins_pax_a");

    await eraseSession(testDb.db, formId, sessionId, "subject_request");

    const after = await outboxRow(event.id);
    expect(after.payload).not.toHaveProperty("answers");
    expect(after.payloadRedactedAt).not.toBeNull();
    const remaining = JSON.stringify(after.payload);
    expect(remaining).not.toContain("ins_");
    expect(remaining).not.toContain("Ada");
    expect(remaining).not.toContain("ABC123");
    expect(Object.keys(after.payload).sort()).toEqual([
      "contentHash",
      "formId",
      "formVersion",
      "sessionId",
      "submittedAt",
    ]);

    await expect(
      testDb.client.query(
        `update outbox set payload = payload || '{"answers": []}'::jsonb where id = $1`,
        [event.id],
      ),
    ).rejects.toThrow(/outbox_redacted_payload_has_no_answers/);
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

    expect(await redeliveryRefusalFor(testDb.db, formId, queued.deliveryId)).toBe("cancelled");
  });

  it("refuses redelivery of a delivered row whose payload was redacted", async () => {
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

describe("eraseSession - the stored response snippets (issue #304)", () => {
  const ECHOED = '{"error":"invalid","received":{"q_text":"second","q_num":42}}';

  it("clears the snippet on every delivery of the session, delivered ones included", async () => {
    const { formId, version } = await seedForm("frm_erase_snippet");
    const sessionId = SessionId.parse("ses_erase_snippet");
    await seedSubmittedWithLedger(formId, version, sessionId);

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

    for (const e of [done, failed, bystander]) {
      expect((await deliveryRow(e.deliveryId)).lastResponseSnippet).toContain("second");
    }

    await eraseSession(testDb.db, formId, sessionId, "subject_request");

    for (const e of [done, failed]) {
      const row = await deliveryRow(e.deliveryId);
      expect(row.lastResponseSnippet).toBeNull();
      expect(row.lastResponseSnippetRedactedAt).not.toBeNull();
      expect(row.lastStatus).not.toBeNull();
    }
    expect((await deliveryRow(done.deliveryId)).deliveredAt).not.toBeNull();

    const untouched = await deliveryRow(bystander.deliveryId);
    expect(untouched.lastResponseSnippet).toContain("second");
    expect(untouched.lastResponseSnippetRedactedAt).toBeNull();
  });
});
