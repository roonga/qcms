import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HONEYPOT_FIELD_NAME } from "@roonga/qcms-a2ui-compiler";
import { FormId, type LockedSubmission, QuestionId, SessionId } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  answerLedger,
  appendAnswer,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  getSubmission,
  insertFormRelease,
  insertFormVersion,
  markInProgress,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  DEFAULT_TEST_ENVIRONMENT,
  searchPathOptions,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Config } from "../../../config.js";
import type { Deps } from "../../../deps.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { registerServeStep } from "../serve-step/route.js";
import { importSessionKeys, mintSessionToken } from "../session-token.js";
import { registerAnonymousEntry, registerLinkEntry } from "../start-session/route.js";
import { registerSubmit } from "./route.js";

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
const Q_ACCIDENT_DEF = readFixture(
  "packages",
  "core",
  "fixtures",
  "questions",
  "valid",
  "boolean.json",
) as Parameters<typeof createQuestionVersion>[1]["definition"];
const Q_ACCIDENT_COUNT_DEF = readFixture(
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
    groups: {
      anonymous: [registerAnonymousEntry],
      respondent: [registerLinkEntry, registerServeStep, registerSubmit],
    },
  });
  internalToken = internalTokenFor(deps.config);

  await seedQuestions();
  await seedForm("frm_auto_quote", "auto", GOLDEN as unknown as VersionInput["compiled"]);
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

async function seedQuestions(): Promise<void> {
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId: QuestionId.parse("q_at_fault_accident"),
    slug: "accident",
  });
  // The form pins q_at_fault_accident at v2, so v1 exists only to make v2 the second row.
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: Q_ACCIDENT_DEF,
  });
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: Q_ACCIDENT_DEF,
  });
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId: QuestionId.parse("q_accident_count"),
    slug: "accident-count",
  });
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_accident_count"),
    definition: Q_ACCIDENT_COUNT_DEF,
  });
}

// `semanticsVersion` defaults to the one this evaluator implements and is overridden only
// to exercise the gate.
async function seedForm(
  id: string,
  slug: string,
  compiled: VersionInput["compiled"],
  semanticsVersion = "1",
): Promise<FormId> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug,
    defaultLocale: "en",
  });
  const version = await insertFormVersion(testDb.db, {
    formId,
    definition: INSURANCE_DEF,
    compiled,
    compilerVersion: GOLDEN.compilerVersion,
    a2uiSpecVersion: GOLDEN.a2uiSpecVersion,
    semanticsVersion,
  });
  // A published version is served nowhere until it is released, so publishing alone would
  // describe a form no session can start on.
  await insertFormRelease(testDb.db, {
    formId,
    environment: DEFAULT_TEST_ENVIRONMENT,
    version: version.version,
    releasedBy: "usr_fixture",
  });
  return formId;
}

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

// `submissions.$inferSelect` resolves to a TS error type through @roonga/qcms-db's emitted
// .d.ts, so the asserted fields are read through a narrow local view instead.
interface SubmissionView {
  readonly contentHash: string;
  readonly flaggedReason: string | null;
  readonly lockedAnswers: LockedSubmission;
}

async function loadSubmission(sessionId: string): Promise<SubmissionView | undefined> {
  return getSubmission(testDb.db, SessionId.parse(sessionId));
}

async function startSession(slug = "auto"): Promise<StartBody> {
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

async function outboxCount(sessionId: string): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from outbox where payload->>'sessionId' = $1`,
    [sessionId],
  );
  return res.rows[0]?.n ?? 0;
}

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

async function sessionStatus(sessionId: string): Promise<string | undefined> {
  const res = await testDb.client.query<{ status: string }>(
    `select status from sessions where session_id = $1`,
    [sessionId],
  );
  return res.rows[0]?.status;
}

// `q_at_fault_accident = false` hides the follow-up, so one answer completes the flow.
async function completeValidSession(): Promise<StartBody> {
  const started = await startSession();
  const r = await postAnswer(started.sessionId, started.sessionToken, "q_at_fault_accident", false);
  expect(r.status).toBe(200);
  return started;
}

describe("happy path and all-or-nothing (exit criterion 1)", () => {
  it("locks the submission, marks the session submitted, and enqueues one outbox event", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(200);
    const receipt = (await res.json()) as Receipt;
    expect(receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.submittedAt).toBe(NOW.toISOString());

    const submission = await loadSubmission(sessionId);
    expect(submission).toBeDefined();
    expect(submission?.contentHash).toBe(receipt.contentHash);
    expect(submission?.flaggedReason).toBeNull();

    expect(await sessionStatus(sessionId)).toBe("submitted");
    expect(await outboxCount(sessionId)).toBe(1);

    const event = await outboxEvent(sessionId);
    expect(event?.eventType).toBe("response.submitted");
    expect(event?.payload.formId).toBe("frm_auto_quote");
    expect(event?.payload.contentHash).toBe(receipt.contentHash);
  });

  it("rolls everything back when the outbox insert fails mid-transaction (nothing persists)", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    // The outbox enqueue is the last write of the transaction, so a trigger on it fails
    // the submit after everything else has been written.
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
      expect(res.status).toBe(500);
    } finally {
      await testDb.client.query(`drop trigger __fail_outbox on outbox`);
      await testDb.client.query(`drop function __fail_outbox()`);
    }

    expect(await loadSubmission(sessionId)).toBeUndefined();
    expect(await sessionStatus(sessionId)).toBe("in_progress");
    expect(await outboxCount(sessionId)).toBe(0);
  });
});

describe("idempotency (exit criterion 2)", () => {
  it("double submit returns the same receipt, one submission row, one outbox row", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    const first = (await (await submit(sessionId, sessionToken)).json()) as Receipt;
    const second = (await (await submit(sessionId, sessionToken)).json()) as Receipt;

    expect(second).toEqual(first);
    expect(await outboxCount(sessionId)).toBe(1);
    expect(await sessionStatus(sessionId)).toBe("submitted");
  });
});

describe("hidden-answer exclusion (exit criterion 3)", () => {
  it("a hidden question's answer is absent from the lock and webhook, present in the ledger", async () => {
    const { sessionId, sessionToken } = await startSession();
    expect((await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true)).status).toBe(
      200,
    );
    expect((await postAnswer(sessionId, sessionToken, "q_accident_count", 20)).status).toBe(200);
    expect((await postAnswer(sessionId, sessionToken, "q_at_fault_accident", false)).status).toBe(
      200,
    );

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(200);

    const ledger = (await answerLedger(testDb.db, SessionId.parse(sessionId))) as {
      questionId: string;
    }[];
    expect(ledger.map((r) => r.questionId)).toEqual([
      "q_at_fault_accident",
      "q_accident_count",
      "q_at_fault_accident",
    ]);

    const submission = await loadSubmission(sessionId);
    const lockedIds = submission?.lockedAnswers.answers.map((a) => a.questionId) ?? [];
    expect(lockedIds).toEqual(["q_at_fault_accident"]);

    const event = await outboxEvent(sessionId);
    const webhookIds = (event?.payload.answers as { questionId: string }[]).map(
      (a) => a.questionId,
    );
    expect(webhookIds).toEqual(["q_at_fault_accident"]);
  });
});

describe("required-answer sweep (exit criterion 4)", () => {
  it("a missing visible-required answer → 422 naming the id; nothing is submitted", async () => {
    const { sessionId, sessionToken } = await startSession();
    expect((await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true)).status).toBe(
      200,
    );

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("SUBMISSION_INVALID");
    const details = body.error.details as { missingRequired: string[] };
    expect(details.missingRequired).toContain("q_accident_count");

    expect(await loadSubmission(sessionId)).toBeUndefined();
    expect(await sessionStatus(sessionId)).toBe("in_progress");
  });

  it("a hidden required question does not block submit (q_at_fault_accident = false)", async () => {
    const { sessionId, sessionToken } = await completeValidSession();
    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(200);
  });

  it("a RETRACTED required answer blocks submit exactly like a never-answered one (ADR-33)", async () => {
    const { sessionId, sessionToken } = await startSession();
    expect((await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true)).status).toBe(
      200,
    );
    expect((await postAnswer(sessionId, sessionToken, "q_accident_count", 20)).status).toBe(200);
    // A null post appends a retraction, which the read model resolves to unanswered
    // before the kernel sees it.
    expect((await postAnswer(sessionId, sessionToken, "q_accident_count", null)).status).toBe(200);

    const blocked = await submit(sessionId, sessionToken);
    expect(blocked.status).toBe(422);
    const body = (await blocked.json()) as ErrBody;
    expect(body.error.code).toBe("SUBMISSION_INVALID");
    expect((body.error.details as { missingRequired: string[] }).missingRequired).toContain(
      "q_accident_count",
    );
    expect(await loadSubmission(sessionId)).toBeUndefined();

    expect((await postAnswer(sessionId, sessionToken, "q_at_fault_accident", false)).status).toBe(
      200,
    );
    expect((await submit(sessionId, sessionToken)).status).toBe(200);

    const submission = await loadSubmission(sessionId);
    expect(submission?.lockedAnswers.answers.map((a) => a.questionId)).toEqual([
      "q_at_fault_accident",
    ]);
    const event = await outboxEvent(sessionId);
    expect((event?.payload.answers as { questionId: string }[]).map((a) => a.questionId)).toEqual([
      "q_at_fault_accident",
    ]);
    const ledger = (await answerLedger(testDb.db, SessionId.parse(sessionId))) as {
      questionId: string;
      value: unknown;
      retracted: boolean;
    }[];
    expect(ledger.map((r) => [r.questionId, r.value, r.retracted])).toEqual([
      ["q_at_fault_accident", true, false],
      ["q_accident_count", 20, false],
      ["q_accident_count", null, true],
      ["q_at_fault_accident", false, false],
    ]);
  });
});

describe("issue #968: the required-answer sweep runs INSIDE the session lock", () => {
  // The interleaving is forced rather than raced: a second connection takes the session's
  // advisory lock with the same expression the handler uses, appends the retraction, and
  // holds its transaction open until the submit is blocking on that lock.
  it("refuses a submission whose required answer was retracted in the old window", async () => {
    const { sessionId, sessionToken } = await startSession();
    expect((await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true)).status).toBe(
      200,
    );
    expect((await postAnswer(sessionId, sessionToken, "q_accident_count", 20)).status).toBe(200);

    // A separate connection: two logical transactions on one client share a backend, and
    // the first COMMIT would end both and release the lock early.
    const holder = testDb.register(
      new Client({
        connectionString: testDb.connectionUri,
        // Data-plane tables are declared unqualified, so a client with no search path
        // resolves `answers` to nothing.
        options: searchPathOptions(DEFAULT_TEST_ENVIRONMENT),
      }),
      "#968",
    );
    await holder.connect();
    await holder.query("begin");
    await holder.query("select pg_advisory_xact_lock(hashtext($1))", [sessionId]);
    await holder.query(
      `insert into answers (session_id, question_id, value, retracted, answered_at)
       values ($1, $2, null, true, now())`,
      [sessionId, "q_accident_count"],
    );

    // Fired, not awaited: it blocks on the lock the holder is sitting on, and the pause
    // gives it time to get there.
    const submitting = submit(sessionId, sessionToken);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await holder.query("commit");

    const res = await submitting;
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("SUBMISSION_INVALID");
    expect((body.error.details as { missingRequired: string[] }).missingRequired).toContain(
      "q_accident_count",
    );
    expect(await loadSubmission(sessionId)).toBeUndefined();
    expect(await sessionStatus(sessionId)).toBe("in_progress");
  });

  it("still seals a submission whose ledger did not move under the lock", async () => {
    // The control for the case above, which would also pass if submit simply refused
    // whenever the lock was contended.
    const { sessionId, sessionToken } = await completeValidSession();

    const holder = testDb.register(
      new Client({
        connectionString: testDb.connectionUri,
        options: searchPathOptions(DEFAULT_TEST_ENVIRONMENT),
      }),
      "#968 control",
    );
    await holder.connect();
    await holder.query("begin");
    await holder.query("select pg_advisory_xact_lock(hashtext($1))", [sessionId]);

    const submitting = submit(sessionId, sessionToken);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await holder.query("commit");

    expect((await submitting).status).toBe(200);
    expect(await loadSubmission(sessionId)).toBeDefined();
  });
});

describe("silent anti-abuse flags (exit criterion 5)", () => {
  it("a honeypot-filled submit succeeds, is flagged, and withholds the outbox event", async () => {
    const { sessionId, sessionToken } = await completeValidSession();

    const res = await submit(sessionId, sessionToken, {
      [HONEYPOT_FIELD_NAME]: "http://spam.example",
    });
    expect(res.status).toBe(200);
    const receipt = (await res.json()) as Receipt;
    expect(receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const submission = await loadSubmission(sessionId);
    expect(submission).toBeDefined();
    expect(submission?.flaggedReason).toBe("HONEYPOT");
    expect(await sessionStatus(sessionId)).toBe("submitted");
    expect(await outboxCount(sessionId)).toBe(0);
  });

  it("a submit carrying an undeclared field is accepted, not refused (issue #893)", async () => {
    // The one request body in this API that stays open: the portal's no-JS path forwards
    // every posted field, and a 400 for one field name beside a 200 for another would
    // tell a bot which field is the honeypot.
    const { sessionId, sessionToken } = await completeValidSession();

    const res = await submit(sessionId, sessionToken, { anUndeclaredField: "carried through" });

    expect(res.status).toBe(200);
    expect((await loadSubmission(sessionId))?.flaggedReason).toBeNull();
  });

  it("a too-fast submit succeeds, is flagged, and withholds the outbox event", async () => {
    // Its own app, on the same signing keys so the session token still verifies.
    const fastConfig: Config = {
      ...deps.config,
      antiAbuse: { ...deps.config.antiAbuse, minSubmitMs: 60_000 },
    };
    const fastDeps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), config: fastConfig });
    const fastApp = createApp(fastDeps, PUBLIC_ONLY, {
      groups: {
        anonymous: [registerAnonymousEntry],
        respondent: [registerLinkEntry, registerSubmit],
      },
    });

    const { sessionId, sessionToken } = await completeValidSession();
    // `created_at` pinned to NOW makes the elapsed time exactly zero.
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
    const gatedFormId = FormId.parse("frm_minfloor");
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: gatedFormId,
      slug: "minfloor",
      defaultLocale: "en",
      minSubmitMs: 3_000,
    });
    const gatedVersion = await insertFormVersion(testDb.db, {
      formId: gatedFormId,
      definition: INSURANCE_DEF,
      compiled: GOLDEN as unknown as VersionInput["compiled"],
      compilerVersion: GOLDEN.compilerVersion,
      a2uiSpecVersion: GOLDEN.a2uiSpecVersion,
      semanticsVersion: "1",
    });
    await insertFormRelease(testDb.db, {
      formId: gatedFormId,
      environment: DEFAULT_TEST_ENVIRONMENT,
      version: gatedVersion.version,
      releasedBy: "usr_fixture",
    });

    // The default app leaves the global floor at 0, so only the form's own figure bites.
    const started = await startSession("minfloor");
    expect(
      (await postAnswer(started.sessionId, started.sessionToken, "q_at_fault_accident", false))
        .status,
    ).toBe(200);
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

    const answer = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    expect(answer.status).toBe(409);
    expect(((await answer.json()) as ErrBody).error.code).toBe("SESSION_SUBMITTED");
  });
});

describe("the stored semanticsVersion at submit (ADR-16)", () => {
  // Written directly rather than through the endpoints: the answer route sits behind the
  // same semantics gate as `/step`, so a form whose stamp is under test cannot be
  // answered through the API.
  async function submittableSessionOn(formId: string, id: string): Promise<StartBody> {
    const sessionId = SessionId.parse(id);
    const expiresAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId,
      formId: FormId.parse(formId),
      formVersion: 1,
      accessMode: "anonymous",
      expiresAt,
    });
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: QuestionId.parse("q_at_fault_accident"),
      value: false,
    });
    await markInProgress(testDb.db, sessionId);

    const [signingKey] = await importSessionKeys(deps.config);
    if (signingKey === undefined) throw new Error("no session signing key in test config");
    return { sessionId, sessionToken: await mintSessionToken(sessionId, expiresAt, signingKey) };
  }

  it("a corrupt stamp is refused rather than coerced to NaN (UNSUPPORTED_SEMANTICS_VERSION)", async () => {
    await seedForm(
      "frm_submit_bad_semantics",
      "submit-bad-semantics",
      GOLDEN as unknown as VersionInput["compiled"],
      "not-a-number",
    );
    const { sessionId, sessionToken } = await submittableSessionOn(
      "frm_submit_bad_semantics",
      "ses_submit_bad_stamp",
    );

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");
    expect(await loadSubmission(sessionId)).toBeUndefined();
  });

  it("a readable but unsupported stamp still reports through the kernel sweep (unchanged)", async () => {
    await seedForm(
      "frm_submit_alien_semantics",
      "submit-alien-semantics",
      GOLDEN as unknown as VersionInput["compiled"],
      "999",
    );
    const { sessionId, sessionToken } = await submittableSessionOn(
      "frm_submit_alien_semantics",
      "ses_submit_alien_stamp",
    );

    const res = await submit(sessionId, sessionToken);
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("SUBMISSION_INVALID");
    const details = body.error.details as { errors: { code: string }[] };
    expect(details.errors.map((error) => error.code)).toContain("FLOW_EVALUATION_FAILED");
    expect(await loadSubmission(sessionId)).toBeUndefined();
  });
});
