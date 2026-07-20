import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import { FormId, LinkId, QuestionId, SessionId } from "@qcms/core";
import type { AnswerValue, FormDefinition, LockedSubmission } from "@qcms/core";

import * as schema from "../schema/index.js";
import { startTestDb, type TestDb } from "../testing/harness.js";
import {
  answerLedger,
  appendAnswer,
  claimDue,
  closeForm,
  consumeSecureLink,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  deleteDraft,
  deprecateQuestionVersion,
  enqueue,
  expireSessions,
  getDraft,
  getFormVersion,
  getLatestPublishedVersion,
  getQuestionVersion,
  getSecureLink,
  getSession,
  getSubmission,
  insertFormVersion,
  insertSecureLink,
  insertSubmission,
  isQuestionIdTaken,
  latestAnswers,
  listDeadLetters,
  listFormVersions,
  listQuestions,
  markDelivered,
  markInProgress,
  markSubmitted,
  publishQuestionVersion,
  recordFailure,
  reopenForm,
  resetForRedelivery,
  revokeSecureLink,
  upsertDraft,
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

// The domain JSONB is opaque to Postgres; tests store empty documents.
const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;
const emptyQuestionDef = { any: "shape" } as unknown as Parameters<
  typeof createQuestionVersion
>[1]["definition"];

/** Seed a form + one published form_version so sessions/answers have valid FKs. */
async function seedPublishedForm(id: string): Promise<{ formId: FormId; version: number }> {
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

describe("questions helpers", () => {
  it("creates a question, versions it, publishes and deprecates", async () => {
    const questionId = QuestionId.parse("q_lifecycle");
    await createQuestion(testDb.db, { questionId, slug: "q-lifecycle-slug" });

    const v1 = await createQuestionVersion(testDb.db, { questionId, definition: emptyQuestionDef });
    const v2 = await createQuestionVersion(testDb.db, { questionId, definition: emptyQuestionDef });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.status).toBe("draft");

    const published = await publishQuestionVersion(testDb.db, { questionId, version: 1 });
    expect(published?.status).toBe("published");
    expect(published?.publishedAt).toBeInstanceOf(Date);

    const deprecated = await deprecateQuestionVersion(testDb.db, { questionId, version: 1 });
    expect(deprecated?.status).toBe("deprecated");

    const fetched = await getQuestionVersion(testDb.db, questionId, 2);
    expect(fetched?.version).toBe(2);
    expect(await getQuestionVersion(testDb.db, questionId, 99)).toBeUndefined();
  });

  it("summarizes the latest version per question in listQuestions", async () => {
    const questionId = QuestionId.parse("q_summary");
    await createQuestion(testDb.db, { questionId, slug: "q-summary-slug" });
    await createQuestionVersion(testDb.db, { questionId, definition: emptyQuestionDef });
    await createQuestionVersion(testDb.db, { questionId, definition: emptyQuestionDef });
    await publishQuestionVersion(testDb.db, { questionId, version: 2 });

    const summaries = await listQuestions(testDb.db);
    const summary = summaries.find((s) => s.questionId === questionId);
    expect(summary).toMatchObject({
      latestVersion: 2,
      latestStatus: "published",
      slug: "q-summary-slug",
    });
  });

  it("reports questionId use, including historic answer rows (R6)", async () => {
    const questionId = QuestionId.parse("q_taken");
    expect(await isQuestionIdTaken(testDb.db, questionId)).toBe(false);
    await createQuestion(testDb.db, { questionId, slug: "q-taken-slug" });
    expect(await isQuestionIdTaken(testDb.db, questionId)).toBe(true);

    // An id surviving only in the answer ledger still counts as taken.
    const { formId, version } = await seedPublishedForm("frm_taken");
    const sessionId = SessionId.parse("ses_taken");
    await createSession(testDb.db, {
      sessionId,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const historic = QuestionId.parse("q_historic_only");
    await appendAnswer(testDb.db, { sessionId, questionId: historic, value: "x" });
    expect(await isQuestionIdTaken(testDb.db, historic)).toBe(true);
  });
});

describe("forms helpers", () => {
  it("creates a form, upserts/reads/deletes its draft", async () => {
    const formId = FormId.parse("frm_draft");
    await createForm(testDb.db, { formId, slug: "frm-draft-slug", defaultLocale: "en" });

    const first = await upsertDraft(testDb.db, { formId, definition: emptyDef });
    const firstUpdatedAt = first.updatedAt.getTime();
    const second = await upsertDraft(testDb.db, { formId, definition: emptyDef });
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(firstUpdatedAt);

    expect((await getDraft(testDb.db, formId))?.formId).toBe(formId);
    expect(await deleteDraft(testDb.db, formId)).toBe(true);
    expect(await getDraft(testDb.db, formId)).toBeUndefined();
    expect(await deleteDraft(testDb.db, formId)).toBe(false);
  });

  it("inserts versions with monotonic numbers and reads latest/list", async () => {
    const formId = FormId.parse("frm_versions");
    await createForm(testDb.db, { formId, slug: "frm-versions-slug", defaultLocale: "en" });
    const v1 = await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
    const v2 = await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.1.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await getFormVersion(testDb.db, formId, 2))?.compilerVersion).toBe("1.1.0");
    expect((await getLatestPublishedVersion(testDb.db, formId))?.version).toBe(2);
    expect((await listFormVersions(testDb.db, formId)).map((r) => r.version)).toEqual([2, 1]);
  });

  it("closes and reopens a form", async () => {
    const formId = FormId.parse("frm_status");
    await createForm(testDb.db, { formId, slug: "frm-status-slug", defaultLocale: "en" });
    expect((await closeForm(testDb.db, formId))?.status).toBe("closed");
    expect((await reopenForm(testDb.db, formId))?.status).toBe("open");
  });
});

describe("sessions helpers and the form-version pin (I4)", () => {
  it("creates, reads, and transitions a session without ever changing the pin", async () => {
    const { formId, version } = await seedPublishedForm("frm_session");
    const sessionId = SessionId.parse("ses_pin");
    const created = await createSession(testDb.db, {
      sessionId,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(created.status).toBe("created");
    expect(created.formVersion).toBe(version);

    await markInProgress(testDb.db, sessionId);
    await markSubmitted(testDb.db, sessionId);

    const after = await getSession(testDb.db, sessionId);
    // Behavioral proof of the structural pin: every mutating helper ran, the
    // pin is unchanged.
    expect(after?.formVersion).toBe(version);
    expect(after?.status).toBe("submitted");
  });

  it("expires only non-terminal sessions past their expiry", async () => {
    const { formId, version } = await seedPublishedForm("frm_expire");
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86_400_000);

    const mk = async (suffix: string, expiresAt: Date, terminal: boolean): Promise<SessionId> => {
      const sessionId = SessionId.parse(`ses_expire_${suffix}`);
      await createSession(testDb.db, {
        sessionId,
        formId,
        formVersion: version,
        accessMode: "anonymous",
        expiresAt,
      });
      if (terminal) await markSubmitted(testDb.db, sessionId);
      return sessionId;
    };

    const abandoned = await mk("abandoned", past, false);
    const submitted = await mk("submitted", past, true);
    const live = await mk("live", future, false);

    const expired = await expireSessions(testDb.db, new Date());
    const expiredIds = new Set(expired.map((r) => r.sessionId));
    expect(expiredIds.has(abandoned)).toBe(true);
    expect(expiredIds.has(submitted)).toBe(false);
    expect(expiredIds.has(live)).toBe(false);
    expect((await getSession(testDb.db, submitted))?.status).toBe("submitted");
    expect((await getSession(testDb.db, live))?.status).toBe("created");
  });
});

describe("secure links helpers", () => {
  it("inserts, reads, and revokes a link", async () => {
    const formId = FormId.parse("frm_link");
    await createForm(testDb.db, { formId, slug: "frm-link-slug", defaultLocale: "en" });
    const linkId = LinkId.parse("lnk_basic");
    await insertSecureLink(testDb.db, {
      linkId,
      formId,
      expiresAt: new Date(Date.now() + 86_400_000),
      oneTime: true,
    });
    expect((await getSecureLink(testDb.db, linkId))?.oneTime).toBe(true);

    expect((await revokeSecureLink(testDb.db, linkId))?.revokedAt).toBeInstanceOf(Date);
    // Revoked links cannot be consumed.
    expect(await consumeSecureLink(testDb.db, linkId, new Date())).toBeUndefined();
    // Idempotent revoke.
    expect(await revokeSecureLink(testDb.db, linkId)).toBeUndefined();
  });

  it("consumes a one-time link exactly once (sequential)", async () => {
    const formId = FormId.parse("frm_consume");
    await createForm(testDb.db, { formId, slug: "frm-consume-slug", defaultLocale: "en" });
    const linkId = LinkId.parse("lnk_once");
    await insertSecureLink(testDb.db, {
      linkId,
      formId,
      expiresAt: new Date(Date.now() + 86_400_000),
      oneTime: true,
    });
    const now = new Date();
    expect(await consumeSecureLink(testDb.db, linkId, now)).toBeDefined();
    expect(await consumeSecureLink(testDb.db, linkId, now)).toBeUndefined();
  });
});

describe("answers helpers", () => {
  it("resolves the latest answer per question across revisions", async () => {
    const { formId, version } = await seedPublishedForm("frm_answers");
    const sessionId = SessionId.parse("ses_answers");
    await createSession(testDb.db, {
      sessionId,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const qA = QuestionId.parse("q_a");
    const qB = QuestionId.parse("q_b");
    const t0 = Date.now();
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: qA,
      value: "first",
      answeredAt: new Date(t0),
    });
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: qA,
      value: "second",
      answeredAt: new Date(t0 + 1000),
    });
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: qA,
      value: "third",
      answeredAt: new Date(t0 + 2000),
    });
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: qB,
      value: 42,
      answeredAt: new Date(t0 + 3000),
    });

    const latest = await latestAnswers(testDb.db, sessionId);
    expect(latest.size).toBe(2);
    expect(latest.get(qA)).toBe("third");
    expect(latest.get(qB)).toBe(42);

    const ledger = await answerLedger(testDb.db, sessionId);
    expect(ledger).toHaveLength(4);
    expect(ledger.map((r) => r.value)).toEqual(["first", "second", "third", 42]);
  });
});

describe("submissions helpers", () => {
  it("inserts and reads a submission lock", async () => {
    const { formId, version } = await seedPublishedForm("frm_submission");
    const sessionId = SessionId.parse("ses_submission");
    await createSession(testDb.db, {
      sessionId,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const locked = {
      answers: [],
      flowState: { visibleQuestions: [], visibleSteps: [] },
      contentHash: "a".repeat(64),
    } as unknown as LockedSubmission;
    const row = await insertSubmission(testDb.db, {
      sessionId,
      contentHash: "a".repeat(64),
      lockedAnswers: locked,
    });
    expect(row.sessionId).toBe(sessionId);
    expect((await getSubmission(testDb.db, sessionId))?.contentHash).toBe("a".repeat(64));
  });
});

describe("outbox helpers", () => {
  it("enqueues, claims, marks delivered", async () => {
    const event = await enqueue(testDb.db, { eventType: "response.submitted", payload: { a: 1 } });
    expect(event.attempts).toBe(0);

    const due = await claimDue(testDb.db, 50, new Date(Date.now() + 1000));
    expect(due.some((r) => r.id === event.id)).toBe(true);

    const delivered = await markDelivered(testDb.db, event.id);
    expect(delivered?.deliveredAt).toBeInstanceOf(Date);

    // Delivered rows are no longer claimed.
    const dueAfter = await claimDue(testDb.db, 50, new Date(Date.now() + 1000));
    expect(dueAfter.some((r) => r.id === event.id)).toBe(false);
  });

  it("records failures with backoff and dead-letters after the max, then redelivers", async () => {
    const event = await enqueue(testDb.db, { eventType: "form.published", payload: {} });
    const from = new Date("2026-07-20T00:00:00.000Z");

    let row = await recordFailure(testDb.db, event.id, "boom", from);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe("boom");
    expect(row?.deadLetteredAt).toBeNull();
    expect(row?.nextAttemptAt.getTime()).toBe(from.getTime() + 60_000);

    for (let i = 2; i <= 10; i++) {
      row = await recordFailure(testDb.db, event.id, `boom-${i}`, from);
    }
    expect(row?.attempts).toBe(10);
    expect(row?.deadLetteredAt).toEqual(from);

    // Dead-lettered rows surface for the admin view and are excluded from claims.
    const deadLetters = await listDeadLetters(testDb.db);
    expect(deadLetters.some((r) => r.id === event.id)).toBe(true);
    const dueWhileDead = await claimDue(testDb.db, 50, new Date(Date.now() + 1000));
    expect(dueWhileDead.some((r) => r.id === event.id)).toBe(false);

    // Manual redelivery resets it.
    const reset = await resetForRedelivery(testDb.db, event.id);
    expect(reset?.attempts).toBe(0);
    expect(reset?.deadLetteredAt).toBeNull();
    const dueAfterReset = await claimDue(testDb.db, 50, new Date(Date.now() + 1000));
    expect(dueAfterReset.some((r) => r.id === event.id)).toBe(true);
  });

  it("recordFailure returns undefined for a missing row", async () => {
    expect(
      await recordFailure(testDb.db, "00000000-0000-0000-0000-000000000000", "x"),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Concurrency: genuine concurrent transactions against the live database via a
// connection pool (the single harness Client cannot run overlapping work).
// ---------------------------------------------------------------------------
describe("concurrency (live, pooled connections)", () => {
  let pool: pg.Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(() => {
    pool = new Pool({ connectionString: testDb.connectionUri, max: 8 });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("appendAnswer under concurrent writers loses no rows and resolves the latest", async () => {
    const { formId, version } = await seedPublishedForm("frm_concurrent_answers");
    const sessionId = SessionId.parse("ses_concurrent_answers");
    await createSession(testDb.db, {
      sessionId,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const qId = QuestionId.parse("q_concurrent");
    const N = 12;
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendAnswer(db, {
          sessionId,
          questionId: qId,
          value: `v${i}` as AnswerValue,
          answeredAt: new Date(t0 + i * 1000),
        }),
      ),
    );

    const ledger = await answerLedger(testDb.db, sessionId);
    expect(ledger).toHaveLength(N); // every concurrent append landed
    const latest = await latestAnswers(testDb.db, sessionId);
    expect(latest.size).toBe(1);
    expect(latest.get(qId)).toBe(`v${N - 1}`); // the newest answered_at wins
  });

  it("consumeSecureLink: exactly one of two concurrent consumers wins", async () => {
    const formId = FormId.parse("frm_race_link");
    await createForm(testDb.db, { formId, slug: "frm-race-link-slug", defaultLocale: "en" });
    const linkId = LinkId.parse("lnk_race");
    await insertSecureLink(testDb.db, {
      linkId,
      formId,
      expiresAt: new Date(Date.now() + 86_400_000),
      oneTime: true,
    });

    const now = new Date();
    const [a, b] = await Promise.all([
      consumeSecureLink(db, linkId, now),
      consumeSecureLink(db, linkId, now),
    ]);
    const winners = [a, b].filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);

    const stored = await getSecureLink(testDb.db, linkId);
    expect(stored?.consumedAt).toBeInstanceOf(Date);
  });

  it("claimDue: two concurrent claimers never double-claim (FOR UPDATE SKIP LOCKED)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const row = await enqueue(testDb.db, { eventType: "race.event", payload: { i } });
      ids.push(row.id);
    }
    const idSet = new Set(ids);
    const due = new Date(Date.now() + 1000);

    // Barrier: hold both transactions open (locks held) until both have claimed,
    // so SKIP LOCKED must hand them disjoint rows.
    let resolveA!: () => void;
    let resolveB!: () => void;
    const aClaimed = new Promise<void>((r) => (resolveA = r));
    const bClaimed = new Promise<void>((r) => (resolveB = r));

    let claimedA: string[] = [];
    let claimedB: string[] = [];

    const txA = db.transaction(async (tx) => {
      claimedA = (await claimDue(tx, 5, due)).map((r) => r.id).filter((id) => idSet.has(id));
      resolveA();
      await bClaimed;
    });
    const txB = db.transaction(async (tx) => {
      claimedB = (await claimDue(tx, 5, due)).map((r) => r.id).filter((id) => idSet.has(id));
      resolveB();
      await aClaimed;
    });
    await Promise.all([txA, txB]);

    const overlap = claimedA.filter((id) => claimedB.includes(id));
    expect(overlap).toEqual([]); // no row claimed by both
    expect(new Set([...claimedA, ...claimedB])).toEqual(idSet); // all six claimed exactly once
  });
});
