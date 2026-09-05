/**
 * Serving-loop slice tests (task 019), driven through `app.request()` against
 * the **real** kernel and the 013 Testcontainers harness DB - never a mock of
 * our own packages (CONTRIBUTING). Requires Docker.
 *
 * The fixture is the canonical `insurance` form (`@roonga/qcms-core` fixtures): one
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
 *
 * It also pins the ADR-16 semantics gate on this loop (issue #723): a stored
 * stamp the evaluator does not implement, or one that is not a number at all,
 * refuses both endpoints instead of being branched under current semantics.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FormId, QuestionId, SessionId } from "@roonga/qcms-core";
import {
  answerLedger,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  insertFormVersion,
  latestAnswers,
  markSubmitted,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { importSessionKeys, mintSessionToken } from "../session-token.js";
import { registerStartSession } from "../start-session/route.js";
import { registerServeStep } from "./route.js";
import { HeldValues } from "./schema.js";

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

/** The kitchen-sink fixture and its golden: the one fixture form carrying a text
 * and a multiChoice question, which the ADR-33 empty-value block needs. */
const KITCHEN_SINK_DEF = readFixture(
  "packages",
  "core",
  "fixtures",
  "forms",
  "valid",
  "kitchen-sink.json",
) as VersionInput["definition"];
const KITCHEN_SINK_GOLDEN = readFixture(
  "packages",
  "a2ui-compiler",
  "golden",
  "v1",
  "kitchen-sink.a2ui.json",
) as Compiled;

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
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

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

/**
 * Seed the insurance form with one published version storing `compiled`.
 * `semanticsVersion` is the stored stamp (text, ADR-16); it defaults to the one
 * this evaluator implements and is overridden to exercise the gate.
 */
async function seedForm(
  id: string,
  slug: string,
  compiled: VersionInput["compiled"],
  semanticsVersion = "1",
): Promise<FormId> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, { formId, slug, defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId,
    definition: INSURANCE_DEF,
    compiled,
    compilerVersion: GOLDEN.compilerVersion,
    a2uiSpecVersion: GOLDEN.a2uiSpecVersion,
    semanticsVersion,
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
  values: Record<string, unknown>;
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

/** GET the step at an explicit visible-step cursor index (ADR-28). */
async function getStepAt(id: string, token: string, index: number): Promise<Response> {
  return app.request(`/sessions/${id}/step?step=${String(index)}`, {
    headers: { "x-qcms-internal-token": internalToken, authorization: `Bearer ${token}` },
  });
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
    // @roonga/qcms-db's emitted .d.ts (issue #5); only `questionId` is read here.
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

// --- answer retraction (ADR-33, issue #95) ----------------------------------

describe("answer retraction (ADR-33)", () => {
  it("a null value retracts: the question becomes required-missing again and the ledger records it", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    const sid = SessionId.parse(sessionId);

    await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    const answered = (await (
      await postAnswer(sessionId, sessionToken, "q_accident_count", 10)
    ).json()) as StepBody;
    expect(answered.flowState.readyToSubmit).toBe(true);

    // The respondent clears the number: post null on the same route.
    const res = await postAnswer(sessionId, sessionToken, "q_accident_count", null);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    // The flow re-evaluates with the question UNANSWERED, so the required gap is
    // back and the flow is no longer submittable. This is what stops Continue.
    expect(body.flowState.missingRequired).toEqual(["q_accident_count"]);
    expect(body.flowState.readyToSubmit).toBe(false);

    // The read model omits it; the audit ledger keeps every row, retraction last.
    const latest = await latestAnswers(testDb.db, sid);
    expect(latest.has(QuestionId.parse("q_accident_count"))).toBe(false);
    expect(latest.get(QuestionId.parse("q_at_fault_accident"))).toBe(true);
    const ledger = (await answerLedger(testDb.db, sid)) as {
      questionId: string;
      value: unknown;
      retracted: boolean;
    }[];
    expect(ledger.map((row) => [row.questionId, row.value, row.retracted])).toEqual([
      ["q_at_fault_accident", true, false],
      ["q_accident_count", 10, false],
      ["q_accident_count", null, true],
    ]);

    // Answering again after the retraction restores the flow.
    const reanswered = (await (
      await postAnswer(sessionId, sessionToken, "q_accident_count", 7)
    ).json()) as StepBody;
    expect(reanswered.flowState.readyToSubmit).toBe(true);
    expect((await latestAnswers(testDb.db, sid)).get(QuestionId.parse("q_accident_count"))).toBe(7);
  });

  it("retracting a question that was never answered is a no-op, not an error and not a tombstone", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    const sid = SessionId.parse(sessionId);

    // The sibling case from issue #95: a never-answered required control commits
    // empty. It used to 422 with "invalid value" on a question nobody answered.
    const res = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", null);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.flowState.missingRequired).toEqual(["q_at_fault_accident"]);
    expect(body.flowState.readyToSubmit).toBe(false);
    // No ledger noise: a tombstone over nothing records no event.
    expect((await answerLedger(testDb.db, sid)) as unknown[]).toEqual([]);
  });

  it("is not a validation bypass: an invalid real answer is still 422 and appends nothing", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    const sid = SessionId.parse(sessionId);
    await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);

    // Only a literal null takes the retraction branch; every other value goes to
    // the kernel exactly as before, and the retraction branch can never carry one.
    const invalid = await postAnswer(sessionId, sessionToken, "q_accident_count", "ten");
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as ErrBody).error.code).toBe("INVALID_ANSWER");
    const ledger = (await answerLedger(testDb.db, sid)) as { questionId: string }[];
    expect(ledger.map((row) => row.questionId)).toEqual(["q_at_fault_accident"]);
  });

  it("is authorized exactly like an answer write: hidden question 409, unknown 404, no token 401", async () => {
    const { sessionId, sessionToken } = await startSession("auto");

    // q_accident_count is hidden until q_at_fault_accident = true: a retraction
    // may not reach it either (it would otherwise probe the hidden flow).
    const hidden = await postAnswer(sessionId, sessionToken, "q_accident_count", null);
    expect(hidden.status).toBe(409);
    expect(((await hidden.json()) as ErrBody).error.code).toBe("QUESTION_NOT_VISIBLE");

    const unknown = await postAnswer(sessionId, sessionToken, "q_not_in_form", null);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as ErrBody).error.code).toBe("UNKNOWN_QUESTION");

    const unauthed = await app.request(`/sessions/${sessionId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
      body: JSON.stringify({ questionId: "q_at_fault_accident", value: null }),
    });
    expect(unauthed.status).toBe(401);
  });
});

// --- ADR-33: an empty value is not an answer (issue #128 batch) -------------

// The insurance fixture holds only a boolean and a number, neither of which has
// an "empty" spelling, so this block seeds the kitchen-sink form for its
// required shortText and required multiChoice. ONE session for the whole block,
// deliberately: the fixed clock puts every session create in this file into a
// single rate-limit window (20/hour), and the file already sits at its edge.
describe("an empty value is refused, never stored and never a retraction (ADR-33)", () => {
  beforeAll(async () => {
    for (const [questionId, slug, file] of [
      ["q_full_name", "full-name", "short-text.json"],
      ["q_dob", "dob", "date.json"],
      ["q_preexisting_conditions", "conditions", "multi-choice.json"],
      ["q_medical_history", "history", "long-text.json"],
      ["q_coverage_level", "coverage", "single-choice.json"],
    ] as const) {
      await createQuestion(testDb.db, { questionId: QuestionId.parse(questionId), slug });
      await createQuestionVersion(testDb.db, {
        questionId: QuestionId.parse(questionId),
        definition: readFixture(
          "packages",
          "core",
          "fixtures",
          "questions",
          "valid",
          file,
        ) as Parameters<typeof createQuestionVersion>[1]["definition"],
      });
    }
    const formId = FormId.parse("frm_kitchen_sink");
    await createForm(testDb.db, { formId, slug: "kitchen", defaultLocale: "en" });
    await insertFormVersion(testDb.db, {
      formId,
      definition: KITCHEN_SINK_DEF,
      compiled: KITCHEN_SINK_GOLDEN as unknown as VersionInput["compiled"],
      compilerVersion: KITCHEN_SINK_GOLDEN.compilerVersion,
      a2uiSpecVersion: KITCHEN_SINK_GOLDEN.a2uiSpecVersion,
      semanticsVersion: "1",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  /** The one error an empty post must produce, whatever else the question asks. */
  const EMPTY_ERROR = {
    code: "EMPTY_ANSWER_NOT_ALLOWED",
    constraint: "encoding",
    message: "An empty value is not an answer; send null to clear the answer",
  };

  it('rejects "" and [] with nothing appended; whitespace-only text is stored but absent', async () => {
    const { sessionId, sessionToken } = await startSession("kitchen");
    const sid = SessionId.parse(sessionId);

    // 1. A required shortText. Before this batch, "" was stored and SATISFIED
    //    required - the ADR-33 hole. Now it is refused, value-free.
    const emptyText = await postAnswer(sessionId, sessionToken, "q_full_name", "");
    expect(emptyText.status).toBe(422);
    const textBody = (await emptyText.json()) as ErrBody;
    expect(textBody.error.code).toBe("INVALID_ANSWER");
    expect(textBody.error.details).toEqual({
      questionId: "q_full_name",
      errors: [EMPTY_ERROR],
    });

    // Nothing appended, and no tombstone either: a refusal is not a retraction.
    expect((await answerLedger(testDb.db, sid)) as unknown[]).toEqual([]);
    const afterEmpty = (await (await getStep(sessionId, sessionToken)).json()) as StepBody;
    expect(afterEmpty.flowState.missingRequired).toContain("q_full_name");

    // The empty rule fires ahead of the question's OWN constraints: q_full_name
    // carries minLength 1 and a pattern, either of which would also have
    // rejected "", and neither appears. The respondent is told the one true
    // thing (that was not an answer), not asked to type more.

    // 2. Answer it for real, then walk to the multiChoice on the next step.
    const real = await postAnswer(sessionId, sessionToken, "q_full_name", "Ada Lovelace");
    expect(real.status).toBe(200);
    expect(((await real.json()) as StepBody).flowState.missingRequired).not.toContain(
      "q_full_name",
    );
    await postAnswer(sessionId, sessionToken, "q_dob", "1990-05-04");

    // 3. The multiChoice counterpart. `[]` reports the empty error ALONE - not
    //    the question's own minSelected:1, which would read as "select more"
    //    when the truth is "that was never a selection".
    const emptySelection = await postAnswer(
      sessionId,
      sessionToken,
      "q_preexisting_conditions",
      [],
    );
    expect(emptySelection.status).toBe(422);
    expect(((await emptySelection.json()) as ErrBody).error.details).toEqual({
      questionId: "q_preexisting_conditions",
      errors: [EMPTY_ERROR],
    });

    // 4. Whitespace-only text is the OTHER rule (issue #128) and behaves the
    //    opposite way at this boundary: a legal value, appended, and echoed back
    //    exactly as typed - the ledger is an audit record, not a cleaned copy.
    //    That it confers no presence is pinned where presence lives (the kernel
    //    tests and the golden corpus); the optional longText is used here
    //    because the only required text question in the fixture set carries a
    //    pattern that rejects whitespace before presence is ever consulted.
    await postAnswer(sessionId, sessionToken, "q_preexisting_conditions", ["opt_asthma"]);
    const blank = await postAnswer(sessionId, sessionToken, "q_medical_history", "   ");
    expect(blank.status).toBe(200);
    const blankBody = (await blank.json()) as StepBody;
    expect(blankBody.values.q_medical_history).toBe("   ");

    // 5. The published `values` contract, exercised on real served bytes (issue
    //    #153). `HeldValues` is the canonical AnswerValue map rather than
    //    `z.unknown()`, so this fails loudly the day the projection emits
    //    something outside the encodings the ledger stores, and it pins that a
    //    canonical value round-trips unchanged (zero behaviour change intended).
    const parsed = HeldValues.safeParse(blankBody.values);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(blankBody.values);
    // Every canonical encoding is accepted, the multiChoice array and the two
    // string-shaped types (date, singleChoice) that the untagged union folds
    // into its text member included.
    expect(
      HeldValues.safeParse({
        q_full_name: "Ada Lovelace",
        q_dob: "1990-05-04",
        q_preexisting_conditions: ["opt_asthma", "opt_diabetes"],
        q_coverage_level: "opt_gold",
        q_at_fault_accident: true,
        q_accident_count: 4,
      }).success,
    ).toBe(true);
    // `null` is not an AnswerValue and never appears in this map: an unanswered
    // or retracted question is an ABSENT key (ADR-33 - `latestAnswers` resolves a
    // tombstone to unanswered). The schema refuses it now instead of publishing
    // it as legal, which is what the unconstrained `z.unknown()` did.
    expect(HeldValues.safeParse({ q_medical_history: null }).success).toBe(false);

    // Only the real answers are on the ledger; both refusals wrote nothing, and
    // neither left a tombstone - a refusal is not a retraction.
    const ledger = (await answerLedger(testDb.db, sid)) as {
      questionId: string;
      value: unknown;
      retracted: boolean;
    }[];
    expect(ledger.map((row) => [row.questionId, row.value, row.retracted])).toEqual([
      ["q_full_name", "Ada Lovelace", false],
      ["q_dob", "1990-05-04", false],
      ["q_preexisting_conditions", ["opt_asthma"], false],
      ["q_medical_history", "   ", false],
    ]);
  });
});

// --- held answers travel with the step (issue #146) -------------------------

// Two sessions for the whole block, on purpose: the fixed clock means every
// session create in this file counts against one rate-limit window, and the file
// already sits close to the default 20/hour.
describe("the served step carries the answers the server holds (issue #146)", () => {
  it("a resumed read, and every answer write, return the rendered step's stored answers", async () => {
    const { sessionId, sessionToken } = await startSession("auto");

    // Nothing answered yet: an empty map, never a missing field (the client seeds
    // its display state from it unconditionally).
    const fresh = (await (await getStep(sessionId, sessionToken)).json()) as StepBody;
    expect(fresh.values).toEqual({});

    // Each write returns the same map, so a branch reveal arrives with whatever
    // the newly-visible question already holds.
    const first = (await (
      await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true)
    ).json()) as StepBody;
    expect(first.values).toEqual({ q_at_fault_accident: true });
    // The second answer completes the single-step flow, so this response draws no
    // step - and a response with no step carries no values either.
    const second = (await (
      await postAnswer(sessionId, sessionToken, "q_accident_count", 4)
    ).json()) as StepBody;
    expect(second.step).toBeNull();
    expect(second.values).toEqual({});

    // A cursor read - what a resumed page load and a Back/Continue perform - keeps
    // drawing the step (ADR-28's no-collapse path) and carries both answers in
    // their canonical encoding, so the step renders them.
    const resumed = (await (await getStepAt(sessionId, sessionToken, 0)).json()) as StepBody;
    expect(resumed.values).toEqual({ q_at_fault_accident: true, q_accident_count: 4 });
    // The compiled document is untouched by this: still the stored bytes (ADR-18).
    expect(resumed.step).toEqual(GOLDEN.documents[0]);
  });

  it("a retraction resumes as unanswered, and an answer the flow now hides is never disclosed", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    await postAnswer(sessionId, sessionToken, "q_accident_count", 4);
    await postAnswer(sessionId, sessionToken, "q_accident_count", null);

    // `latestAnswers` drops the retracted row AFTER its DISTINCT ON pick, so the
    // read model already resolves the tombstone to unanswered; this pins that the
    // serving projection honours it rather than reviving the pre-retraction value.
    const retracted = (await (await getStep(sessionId, sessionToken)).json()) as StepBody;
    expect(retracted.values).toEqual({ q_at_fault_accident: true });
    expect("q_accident_count" in retracted.values).toBe(false);
    expect(retracted.flowState.missingRequired).toEqual(["q_accident_count"]);

    // Answer it again, then flip the trigger: q_accident_count is hidden while the
    // ledger keeps its answer (append-only, R3). The values map follows
    // VISIBILITY, not the ledger, so a hidden question's answer never crosses the
    // client boundary and the map cannot be used to enumerate the hidden flow.
    await postAnswer(sessionId, sessionToken, "q_accident_count", 9);
    await postAnswer(sessionId, sessionToken, "q_at_fault_accident", false);
    const hidden = (await (await getStepAt(sessionId, sessionToken, 0)).json()) as StepBody;
    expect(hidden.flowState.visibleQuestions).toEqual(["q_at_fault_accident"]);
    expect(hidden.values).toEqual({ q_at_fault_accident: false });
    const held = await latestAnswers(testDb.db, SessionId.parse(sessionId));
    expect(Object.fromEntries(held)).toEqual({ q_at_fault_accident: false, q_accident_count: 9 });
  });
});

// --- explicit navigation cursor (ADR-28, task 045) --------------------------

describe("explicit navigation cursor renders the requested step (ADR-28)", () => {
  it("?step renders that visible step even when the flow is complete (no collapse-on-answer)", async () => {
    const { sessionId, sessionToken } = await startSession("auto");

    // Answer the only required question false: q_accident_count stays hidden, so
    // the single step is complete and the derived cursor is null.
    const answered = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", false);
    const ab = (await answered.json()) as StepBody;
    expect(ab.flowState.readyToSubmit).toBe(true);
    expect(ab.flowState.currentStep).toBeNull();

    // No cursor: legacy projection collapses to no step (currentStep null).
    const legacy = (await (await getStep(sessionId, sessionToken)).json()) as StepBody;
    expect(legacy.step).toBeNull();
    expect(legacy.progress.stepIndex).toBe(1); // == totalVisibleSteps when complete

    // Cursor at index 0: the step still renders (ADR-28 - a completed step never
    // collapses; the respondent can review and Submit). flowState stays the
    // authority: readyToSubmit true, currentStep null.
    const res = await getStepAt(sessionId, sessionToken, 0);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.step).toEqual(GOLDEN.documents[0]);
    expect(body.flowState.visibleQuestions).toEqual(["q_at_fault_accident"]);
    expect(body.flowState.readyToSubmit).toBe(true);
    expect(body.flowState.currentStep).toBeNull();
    expect(body.progress).toEqual({ stepIndex: 0, totalVisibleSteps: 1 });
  });

  it("?step clamps an out-of-range index to the last visible step", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    const res = await getStepAt(sessionId, sessionToken, 9);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    // Only one visible step, so any index >= 0 clamps to it.
    expect(body.step).toEqual(GOLDEN.documents[0]);
    expect(body.progress).toEqual({ stepIndex: 0, totalVisibleSteps: 1 });
  });

  it("POST answer with ?step keeps rendering the cursor step while a branch reveals within it (guards M)", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    // Answer q_at_fault_accident = true carrying the cursor: the follow-up
    // becomes visible *within the same step*, and the response still renders that
    // cursor step (index 0) rather than advancing away from it.
    const answered = await app.request(`/sessions/${sessionId}/answers?step=0`, {
      method: "post",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalToken,
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ questionId: "q_at_fault_accident", value: true }),
    });
    expect(answered.status).toBe(200);
    const body = (await answered.json()) as StepBody;
    expect(body.step).toEqual(GOLDEN.documents[0]);
    expect(body.progress.stepIndex).toBe(0);
    expect(body.flowState.visibleQuestions).toEqual(["q_at_fault_accident", "q_accident_count"]);
    expect(body.flowState.missingRequired).toEqual(["q_accident_count"]);
    expect(body.flowState.readyToSubmit).toBe(false);
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

  /**
   * Task 048 regression (ADR-32): author-supplied validation messages are
   * presentation payload compiled into the A2UI document. The API is unchanged by
   * them - it keeps emitting the kernel's stable `{ code, constraint, message }`
   * triples and never reads, resolves or forwards an author message.
   *
   * Asserted as BYTES, not shape, and against content that carries no messages
   * (the `insurance` fixture). A response that gained a field, lost one, reordered
   * keys, or swapped the kernel's default message for an authored one fails here.
   * `arrayBuffer` rather than `text` so a stray BOM would also be caught.
   */
  it("048: the 422 body is byte-identical for content carrying no author messages", async () => {
    const { sessionId, sessionToken } = await startSession("auto");
    await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    const res = await postAnswer(sessionId, sessionToken, "q_accident_count", -1);
    expect(res.status).toBe(422);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"error":{"code":"INVALID_ANSWER","message":"The answer failed validation",' +
        '"details":{"questionId":"q_accident_count","errors":[' +
        '{"code":"VALUE_BELOW_MIN","constraint":"min","message":"Answer must be at least 0"}' +
        "]}}}",
    );
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

// --- the stored semantics stamp gates the serving loop (ADR-16, issue #723) -

describe("the stored semanticsVersion gates serving and answering (ADR-16)", () => {
  beforeAll(async () => {
    // The pinned library questions are already seeded by the first suite.
    // Same definition and same compiled document as the happy-path form; only
    // the stored stamp differs, so the stamp is the only thing under test.
    await seedForm(
      "frm_alien_semantics",
      "alien-semantics",
      GOLDEN as unknown as VersionInput["compiled"],
      "999", // a semantics version this evaluator does not implement
    );
    await seedForm(
      "frm_bad_semantics",
      "bad-semantics",
      GOLDEN as unknown as VersionInput["compiled"],
      "not-a-number", // a corrupt stamp: `Number()` would have made it NaN
    );
  });

  /**
   * A pinned session on `formId`, created and signed directly rather than
   * through `POST /sessions`. The suite runs on a frozen clock, so every
   * start-session call in the file counts against one per-IP rate-limit window
   * (026); these cases are about the serving loop, not about entry, so they
   * spend no budget on it.
   */
  async function sessionOn(
    formId: string,
    id: string,
  ): Promise<{ sessionId: string; sessionToken: string }> {
    const sessionId = SessionId.parse(id);
    const expiresAt = new Date(NOW.getTime() + TTL_MS);
    await createSession(testDb.db, {
      sessionId,
      formId: FormId.parse(formId),
      formVersion: 1,
      accessMode: "anonymous",
      expiresAt,
    });
    const [signingKey] = await importSessionKeys(deps.config);
    if (signingKey === undefined) throw new Error("no session signing key in test config");
    return { sessionId, sessionToken: await mintSessionToken(sessionId, expiresAt, signingKey) };
  }

  it("get-step refuses a snapshot recorded under superseded semantics (UNSUPPORTED_SEMANTICS_VERSION)", async () => {
    const { sessionId, sessionToken } = await sessionOn("frm_alien_semantics", "ses_alien_step");
    const res = await getStep(sessionId, sessionToken);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");
  });

  it("post-answer refuses it too, so no answer is branched under the wrong semantics", async () => {
    const { sessionId, sessionToken } = await sessionOn("frm_alien_semantics", "ses_alien_answer");
    const res = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");

    // The refusal happens before the append: the ledger stays empty.
    const ledger = await answerLedger(testDb.db, SessionId.parse(sessionId));
    expect(ledger).toHaveLength(0);
  });

  it("a stamp that is not a number is refused, never coerced to NaN and mismatched silently", async () => {
    const { sessionId, sessionToken } = await sessionOn("frm_bad_semantics", "ses_bad_stamp");

    const stepRes = await getStep(sessionId, sessionToken);
    expect(stepRes.status).toBe(409);
    expect(((await stepRes.json()) as ErrBody).error.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");

    const answerRes = await postAnswer(sessionId, sessionToken, "q_at_fault_accident", true);
    expect(answerRes.status).toBe(409);
    expect(((await answerRes.json()) as ErrBody).error.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");
  });

  it("the matching stamp still serves: the gate does not touch the happy path", async () => {
    const { sessionId, sessionToken } = await sessionOn("frm_auto_quote", "ses_good_stamp");
    const res = await getStep(sessionId, sessionToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.flowState.visibleQuestions).toEqual(["q_at_fault_accident"]);
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
