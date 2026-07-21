/**
 * Serving-loop slice tests (task 019), driven through `app.request()` against
 * the **real** kernel and the 013 Testcontainers harness DB - never a mock of
 * our own packages (CONTRIBUTING). Requires Docker.
 *
 * The fixture is the canonical `insurance` form (`@qcms/core` fixtures): one
 * step `stp_history` with `q_at_fault_accident` (boolean, required) and `q_accident_count`
 * (number, required), the follow-up shown only when `q_at_fault_accident = true`. Its
 * published `form_versions` row stores the committed golden compiled A2UI
 * document, so exit criterion 2 asserts the served step equals the *stored*
 * bytes - the handler has no compiler dependency and cannot recompile (ADR-18).
 *
 * Covers every exit criterion: the branching answer loop (1), served step
 * equals the stored compiled document (2), the typed rejects - invalid value,
 * hidden question, unknown question, submitted/expired session (3), and
 * concurrent answers serialized by the advisory lock (4).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FormId, QuestionId, SessionId } from "@qcms/core";
import {
  answerLedger,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  insertFormVersion,
  latestAnswers,
  markSubmitted,
} from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { importSessionKeys, mintSessionToken } from "../session-token.js";
import { registerStartSession } from "../start-session/route.js";
import { registerServeStep } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const NOW = new Date("2026-07-20T00:00:00.000Z");
const TTL_MS = 24 * 60 * 60 * 1000;
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

/** The committed golden compiled document for the insurance fixture (ADR-18). */
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
    groups: { public: [registerStartSession, registerServeStep] },
  });
  internalToken = internalTokenFor(deps.config);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- seed helpers -----------------------------------------------------------

/** Seed the two library questions the insurance form pins (q_at_fault_accident@2, q_accident_count@1). */
async function seedQuestions(): Promise<void> {
  await createQuestion(testDb.db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    slug: "accident",
  });
  // q_at_fault_accident is pinned @2 by the form; create v1 then v2 (identical definition).
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: Q_ACCIDENT_DEF,
  });
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: Q_ACCIDENT_DEF,
  });
  await createQuestion(testDb.db, {
    questionId: QuestionId.parse("q_accident_count"),
    slug: "accident-count",
  });
  await createQuestionVersion(testDb.db, {
    questionId: QuestionId.parse("q_accident_count"),
    definition: Q_ACCIDENT_COUNT_DEF,
  });
}

/** Seed the insurance form with one published version storing `compiled`. */
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
interface StepBody {
  step: CompiledDoc | null;
  a2uiSpecVersion: string;
  flowState: {
    currentStep: string | null;
    visibleQuestions: string[];
    missingRequired: string[];
    readyToSubmit: boolean;
  };
  progress: { stepIndex: number; totalVisibleSteps: number };
}

async function startSession(slug: string): Promise<StartBody> {
  const res = await app.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ formSlug: slug }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as StartBody;
}

async function getStep(id: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "x-qcms-internal-token": internalToken };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return app.request(`/sessions/${id}/step`, { headers });
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

// --- exit criterion 2: served step equals the stored compiled document ------

describe("get-step serves the stored compiled document (exit criterion 2)", () => {
  beforeAll(async () => {
    await seedQuestions();
    await seedForm("frm_auto_quote", "auto", GOLDEN as unknown as VersionInput["compiled"]);
  });

  it("serves the current step's stored golden document, never a recompilation", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    const res = await getStep(sessionId, sessionToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;

    // Deep-equals the STORED golden document for stp_history (JSONB does not
    // preserve key order, so structural equality - not byte-exact).
    expect(body.step).toEqual(GOLDEN.documents[0]);
    expect(body.a2uiSpecVersion).toBe(GOLDEN.a2uiSpecVersion);
    // Initially only q_at_fault_accident is visible (q_accident_count's rule is unsatisfied).
    expect(body.flowState.currentStep).toBe("stp_history");
    expect(body.flowState.visibleQuestions).toEqual(["q_at_fault_accident"]);
    expect(body.flowState.missingRequired).toEqual(["q_at_fault_accident"]);
    expect(body.flowState.readyToSubmit).toBe(false);
    expect(body.progress).toEqual({ stepIndex: 0, totalVisibleSteps: 1 });
  });

  it("serves the exact stored bytes even when they are not a valid compile (proves no recompile)", async () => {
    // A sentinel document the real compiler would never emit for this form: if
    // the handler recompiled it would produce the Form/Flex tree, not this.
    const sentinelRoot = { type: "Text", props: { as: "h1" }, children: "SENTINEL-STORED-19" };
    const sentinel = {
      documents: [{ stepId: "stp_history", root: sentinelRoot }],
      compilerVersion: "0.0.0",
      a2uiSpecVersion: "1.0.0-preview.7",
    };
    await seedForm("frm_sentinel", "sentinel", sentinel as unknown as VersionInput["compiled"]);

    const { sessionId, sessionToken } = await startSession("sentinel");
    const res = await getStep(sessionId, sessionToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.step).toEqual({ stepId: "stp_history", root: sentinelRoot });
  });
});

// --- exit criterion 1: branching answer loop --------------------------------

describe("branching answer loop (exit criterion 1)", () => {
  it("q_at_fault_accident=true reveals q_accident_count; q_at_fault_accident=false hides it; ledger keeps all rows", async () => {
    const { sessionId, sessionToken } = await startSession("auto");

    // 1) q_at_fault_accident = true → the follow-up q_accident_count becomes visible.
    const r1 = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as StepBody;
    expect(b1.flowState.currentStep).toBe("stp_history");
    expect(b1.flowState.visibleQuestions).toEqual(["q_at_fault_accident", "q_accident_count"]);
    expect(b1.flowState.missingRequired).toEqual(["q_accident_count"]);
    expect(b1.flowState.readyToSubmit).toBe(false);

    // 2) answer q_accident_count → flow complete, no current step.
    const r2 = await postAnswer(sessionId, sessionToken, "q_accident_count", 10);
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as StepBody;
    expect(b2.step).toBeNull();
    expect(b2.flowState.currentStep).toBeNull();
    expect(b2.flowState.visibleQuestions).toEqual([]);
    expect(b2.flowState.readyToSubmit).toBe(true);
    expect(b2.flowState.missingRequired).toEqual([]);
    expect(b2.progress).toEqual({ stepIndex: 1, totalVisibleSteps: 1 });

    // 3) q_at_fault_accident = false → the follow-up disappears again.
    const r3 = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", false);
    expect(r3.status).toBe(200);
    const b3 = (await r3.json()) as StepBody;
    expect(b3.flowState.visibleQuestions).not.toContain("q_accident_count");
    expect(b3.flowState.readyToSubmit).toBe(true);
    expect(b3.step).toBeNull();

    // Ledger holds all three appended rows (append-only, I5). The row type is
    // laundered through a local view - `answers` references the enum-bearing
    // `sessions` table, so its `$inferSelect` resolves to a TS error type through
    // @qcms/db's emitted .d.ts (issue #5); only `questionId` is read here.
    const ledger = (await answerLedger(testDb.db, SessionId.parse(sessionId))) as {
      questionId: string;
    }[];
    expect(ledger.map((row) => row.questionId)).toEqual([
      "q_at_fault_accident",
      "q_accident_count",
      "q_at_fault_accident",
    ]);
    // latestAnswers reflects the latest per question.
    const latest = await latestAnswers(testDb.db, SessionId.parse(sessionId));
    expect(latest.get(QuestionId.parse("q_at_fault_accident"))).toBe(false);
    expect(latest.get(QuestionId.parse("q_accident_count"))).toBe(10);
  });
});

// --- exit criterion 3: typed rejects ----------------------------------------

describe("typed rejects (exit criterion 3)", () => {
  it("invalid value → 422 with the kernel's error codes", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true); // reveal q_accident_count
    const res = await postAnswer(sessionId, sessionToken, "q_accident_count", -1); // below min 0
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("INVALID_ANSWER");
    const details = body.error.details as { errors: { code: string }[] };
    expect(details.errors.map((e) => e.code)).toContain("VALUE_BELOW_MIN");
  });

  it("answering a hidden question → 409 QUESTION_NOT_VISIBLE", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    // q_accident_count is hidden until q_at_fault_accident = true.
    const res = await postAnswer(sessionId, sessionToken, "q_accident_count", 5);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("QUESTION_NOT_VISIBLE");
  });

  it("answering a question not in the form → 404 UNKNOWN_QUESTION", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    const res = await postAnswer(sessionId, sessionToken, "q_not_in_form", "x");
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrBody).error.code).toBe("UNKNOWN_QUESTION");
  });

  it("a submitted session is rejected on both endpoints (SESSION_SUBMITTED)", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    await markSubmitted(testDb.db, SessionId.parse(sessionId));

    const stepRes = await getStep(sessionId, sessionToken);
    expect(stepRes.status).toBe(409);
    expect(((await stepRes.json()) as ErrBody).error.code).toBe("SESSION_SUBMITTED");

    const answerRes = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    expect(answerRes.status).toBe(409);
    expect(((await answerRes.json()) as ErrBody).error.code).toBe("SESSION_SUBMITTED");
  });

  it("an expired session is rejected with a valid token (SESSION_EXPIRED)", async () => {
    // Valid (future-expiry) token binding a session row whose expiry is past -
    // so the token verifies but the session is expired-by-time.
    const sessionId = SessionId.parse("ses_expired00000000");
    await createSession(testDb.db, {
      sessionId,
      formId: FormId.parse("frm_auto_quote"),
      formVersion: 1,
      accessMode: "anonymous",
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    const [signingKey] = await importSessionKeys(deps.config);
    if (signingKey === undefined) throw new Error("no session signing key in test config");
    const token = await mintSessionToken(sessionId, new Date(NOW.getTime() + TTL_MS), signingKey);

    const res = await getStep(sessionId, token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("SESSION_EXPIRED");
  });

  it("get-step without a session token → 401", async () => {
    const { sessionId } = await startSession("auto");
    const res = await getStep(sessionId);
    expect(res.status).toBe(401);
  });
});

// --- exit criterion 4: concurrent answers serialized ------------------------

describe("concurrent answers are serialized by the advisory lock (exit criterion 4)", () => {
  it("two simultaneous answers to one session both land; ledger order is well-formed", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true); // reveal q_accident_count

    // Two concurrent revisions of q_accident_count; the per-session advisory lock
    // serializes the transactions so both commit fully (no lost update).
    const [a, b] = await Promise.all([
      postAnswer(sessionId, sessionToken, "q_accident_count", 10),
      postAnswer(sessionId, sessionToken, "q_accident_count", 20),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const ledger = (await answerLedger(testDb.db, SessionId.parse(sessionId))) as {
      questionId: string;
    }[];
    // q_at_fault_accident first, then both q_accident_count rows landed (append-only order).
    expect(ledger.map((row) => row.questionId)).toEqual([
      "q_at_fault_accident",
      "q_accident_count",
      "q_accident_count",
    ]);
    const latest = await latestAnswers(testDb.db, SessionId.parse(sessionId));
    expect([10, 20]).toContain(latest.get(QuestionId.parse("q_accident_count")));
  });
});
