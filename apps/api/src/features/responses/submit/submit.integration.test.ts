/**
 * Submit-slice tests (task 020), driven through `app.request()` against the
 * **real** kernel and the 013 Testcontainers harness DB - never a mock of our
 * own packages (CONTRIBUTING). Requires Docker.
 *
 * The fixture is the canonical `insurance` form (`@qcms/core` fixtures): one
 * step `stp_health` with `q_smoker` (boolean, required) and `q_cigs_daily`
 * (number, required), the follow-up shown only when `q_smoker = true`. So:
 *
 * - `q_smoker = false` → only `q_smoker` visible, flow complete → a valid
 *   submission whose locked set is `[q_smoker]` (the hidden `q_cigs_daily` never
 *   enters the lock, even if stale in the ledger - I6).
 * - `q_smoker = true` with `q_cigs_daily` unanswered → a visible required gap →
 *   the submission sweep fails (422); a *hidden* required question never blocks.
 *
 * Covers every exit criterion: happy path + all-or-nothing under an induced
 * mid-transaction failure (1), idempotency (2), hidden-answer exclusion (3),
 * missing visible-required vs hidden-required (4), and the silent anti-abuse
 * flags - honeypot and too-fast - that succeed but withhold the outbox event (5).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HONEYPOT_FIELD_NAME } from "@qcms/a2ui-compiler";
import { FormId, type LockedSubmission, QuestionId, SessionId } from "@qcms/core";
import {
  answerLedger,
  createForm,
  createQuestion,
  createQuestionVersion,
  getSubmission,
  insertFormVersion,
} from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Config } from "../../../config.js";
import type { Deps } from "../../../deps.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { registerServeStep } from "../serve-step/route.js";
import { registerStartSession } from "../start-session/route.js";
import { registerSubmit } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const NOW = new Date("2026-07-20T00:00:00.000Z");
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;

type VersionInput = Parameters<typeof insertFormVersion>[1];

const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
function readFixture(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, ...segments), "utf8"));
}

const INSURANCE_DEF = readFixture(
  "packages",
  "core",
  "fixtures",
  "forms",
  "valid",
  "insurance.json",
) as VersionInput["definition"];
const Q_SMOKER_DEF = readFixture(
  "packages",
  "core",
  "fixtures",
  "questions",
  "valid",
  "boolean.json",
) as Parameters<typeof createQuestionVersion>[1]["definition"];
const Q_CIGS_DEF = readFixture(
  "packages",
  "core",
  "fixtures",
  "questions",
  "valid",
  "number.json",
) as Parameters<typeof createQuestionVersion>[1]["definition"];

interface CompiledDoc {
  readonly stepId: string;
  readonly root: unknown;
}
interface Compiled {
  readonly documents: readonly CompiledDoc[];
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
}
const GOLDEN = readFixture(
  "packages",
  "a2ui-compiler",
  "golden",
  "v1",
  "insurance.a2ui.json",
) as Compiled;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), env: validEnv() });
  app = createApp(deps, PUBLIC_ONLY, {
    groups: { public: [registerStartSession, registerServeStep, registerSubmit] },
  });
  internalToken = internalTokenFor(deps.config);

  await seedQuestions();
  await seedForm("frm_life_signup", "life", GOLDEN as unknown as VersionInput["compiled"]);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- seed helpers -----------------------------------------------------------

async function seedQuestions(): Promise<void> {
  await createQuestion(testDb.db, { questionId: QuestionId.parse("q_smoker"), slug: "smoker" });
  // q_smoker is pinned @2 by the form; create v1 then v2 (identical definition).
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_smoker"),
    definition: Q_SMOKER_DEF,
  });
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_smoker"),
    definition: Q_SMOKER_DEF,
  });
  await createQuestion(testDb.db, { questionId: QuestionId.parse("q_cigs_daily"), slug: "cigs" });
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_cigs_daily"),
    definition: Q_CIGS_DEF,
  });
}

async function seedForm(
  id: string,
  slug: string,
  compiled: VersionInput["compiled"],
): Promise<FormId> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, { formId, slug, defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId,
    definition: INSURANCE_DEF,
    compiled,
    compilerVersion: GOLDEN.compilerVersion,
    a2uiSpecVersion: GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  return formId;
}

// --- request helpers --------------------------------------------------------

interface StartBody {
  sessionId: string;
  sessionToken: string;
}
interface ErrBody {
  error: { code: string; message: string; details?: unknown };
}
interface Receipt {
  submittedAt: string;
  contentHash: string;
}

// `submissions.$inferSelect` resolves to a TS error type through @qcms/db's
// emitted .d.ts (issue #5, FK to the enum-bearing `sessions`); read the fields
// this test asserts on through a narrow local view (same launder as the slices).
interface SubmissionView {
  readonly contentHash: string;
  readonly flaggedReason: string | null;
  readonly lockedAnswers: LockedSubmission;
}

/** A session's submission row (the concrete row is assignable to the view). */
async function loadSubmission(sessionId: string): Promise<SubmissionView | undefined> {
  return getSubmission(testDb.db, SessionId.parse(sessionId));
}

async function startSession(slug = "life"): Promise<StartBody> {
  const res = await app.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ formSlug: slug }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as StartBody;
}

async function postAnswer(
  id: string,
  token: string,
  questionId: string,
  value: unknown,
): Promise<Response> {
  return app.request(`/sessions/${id}/answers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ questionId, value }),
  });
}

async function submit(
  id: string,
  token: string,
  body: Record<string, unknown> = {},
  targetApp: ReturnType<typeof createApp> = app,
): Promise<Response> {
  return targetApp.request(`/sessions/${id}/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function getStep(id: string, token: string): Promise<Response> {
  return app.request(`/sessions/${id}/step`, {
    headers: { "x-qcms-internal-token": internalToken, authorization: `Bearer ${token}` },
  });
}

/** Count outbox rows for a session (matched on the event payload's sessionId). */
async function outboxCount(sessionId: string): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from outbox where payload->>'sessionId' = $1`,
    [sessionId],
  );
  return res.rows[0]?.n ?? 0;
}

/** The single outbox event (type + payload) for a session, or undefined. */
async function outboxEvent(
  sessionId: string,
): Promise<{ eventType: string; payload: Record<string, unknown> } | undefined> {
  const res = await testDb.client.query<{ event_type: string; payload: Record<string, unknown> }>(
    `select event_type, payload from outbox where payload->>'sessionId' = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  return row === undefined ? undefined : { eventType: row.event_type, payload: row.payload };
}

/** A session's status straight from the row. */
async function sessionStatus(sessionId: string): Promise<string | undefined> {
  const res = await testDb.client.query<{ status: string }>(
    `select status from sessions where session_id = $1`,
    [sessionId],
  );
  return res.rows[0]?.status;
}

/** Drive a session to a valid, complete state (q_smoker = false → flow complete). */
async function completeValidSession(): Promise<StartBody> {
  const started = await startSession();
  const r = await postAnswer(started.sessionId, started.sessionToken, "q_smoker", false);
  expect(r.status).toBe(200);
  return started;
}

// --- exit criterion 1: happy path + all-or-nothing --------------------------

describe("happy path and all-or-nothing (exit criterion 1)", () => {
  it("locks the submission, marks the session submitted, and enqueues one outbox event", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(200);
    const receipt = (await res.json()) as Receipt;
    expect(receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.submittedAt).toBe(NOW.toISOString());

    // Submission row present, content hash matches the receipt, clean (unflagged).
    const submission = await loadSubmission(sessionId);
    expect(submission).toBeDefined();
    expect(submission?.contentHash).toBe(receipt.contentHash);
    expect(submission?.flaggedReason).toBeNull();

    // Session flipped to submitted; exactly one outbox event.
    expect(await sessionStatus(sessionId)).toBe("submitted");
    expect(await outboxCount(sessionId)).toBe(1);

    const event = await outboxEvent(sessionId);
    expect(event?.eventType).toBe("response.submitted");
    expect(event?.payload.formId).toBe("frm_life_signup");
    expect(event?.payload.contentHash).toBe(receipt.contentHash);
  });

  it("rolls everything back when the outbox insert fails mid-transaction (nothing persists)", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    // Induce a real failure on the last write of the transaction (the outbox
    // enqueue), the same fault-trigger technique the erasure tests use.
    await testDb.client.query(
      `create function __fail_outbox() returns trigger as $$
       begin raise exception 'induced failure'; end; $$ language plpgsql`,
    );
    await testDb.client.query(
      `create trigger __fail_outbox before insert on outbox
         for each row execute function __fail_outbox()`,
    );

    try {
      const res = await submit(sessionId, sessionToken);
      // The induced pg error surfaces as an opaque 500 (unexpected throw).
      expect(res.status).toBe(500);
    } finally {
      await testDb.client.query(`drop trigger __fail_outbox on outbox`);
      await testDb.client.query(`drop function __fail_outbox()`);
    }

    // Nothing committed: no submission, session still in_progress, no outbox row.
    expect(await loadSubmission(sessionId)).toBeUndefined();
    expect(await sessionStatus(sessionId)).toBe("in_progress");
    expect(await outboxCount(sessionId)).toBe(0);
  });
});

// --- exit criterion 2: idempotency ------------------------------------------

describe("idempotency (exit criterion 2)", () => {
  it("double submit returns the same receipt, one submission row, one outbox row", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    const first = (await (await submit(sessionId, sessionToken)).json()) as Receipt;
    const second = (await (await submit(sessionId, sessionToken)).json()) as Receipt;

    expect(second).toEqual(first);
    // Still exactly one submission (PK per session) and one outbox event.
    expect(await outboxCount(sessionId)).toBe(1);
    expect(await sessionStatus(sessionId)).toBe("submitted");
  });
});

// --- exit criterion 3: hidden-answer exclusion (I6) -------------------------

describe("hidden-answer exclusion (exit criterion 3)", () => {
  it("a hidden question's answer is absent from the lock and webhook, present in the ledger", async () => {
    const { sessionId, sessionToken } = await startSession();
    // Reveal q_cigs_daily, answer it, then hide it again (q_smoker = false).
    expect((await postAnswer(sessionId, sessionToken, "q_smoker", true)).status).toBe(200);
    expect((await postAnswer(sessionId, sessionToken, "q_cigs_daily", 20)).status).toBe(200);
    expect((await postAnswer(sessionId, sessionToken, "q_smoker", false)).status).toBe(200);

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(200);

    // Ledger still holds all three appended rows (append-only, I5).
    const ledger = (await answerLedger(testDb.db, SessionId.parse(sessionId))) as {
      questionId: string;
    }[];
    expect(ledger.map((r) => r.questionId)).toEqual(["q_smoker", "q_cigs_daily", "q_smoker"]);

    // The locked set excludes the hidden q_cigs_daily (I6).
    const submission = await loadSubmission(sessionId);
    const lockedIds = submission?.lockedAnswers.answers.map((a) => a.questionId) ?? [];
    expect(lockedIds).toEqual(["q_smoker"]);

    // …and so does the webhook payload.
    const event = await outboxEvent(sessionId);
    const webhookIds = (event?.payload.answers as { questionId: string }[]).map(
      (a) => a.questionId,
    );
    expect(webhookIds).toEqual(["q_smoker"]);
  });
});

// --- exit criterion 4: visible-required blocks, hidden-required does not -----

describe("required-answer sweep (exit criterion 4)", () => {
  it("a missing visible-required answer → 422 naming the id; nothing is submitted", async () => {
    const { sessionId, sessionToken } = await startSession();
    // q_smoker = true reveals q_cigs_daily (required) and leaves it unanswered.
    expect((await postAnswer(sessionId, sessionToken, "q_smoker", true)).status).toBe(200);

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("SUBMISSION_INVALID");
    const details = body.error.details as { missingRequired: string[] };
    expect(details.missingRequired).toContain("q_cigs_daily");

    // The failed sweep committed nothing.
    expect(await loadSubmission(sessionId)).toBeUndefined();
    expect(await sessionStatus(sessionId)).toBe("in_progress");
  });

  it("a hidden required question does not block submit (q_smoker = false)", async () => {
    const { sessionId, sessionToken } = await completeValidSession();
    // q_cigs_daily is required but hidden while q_smoker = false → submit succeeds.
    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(200);
  });
});

// --- exit criterion 5: silent anti-abuse flags ------------------------------

describe("silent anti-abuse flags (exit criterion 5)", () => {
  it("a honeypot-filled submit succeeds, is flagged, and withholds the outbox event", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    // Key off the compiler's shared honeypot field name (the compiler↔API
    // contract): the decoy the compiler emits posts under exactly this key.
    const res = await submit(sessionId, sessionToken, {
      [HONEYPOT_FIELD_NAME]: "http://spam.example",
    });
    // Same success shape as a clean submission - the tell never leaks.
    expect(res.status).toBe(200);
    const receipt = (await res.json()) as Receipt;
    expect(receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const submission = await loadSubmission(sessionId);
    expect(submission).toBeDefined();
    expect(submission?.flaggedReason).toBe("HONEYPOT");
    // Flagged → session still submitted, but NO webhook event enqueued.
    expect(await sessionStatus(sessionId)).toBe("submitted");
    expect(await outboxCount(sessionId)).toBe(0);
  });

  it("a too-fast submit succeeds, is flagged, and withholds the outbox event", async () => {
    // A dedicated app whose config sets a positive min-time threshold (config
    // seam; default is 0/off). Same signing keys, so the session token verifies.
    const fastConfig: Config = {
      ...deps.config,
      antiAbuse: { ...deps.config.antiAbuse, minSubmitMs: 60_000 },
    };
    const fastDeps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), config: fastConfig });
    const fastApp = createApp(fastDeps, PUBLIC_ONLY, {
      groups: { public: [registerStartSession, registerSubmit] },
    });

    const { sessionId, sessionToken } = await completeValidSession();
    // Pin createdAt to exactly NOW so elapsed = 0 < threshold (deterministic).
    await testDb.client.query(`update sessions set created_at = $1 where session_id = $2`, [
      NOW.toISOString(),
      sessionId,
    ]);

    const res = await submit(sessionId, sessionToken, {}, fastApp);
    expect(res.status).toBe(200);

    const submission = await loadSubmission(sessionId);
    expect(submission?.flaggedReason).toBe("MIN_TIME");
    expect(await sessionStatus(sessionId)).toBe("submitted");
    expect(await outboxCount(sessionId)).toBe(0);
  });

  it("a per-form min_submit_ms override flags a below-floor submit (task 026)", async () => {
    // A form whose own floor (3s) is the authority - no global config floor set,
    // so this proves the per-form override path, not the config default.
    const gatedFormId = FormId.parse("frm_minfloor");
    await createForm(testDb.db, {
      formId: gatedFormId,
      slug: "minfloor",
      defaultLocale: "en",
      minSubmitMs: 3_000,
    });
    await insertFormVersion(testDb.db, {
      formId: gatedFormId,
      definition: INSURANCE_DEF,
      compiled: GOLDEN as unknown as VersionInput["compiled"],
      compilerVersion: GOLDEN.compilerVersion,
      a2uiSpecVersion: GOLDEN.a2uiSpecVersion,
      semanticsVersion: "1",
    });

    // Default app: global antiAbuse.minSubmitMs is 0 (off) - only the form floor bites.
    const started = await startSession("minfloor");
    expect(
      (await postAnswer(started.sessionId, started.sessionToken, "q_smoker", false)).status,
    ).toBe(200);
    // createdAt = NOW so elapsed = 0 < 3s form floor → flagged MIN_TIME.
    await testDb.client.query(`update sessions set created_at = $1 where session_id = $2`, [
      NOW.toISOString(),
      started.sessionId,
    ]);

    const res = await submit(started.sessionId, started.sessionToken);
    expect(res.status).toBe(200);
    const submission = await loadSubmission(started.sessionId);
    expect(submission?.flaggedReason).toBe("MIN_TIME");
    expect(await outboxCount(started.sessionId)).toBe(0);
  });
});

// --- session-state rejects + post-submit serving guards ---------------------

describe("session-state rejects and post-submit guards", () => {
  it("submitting a fresh (created, no-answers) session → 409 NOTHING_TO_SUBMIT", async () => {
    const { sessionId, sessionToken } = await startSession();
    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("NOTHING_TO_SUBMIT");
  });

  it("submitting without a session token → 401", async () => {
    const { sessionId } = await completeValidSession();
    const res = await app.request(`/sessions/${sessionId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("after submit, /step and /answers both reject with SESSION_SUBMITTED (019 guards fire)", async () => {
    const { sessionId, sessionToken } = await completeValidSession();
    expect((await submit(sessionId, sessionToken)).status).toBe(200);

    const step = await getStep(sessionId, sessionToken);
    expect(step.status).toBe(409);
    expect(((await step.json()) as ErrBody).error.code).toBe("SESSION_SUBMITTED");

    const answer = await postAnswer(sessionId, sessionToken, "q_smoker", true);
    expect(answer.status).toBe(409);
    expect(((await answer.json()) as ErrBody).error.code).toBe("SESSION_SUBMITTED");
  });
});
