import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import { FormId, QuestionId, SessionId } from "@qcms/core";
import type { AnswerValue, FormDefinition, LockedSubmission } from "@qcms/core";

import { erasureTombstones } from "../schema/index.js";
import { startTestDb, type TestDb } from "../testing/harness.js";
import {
  appendAnswer,
  createForm,
  createSession,
  getSession,
  insertFormVersion,
  insertSubmission,
  markInProgress,
  markSubmitted,
  purgeExpired,
  sweepExpiredSessions,
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

/** Build a LockedSubmission whose canonical answers key by questionId. */
function lockedSubmission(
  entries: ReadonlyArray<{ questionId: string; value: AnswerValue }>,
): LockedSubmission {
  return {
    answers: entries.map((e) => ({ questionId: QuestionId.parse(e.questionId), value: e.value })),
    // The view reads only `answers`; flowState/contentHash are opaque JSONB here.
    flowState: { visited: [], hidden: [] },
    contentHash: "0".repeat(64),
  } as unknown as LockedSubmission;
}

/** Create a submitted session with a submission lock holding `entries`. */
async function seedSubmitted(
  formId: FormId,
  version: number,
  sessionId: SessionId,
  entries: ReadonlyArray<{ questionId: string; value: AnswerValue }>,
  accessMode: "anonymous" | "secure_link" = "anonymous",
): Promise<void> {
  await createSession(testDb.db, {
    sessionId,
    formId,
    formVersion: version,
    accessMode,
    // Secure-link sessions need a linkId FK; keep the view tests on anonymous.
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await markSubmitted(testDb.db, sessionId);
  await insertSubmission(testDb.db, {
    sessionId,
    contentHash: "0".repeat(64),
    lockedAnswers: lockedSubmission(entries),
    submittedAt: new Date("2026-01-02T03:04:05.000Z"),
  });
}

describe("reporting.responses view", () => {
  it("shows submitted sessions with answers keyed by questionId; hides others", async () => {
    const { formId, version } = await seedForm("frm_report");

    const submitted = SessionId.parse("ses_report_submitted");
    await seedSubmitted(formId, version, submitted, [
      { questionId: "q_text", value: "hello" },
      { questionId: "q_num", value: 42 },
      { questionId: "q_bool", value: true },
      { questionId: "q_multi", value: ["opt_a", "opt_b"] as unknown as AnswerValue },
    ]);

    // in_progress: future expiry so the sweep below never touches it.
    const inProgress = SessionId.parse("ses_report_inprogress");
    await createSession(testDb.db, {
      sessionId: inProgress,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await markInProgress(testDb.db, inProgress);

    // expired: past expiry, then swept to `expired`.
    const expired = SessionId.parse("ses_report_expired");
    await createSession(testDb.db, {
      sessionId: expired,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() - 1000),
    });
    await sweepExpiredSessions(testDb.db, new Date());
    expect((await getSession(testDb.db, expired))?.status).toBe("expired");

    const rows = await testDb.client.query<{ session_id: string }>(
      `select session_id from reporting.responses where form_id = $1`,
      [formId],
    );
    const ids = rows.rows.map((r) => r.session_id);
    expect(ids).toContain(submitted);
    expect(ids).not.toContain(inProgress);
    expect(ids).not.toContain(expired);
  });

  it("JSONB answers match the locked submission exactly", async () => {
    const res = await testDb.client.query<{
      answers: Record<string, unknown>;
      access_mode: string;
      form_version: number;
    }>(`select answers, access_mode, form_version from reporting.responses where session_id = $1`, [
      "ses_report_submitted",
    ]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0]!.answers).toEqual({
      q_text: "hello",
      q_num: 42,
      q_bool: true,
      q_multi: ["opt_a", "opt_b"],
    });
    expect(res.rows[0]!.access_mode).toBe("anonymous");
  });

  it("excludes erased sessions by the tombstone anti-join", async () => {
    const { formId, version } = await seedForm("frm_erased");
    const erased = SessionId.parse("ses_erased");
    await seedSubmitted(formId, version, erased, [{ questionId: "q_text", value: "secret" }]);

    // The submission row still exists (016's delete path is not built yet); the
    // tombstone alone must remove the row from the view.
    await testDb.db.insert(erasureTombstones).values({
      sessionId: erased,
      formId,
      formVersion: version,
      reason: "subject_request",
    });

    const res = await testDb.client.query(
      `select session_id from reporting.responses where session_id = $1`,
      [erased],
    );
    expect(res.rowCount).toBe(0);
  });
});

describe("reporting.answers_flat view", () => {
  it("emits one row per (submitted session, questionId, value)", async () => {
    const res = await testDb.client.query<{ question_id: string; value: unknown }>(
      `select question_id, value from reporting.answers_flat where session_id = $1 order by question_id`,
      ["ses_report_submitted"],
    );
    expect(res.rows).toEqual([
      { question_id: "q_bool", value: true },
      { question_id: "q_multi", value: ["opt_a", "opt_b"] },
      { question_id: "q_num", value: 42 },
      { question_id: "q_text", value: "hello" },
    ]);
  });

  it("inherits the submitted-only, non-erased exclusion from reporting.responses", async () => {
    // The erased session contributes no flat rows either.
    const res = await testDb.client.query(
      `select 1 from reporting.answers_flat where session_id = $1`,
      ["ses_erased"],
    );
    expect(res.rowCount).toBe(0);
  });
});

describe("reporting contract - no column drift", () => {
  // The documented contract in docs/reporting-view.md. Assert the live view
  // column lists (ordinal order) match, so the doc can never silently drift.
  const EXPECTED: Record<string, string[]> = {
    responses: ["session_id", "form_id", "form_version", "submitted_at", "access_mode", "answers"],
    answers_flat: ["session_id", "form_id", "form_version", "submitted_at", "question_id", "value"],
  };

  it("matches the live reporting schema view columns", async () => {
    const res = await testDb.client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'reporting'
        order by table_name, ordinal_position`,
    );
    const live: Record<string, string[]> = {};
    for (const row of res.rows) {
      (live[row.table_name] ??= []).push(row.column_name);
    }
    expect(live).toEqual(EXPECTED);
  });
});

describe("sweepExpiredSessions", () => {
  it("expires at the exact expiresAt instant, not strictly after (010 convention)", async () => {
    const { formId, version } = await seedForm("frm_sweep_boundary");
    const now = new Date("2026-03-01T00:00:00.000Z");

    const atBoundary = SessionId.parse("ses_sweep_at");
    await createSession(testDb.db, {
      sessionId: atBoundary,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: now, // exactly equal → expired
    });
    const justAfter = SessionId.parse("ses_sweep_after");
    await createSession(testDb.db, {
      sessionId: justAfter,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(now.getTime() + 1), // 1ms in the future → still valid
    });

    const result = await sweepExpiredSessions(testDb.db, now);
    const swept = result.expired.map((r) => r.sessionId);
    expect(swept).toContain(atBoundary);
    expect(swept).not.toContain(justAfter);
    expect((await getSession(testDb.db, atBoundary))?.status).toBe("expired");
    expect((await getSession(testDb.db, justAfter))?.status).toBe("created");
  });

  it("never expires a submitted session and is idempotent on re-run", async () => {
    const { formId, version } = await seedForm("frm_sweep_submit");
    const now = new Date("2026-04-01T00:00:00.000Z");

    // A submitted session whose expiry is in the past - must stay submitted.
    const submitted = SessionId.parse("ses_sweep_submitted");
    await createSession(testDb.db, {
      sessionId: submitted,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(now.getTime() - 10_000),
    });
    await markSubmitted(testDb.db, submitted);

    const abandoned = SessionId.parse("ses_sweep_abandoned");
    await createSession(testDb.db, {
      sessionId: abandoned,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(now.getTime() - 10_000),
    });

    const first = await sweepExpiredSessions(testDb.db, now);
    const firstIds = first.expired.map((r) => r.sessionId);
    expect(firstIds).toContain(abandoned);
    expect(firstIds).not.toContain(submitted);
    expect((await getSession(testDb.db, submitted))?.status).toBe("submitted");

    // Idempotent: the second run over the same clock re-expires nothing of ours.
    const second = await sweepExpiredSessions(testDb.db, now);
    const secondIds = second.expired.map((r) => r.sessionId);
    expect(secondIds).not.toContain(abandoned);
    expect(secondIds).not.toContain(submitted);
  });
});

describe("purgeExpired", () => {
  it("removes expired-never-submitted sessions (and their answers) only", async () => {
    const { formId, version } = await seedForm("frm_purge");
    const horizon = new Date("2026-05-10T00:00:00.000Z");

    // (a) expired, never submitted, older than horizon, with answers → purged.
    const purgeable = SessionId.parse("ses_purge_old");
    await createSession(testDb.db, {
      sessionId: purgeable,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await appendAnswer(testDb.db, {
      sessionId: purgeable,
      questionId: QuestionId.parse("q_partial"),
      value: "wip",
    });

    // (b) expired, but exactly at the horizon → retained (strictly-before).
    const atHorizon = SessionId.parse("ses_purge_athorizon");
    await createSession(testDb.db, {
      sessionId: atHorizon,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: horizon,
    });

    // (c) submitted (status) with past expiry → never purged.
    const submitted = SessionId.parse("ses_purge_submitted");
    await createSession(testDb.db, {
      sessionId: submitted,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await markSubmitted(testDb.db, submitted);
    await insertSubmission(testDb.db, {
      sessionId: submitted,
      contentHash: "0".repeat(64),
      lockedAnswers: lockedSubmission([{ questionId: "q_text", value: "keep" }]),
    });

    // Sweep (a) and (b) to `expired` first (past `now`).
    await sweepExpiredSessions(testDb.db, new Date("2026-05-11T00:00:00.000Z"));
    expect((await getSession(testDb.db, purgeable))?.status).toBe("expired");
    expect((await getSession(testDb.db, atHorizon))?.status).toBe("expired");

    const result = await purgeExpired(testDb.db, horizon);
    const purged = result.purgedSessionIds;

    expect(purged).toContain(purgeable);
    expect(purged).not.toContain(atHorizon);
    expect(purged).not.toContain(submitted);

    // (a) fully gone: session row and its answers.
    expect(await getSession(testDb.db, purgeable)).toBeUndefined();
    const leftoverAnswers = await testDb.client.query(
      `select 1 from answers where session_id = $1`,
      [purgeable],
    );
    expect(leftoverAnswers.rowCount).toBe(0);

    // (b) and (c) survive.
    expect((await getSession(testDb.db, atHorizon))?.status).toBe("expired");
    expect((await getSession(testDb.db, submitted))?.status).toBe("submitted");
  });

  it("does not purge an expired session that carries a submission (anti-join)", async () => {
    const { formId, version } = await seedForm("frm_purge_edge");
    const edge = SessionId.parse("ses_purge_edge");
    await createSession(testDb.db, {
      sessionId: edge,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    // Force the pathological state: expired status but a submission row present.
    await insertSubmission(testDb.db, {
      sessionId: edge,
      contentHash: "0".repeat(64),
      lockedAnswers: lockedSubmission([{ questionId: "q_text", value: "audit" }]),
    });
    await sweepExpiredSessions(testDb.db, new Date("2026-06-02T00:00:00.000Z"));
    expect((await getSession(testDb.db, edge))?.status).toBe("expired");

    const result = await purgeExpired(testDb.db, new Date("2026-07-01T00:00:00.000Z"));
    expect(result.purgedSessionIds).not.toContain(edge);
    expect(await getSession(testDb.db, edge)).toBeDefined();
  });
});
