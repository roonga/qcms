import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import { FormId, QuestionId, SessionId } from "@qcms/core";
import type { AnswerValue, FormDefinition, LockedSubmission } from "@qcms/core";

import { startTestDb, type TestDb } from "../testing/harness.js";
import {
  answerLedger,
  appendAnswer,
  createForm,
  createSession,
  eraseSession,
  getSession,
  getSubmission,
  insertFormVersion,
  insertSubmission,
  latestAnswers,
  markInProgress,
  markSubmitted,
  SessionNotFoundError,
} from "./index.js";

const BOOT_TIMEOUT = 120_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

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

describe("eraseSession — post-erasure state (I11, exit criterion 2)", () => {
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

    const outcome = await eraseSession(testDb.db, sessionId, "subject_request");

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

  it("erases a never-submitted (in_progress) session — any state may erase", async () => {
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

    const outcome = await eraseSession(testDb.db, sessionId, "subject_request");
    expect(outcome.alreadyErased).toBe(false);
    expect((await answerLedger(testDb.db, sessionId)).length).toBe(0);
    expect(await tombstoneCount(sessionId)).toBe(1);
  });
});

describe("eraseSession — idempotency and nonexistent session (exit criterion 3)", () => {
  it("is idempotent: re-erasing returns the existing tombstone unchanged", async () => {
    const { formId, version } = await seedForm("frm_erase_idem");
    const sessionId = SessionId.parse("ses_erase_idem");
    await seedSubmittedWithLedger(formId, version, sessionId);

    const first = await eraseSession(testDb.db, sessionId, "subject_request");
    expect(first.alreadyErased).toBe(false);

    // A second call with a different reason must not overwrite anything.
    const second = await eraseSession(testDb.db, sessionId, "different_reason");
    expect(second.alreadyErased).toBe(true);
    expect(second.reason).toBe("subject_request");
    expect(second.erasedAt).toEqual(first.erasedAt);

    expect(await tombstoneCount(sessionId)).toBe(1);
    expect((await answerLedger(testDb.db, sessionId)).length).toBe(0);
  });

  it("throws a typed SessionNotFoundError for a session that never existed", async () => {
    const sessionId = SessionId.parse("ses_erase_ghost");
    await expect(eraseSession(testDb.db, sessionId, "subject_request")).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    try {
      await eraseSession(testDb.db, sessionId, "subject_request");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SessionNotFoundError);
      expect((e as SessionNotFoundError).code).toBe("SESSION_NOT_FOUND");
    }
    expect(await tombstoneCount(sessionId)).toBe(0);
  });
});

describe("eraseSession — transactionality (I11, exit criterion 1)", () => {
  it("rolls everything back when the tombstone insert fails after the answer delete", async () => {
    const { formId, version } = await seedForm("frm_erase_rollback");
    const sessionId = SessionId.parse("ses_erase_rollback");
    await seedSubmittedWithLedger(formId, version, sessionId);

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
      // all is enough — the rollback-state checks below are the real proof.
      await expect(eraseSession(testDb.db, sessionId, "subject_request")).rejects.toThrow();
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
  });
});
