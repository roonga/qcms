/**
 * The repeating group on the serving path (task 073, ADR-42, ADR-43, SEC-16), driven
 * through `app.request()` against the real kernel, the real compiler and the 013
 * Testcontainers harness DB. Never a mock of our own packages (CONTRIBUTING). Requires
 * Docker.
 *
 * `roster.test.ts` proves the derivation as a function, and `roster.integration.test.ts`
 * proves the derivation against the real ledger. This file proves the **endpoints**: the
 * projection a respondent is served, the batch answer write, the roster operation, and
 * the bounds SEC-16 states. It owns acceptance cases 36 and 54 to 57 of
 * `plan/repeating-groups-and-table-input.md` section 11, plus the two properties task
 * 072 handed to this task: one mint per group per transaction, and an answer naming a
 * dead instance being refused.
 *
 * **Task 075 added the outbox payload walk at the end** (acceptance case 51), because this
 * is the API suite's only real repeating form: a walk of a payload built from a fixture
 * with no group would assert the property on data that cannot break it.
 *
 * The fixture is built here rather than read from `packages/core/fixtures`, and that is
 * deliberate: the kernel's fixture forms are asserted to pin only questions from its own
 * canonical set, and two `open` groups in one form is a shape only this file needs (case
 * 54 turns on there being no per-session ceiling above two per-group ones). It is
 * compiled by the REAL compiler, so the stored document carries a real `RepeatGroup`
 * template and the projection is asserted against bytes the compiler produced.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileForm } from "@roonga/qcms-a2ui-compiler";
import {
  compileDraft,
  FormId,
  parseFormDefinition,
  parseQuestionDefinition,
  QuestionId,
  SessionId,
  type FormDefinition,
  type QuestionDefinition,
} from "@roonga/qcms-core";
import {
  answerLedger,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  insertFormVersion,
  rosterLedger,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { importSessionKeys, mintSessionToken } from "./session-token.js";
import { registerServeStep } from "./serve-step/route.js";
import { registerSubmit } from "./submit/route.js";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/** A question from the compiler's corpus fixtures, which carry the repeat members. */
function corpusQuestion(file: string): QuestionDefinition {
  const raw: unknown = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "packages", "a2ui-compiler", "fixtures", "corpus", "questions", file),
      "utf8",
    ),
  );
  const parsed = parseQuestionDefinition(raw);
  if (!parsed.ok) throw new Error(`fixture ${file} did not parse`);
  return parsed.value;
}

const PLATE = corpusQuestion("q-rep-plate.json");
const ODOMETER = corpusQuestion("q-rep-odometer.json");
const FLEET = corpusQuestion("q-rep-fleet-name.json");
const NOTES = corpusQuestion("q-rep-notes.json");

/**
 * One step, one plain question and TWO `open` groups of `max: 2`.
 *
 * Two groups is what makes case 54 a real assertion: filling both to their own `max` is
 * four live instances in one session, which no per-session ceiling refuses because the
 * Code Owner ruled that there is none (Q14). `max: 2` keeps the refusal one press away.
 */
const DEFINITION: FormDefinition = (() => {
  const parsed = parseFormDefinition({
    formId: "frm_repeat_serving",
    defaultLocale: "en",
    title: { en: "Two fleets" },
    steps: [
      {
        stepId: "stp_fleet",
        title: { en: "The vehicles" },
        items: [
          { questionId: FLEET.questionId, version: 1 },
          {
            groupId: "grp_vehicles",
            label: { en: "Vehicles" },
            instanceLabel: { en: "Vehicle {n}" },
            presentation: "stacked",
            count: { source: "open", min: 1, max: 2 },
            items: [
              { questionId: PLATE.questionId, version: 1 },
              { questionId: ODOMETER.questionId, version: 1 },
            ],
          },
          {
            groupId: "grp_incidents",
            label: { en: "Incidents" },
            instanceLabel: { en: "Incident {n}" },
            presentation: "stacked",
            count: { source: "open", min: 0, max: 2 },
            items: [{ questionId: NOTES.questionId, version: 1 }],
          },
        ],
      },
    ],
    rules: [],
  });
  if (!parsed.ok)
    throw new Error(`fixture definition did not parse: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
})();

/**
 * A second form whose ONE step can legitimately carry more answers than the shipped
 * per-session allowance (task 073, ruling Q29, 2026-10-02).
 *
 * Its bound is 1 + 3 members x `max: 4` = **13**, against a production default of 10 answers
 * per 5 seconds. The first fixture above cannot show this: its bound is 7, so every valid
 * batch of it fits the default and the defect Copilot found on PR #1034 is invisible. That
 * defect was that a no-JS Continue spends one unit per entry against an unchanged `max`, so a
 * populated repeating step was refused with a 429 and, because every retry re-posts the same
 * set into the same fixed window, refused forever.
 */
const WIDE_DEFINITION: FormDefinition = (() => {
  const parsed = parseFormDefinition({
    formId: "frm_repeat_wide",
    defaultLocale: "en",
    title: { en: "A wide fleet" },
    steps: [
      {
        stepId: "stp_wide",
        title: { en: "A wide fleet" },
        items: [
          { questionId: FLEET.questionId, version: 1 },
          {
            groupId: "grp_wide",
            label: { en: "Vehicles" },
            instanceLabel: { en: "Vehicle {n}" },
            presentation: "stacked",
            count: { source: "open", min: 1, max: 4 },
            items: [
              { questionId: PLATE.questionId, version: 1 },
              { questionId: ODOMETER.questionId, version: 1 },
              { questionId: NOTES.questionId, version: 1 },
            ],
          },
        ],
      },
    ],
    rules: [],
  });
  if (!parsed.ok) throw new Error(`wide fixture did not parse: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
})();

const QUESTIONS = [FLEET, PLATE, ODOMETER, NOTES];

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let formId: FormId;
let wideFormId: FormId;
let compiled: ReturnType<typeof compileForm>;
let seeded = 0;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), env: validEnv() });
  app = createApp(deps, PUBLIC_ONLY, {
    groups: { public: [registerServeStep, registerSubmit] },
  });
  internalToken = internalTokenFor(deps.config);

  for (const question of QUESTIONS) {
    await createQuestion(testDb.db, {
      questionId: question.questionId,
      slug: question.questionId.replaceAll("_", "-"),
    });
    await createQuestionVersion(testDb.db, {
      questionId: question.questionId,
      definition: question,
    });
  }
  // The REAL publish path, so the stored compiled document is what the compiler emits
  // for a repeating group rather than something this test shaped.
  const draft = compileDraft({
    definition: DEFINITION,
    resolveQuestion: (questionId, version) =>
      version === 1
        ? QUESTIONS.filter((q) => q.questionId === questionId).map((definition) => ({
            questionId,
            version,
            definition,
          }))[0]
        : undefined,
    publishedQuestionVersions: new Map(QUESTIONS.map((q) => [q.questionId, new Set([1])])),
  });
  if (!draft.ok) throw new Error(`fixture did not publish: ${JSON.stringify(draft.error)}`);
  compiled = compileForm(draft.value.snapshot, {});

  const wideDraft = compileDraft({
    definition: WIDE_DEFINITION,
    resolveQuestion: (questionId, version) =>
      version === 1
        ? QUESTIONS.filter((q) => q.questionId === questionId).map((definition) => ({
            questionId,
            version,
            definition,
          }))[0]
        : undefined,
    publishedQuestionVersions: new Map(QUESTIONS.map((q) => [q.questionId, new Set([1])])),
  });
  if (!wideDraft.ok)
    throw new Error(`wide fixture did not publish: ${JSON.stringify(wideDraft.error)}`);
  const wideCompiled = compileForm(wideDraft.value.snapshot, {});

  formId = FormId.parse("frm_repeat_serving");
  await createForm(testDb.db, { formId, slug: "two-fleets", defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId,
    definition: DEFINITION,
    compiled,
    compilerVersion: compiled.compilerVersion,
    a2uiSpecVersion: compiled.a2uiSpecVersion,
    semanticsVersion: "1",
  });

  wideFormId = FormId.parse("frm_repeat_wide");
  await createForm(testDb.db, { formId: wideFormId, slug: "wide-fleet", defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId: wideFormId,
    definition: WIDE_DEFINITION,
    compiled: wideCompiled,
    compilerVersion: wideCompiled.compilerVersion,
    a2uiSpecVersion: wideCompiled.a2uiSpecVersion,
    semanticsVersion: "1",
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

beforeEach(async () => {
  // Each case gets its own session: a roster is session state and the whole subject
  // here is what one session's roster does.
  await deps.rateLimitStore.reset(`rl:answers-session:${current.sessionId}`).catch(() => undefined);
});

interface Session {
  readonly sessionId: string;
  readonly token: string;
}
let current: Session = { sessionId: "ses_placeholder", token: "" };

async function newSession(): Promise<Session> {
  seeded += 1;
  const sessionId = SessionId.parse(`ses_repeat_${String(seeded)}`);
  await createSession(testDb.db, {
    sessionId,
    formId,
    formVersion: 1,
    accessMode: "anonymous",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  const [signingKey] = await importSessionKeys(deps.config);
  const token = await mintSessionToken(
    sessionId,
    new Date(NOW.getTime() + 86_400_000),
    signingKey!,
  );
  current = { sessionId, token };
  return current;
}

/** A session on the wide form, whose step bound (13) exceeds the shipped max (10). */
async function newWideSession(): Promise<Session> {
  seeded += 1;
  const sessionId = SessionId.parse(`ses_wide_${String(seeded)}`);
  await createSession(testDb.db, {
    sessionId,
    formId: wideFormId,
    formVersion: 1,
    accessMode: "anonymous",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  const [signingKey] = await importSessionKeys(deps.config);
  const token = await mintSessionToken(
    sessionId,
    new Date(NOW.getTime() + 86_400_000),
    signingKey!,
  );
  current = { sessionId, token };
  return current;
}

function headers(session: Session): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    authorization: `Bearer ${session.token}`,
  };
}

interface StepBody {
  readonly step: { readonly stepId: string; readonly root: unknown } | null;
  readonly values: Record<string, unknown>;
  readonly flowState: {
    readonly visibleQuestions: readonly string[];
    readonly missingRequired: readonly string[];
    readonly readyToSubmit: boolean;
  };
  readonly rosters: readonly { readonly groupId: string; readonly instances: readonly string[] }[];
}

interface RosterBody extends StepBody {
  readonly replayed: boolean;
  readonly minted: readonly string[];
}

interface BatchBody extends StepBody {
  readonly rejected: readonly { readonly questionId: string; readonly code: string }[];
}

async function getStep(session: Session): Promise<StepBody> {
  const res = await app.request(`/sessions/${session.sessionId}/step`, {
    headers: headers(session),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as StepBody;
}

async function roster(
  session: Session,
  body: Record<string, unknown>,
): Promise<{ status: number; body: RosterBody }> {
  const res = await app.request(`/sessions/${session.sessionId}/roster`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as RosterBody };
}

async function batch(
  session: Session,
  answers: readonly Record<string, unknown>[],
): Promise<{ status: number; body: BatchBody }> {
  const res = await app.request(`/sessions/${session.sessionId}/answers/batch`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ answers }),
  });
  return { status: res.status, body: (await res.json()) as BatchBody };
}

function instancesOf(body: StepBody, groupId: string): readonly string[] {
  return body.rosters.find((entry) => entry.groupId === groupId)?.instances ?? [];
}

let opCounter = 0;
function token(): string {
  opCounter += 1;
  return `op_${String(opCounter).padStart(8, "0")}`;
}

describe("the step projection carries the live roster (ADR-42, ADR-43)", () => {
  it("mints the open group's min on the first serve and nothing on the second", async () => {
    const session = await newSession();
    const first = await getStep(session);
    // `min: 1` on `grp_vehicles`, so the respondent meets a card to fill rather than an
    // empty group with a button; `min: 0` on `grp_incidents` still mints ONE, because
    // an empty group with only a button is the same dead end (ADR-42's minting rule).
    expect(instancesOf(first, "grp_vehicles")).toHaveLength(1);
    expect(instancesOf(first, "grp_incidents")).toHaveLength(1);

    const second = await getStep(session);
    expect(second.rosters).toEqual(first.rosters);
    // Idempotent against the rows already written, so a reload mints nothing.
    expect(await rosterLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(2);
  });

  it("mints at most once per group per transaction (task 072's exit criterion)", async () => {
    // `occurred_at` defaults to `now()`, which in Postgres is the TRANSACTION's
    // timestamp, so two mint statements in one transaction write rows sharing a
    // timestamp to the microsecond and only the read's `instance_id` tiebreaker orders
    // them. One statement per group per transaction is what keeps the order a mint
    // intended and the order a later read returns the same thing.
    const session = await newSession();
    await getStep(session);
    const ledger = await rosterLedger(testDb.db, SessionId.parse(session.sessionId));
    const perGroup = new Map<string, Set<number>>();
    for (const row of ledger) {
      const stamps = perGroup.get(row.groupId) ?? new Set<number>();
      stamps.add(row.occurredAt.getTime());
      perGroup.set(row.groupId, stamps);
    }
    // One distinct timestamp per group: a second statement would land at the same
    // transaction time, so this asserts the shape rather than the clock - what it
    // refuses is a group whose rows came from two different transactions on one serve.
    for (const [groupId, stamps] of perGroup) {
      expect(stamps.size, groupId).toBe(1);
    }
    expect(perGroup.size).toBe(2);
  });

  it("names every visible field by its answer key, qualified inside a group", async () => {
    const session = await newSession();
    const body = await getStep(session);
    const vehicle = instancesOf(body, "grp_vehicles")[0]!;
    const incident = instancesOf(body, "grp_incidents")[0]!;
    expect([...body.flowState.visibleQuestions].sort((a, b) => a.localeCompare(b))).toEqual(
      [
        "q_rep_fleet_name",
        `${vehicle}/q_rep_plate`,
        `${vehicle}/q_rep_odometer`,
        `${incident}/q_rep_notes`,
      ].sort((a, b) => a.localeCompare(b)),
    );
    // And the missing-required set is per CELL, not per question: the qualified key is
    // the only thing that can say which instance is short of an answer.
    expect(body.flowState.missingRequired).toContain(`${vehicle}/q_rep_plate`);
    expect(body.flowState.missingRequired).toContain(`${vehicle}/q_rep_odometer`);
  });

  it("serves the stored RepeatGroup template verbatim (ADR-18)", async () => {
    const session = await newSession();
    const body = await getStep(session);
    // The bytes the compiler produced, not an expansion: expansion is the renderer's
    // render-time clone and the stored document is never touched.
    expect(body.step?.root).toEqual(compiled.documents[0]?.root);
  });
});

describe("the batch answer endpoint (Q20, acceptance case 36)", () => {
  it("applies a whole step's answers in one request", async () => {
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;
    const incident = instancesOf(served, "grp_incidents")[0]!;

    const { status, body } = await batch(session, [
      { questionId: "q_rep_fleet_name", value: "North depot" },
      { questionId: "q_rep_plate", instanceId: vehicle, value: "ABC123" },
      { questionId: "q_rep_odometer", instanceId: vehicle, value: 42_000 },
      { questionId: "q_rep_notes", instanceId: incident, value: "A kerbed wheel." },
    ]);

    expect(status).toBe(200);
    expect(body.rejected).toEqual([]);
    // One request, four ledger rows, each keyed by its own cell.
    const ledger = await answerLedger(testDb.db, SessionId.parse(session.sessionId));
    expect(ledger).toHaveLength(4);
    expect(
      ledger.filter((row) => row.questionId === QuestionId.parse("q_rep_plate"))[0]?.instanceId,
    ).toBe(vehicle);
    // And the projection that comes back is the post-batch one. Every required cell is
    // answered, so the flow is complete and `step` is null - which is the projection
    // saying "nothing left to draw" rather than a repeat-specific behaviour.
    expect(body.flowState.missingRequired).toEqual([]);
    expect(body.flowState.readyToSubmit).toBe(true);
  });

  it("carries an accepted answer back under its QUALIFIED key", async () => {
    // The other half of the case above, on a step the batch leaves incomplete so there
    // is still a step to draw: the answer key is the field's whole identity below the
    // API, so `values` is keyed by `instanceId/questionId` and the renderer's expansion
    // finds each cell's value under the name it rendered it with.
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;

    const { body } = await batch(session, [
      { questionId: "q_rep_plate", instanceId: vehicle, value: "ABC123" },
    ]);

    expect(body.values[`${vehicle}/q_rep_plate`]).toBe("ABC123");
    expect(body.flowState.missingRequired).not.toContain(`${vehicle}/q_rep_plate`);
    // The cell beside it is still short of an answer, named per cell.
    expect(body.flowState.missingRequired).toContain(`${vehicle}/q_rep_odometer`);
  });

  it("refuses one entry and applies the others (a mistyped cell of nine)", async () => {
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;

    const { status, body } = await batch(session, [
      { questionId: "q_rep_plate", instanceId: vehicle, value: "AB" },
      { questionId: "q_rep_odometer", instanceId: vehicle, value: 10 },
    ]);

    expect(status).toBe(200);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]?.questionId).toBe("q_rep_plate");
    expect(body.rejected[0]?.code).toBe("INVALID_ANSWER");
    // The entry beside it landed: a respondent who mistyped one cell of nine passengers
    // must not lose the other fifty-three.
    const ledger = await answerLedger(testDb.db, SessionId.parse(session.sessionId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.questionId).toBe(QuestionId.parse("q_rep_odometer"));
  });

  it("refuses an answer naming an instance that is not live (task 072's hand-over)", async () => {
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;
    // Remove it, then try to answer it. 072's storage helpers cannot make this check -
    // liveness is a function of the count source, derived above them - so it is owed
    // here, and it is owed by the VISIBILITY gate: a dead instance contributes no
    // visible cell, so no answer for it can be accepted.
    await roster(session, {
      op: "remove",
      groupId: "grp_vehicles",
      instanceId: vehicle,
      opToken: token(),
    });

    const { body } = await batch(session, [
      { questionId: "q_rep_plate", instanceId: vehicle, value: "ABC123" },
    ]);
    expect(body.rejected[0]?.code).toBe("QUESTION_NOT_VISIBLE");
    expect(await answerLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(0);
  });

  it("spends the per-session answer allowance per ENTRY (case 57, SEC-16)", async () => {
    // The configured allowance is 10 per 5 seconds per session. A batch of eleven
    // therefore cannot be paid for and is refused WHOLE - nothing is applied - while two
    // batches of five are both accepted, because together they are exactly the
    // allowance. That is the property SEC-16 states: the allowance does not move, the
    // unit it is spent in does.
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;
    const entry = { questionId: "q_rep_plate", instanceId: vehicle, value: "ABC123" };

    const tooBig = await batch(
      session,
      Array.from({ length: 11 }, () => entry),
    );
    expect(tooBig.status).toBe(429);
    expect(await answerLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(0);

    await deps.rateLimitStore.reset(`rl:answers-session:${session.sessionId}`);
    const five = Array.from({ length: 5 }, () => entry);
    expect((await batch(session, five)).status).toBe(200);
    expect((await batch(session, five)).status).toBe(200);
  });
});

describe("a whole step fits the allowance, at the SHIPPED defaults (Q29)", () => {
  // `validEnv()` sets no rate-limit overrides, so every case here runs against the
  // production default of ten answers per five seconds per session
  // (`DEFAULTS.rlAnswersPerSession`). That is the whole point: PR #1034 found that a no-JS
  // Continue spends one unit per entry against that unchanged `max`, so a populated
  // repeating step was refused with a 429 and, because every retry re-posts the same set
  // into the same fixed window, refused for good. The Code Owner's ruling of 2026-10-02
  // sizes one batch's ceiling to the step's own bound instead.

  /** Every answer a fully populated wide step carries: 1 plain + 3 members x 4 instances. */
  async function wholeWideStep(
    session: Session,
  ): Promise<{ questionId: string; instanceId?: string; value: unknown }[]> {
    // Grow the group to its `max` first, which is what a respondent does before Continue.
    for (let press = 0; press < 3; press += 1) {
      const res = await roster(session, { op: "add", groupId: "grp_wide", opToken: token() });
      expect(res.status, "growing the group to max").toBe(200);
    }
    const instances = instancesOf(await getStep(session), "grp_wide");
    expect(instances, "the group is at its max of four").toHaveLength(4);
    const entries: { questionId: string; instanceId?: string; value: unknown }[] = [
      { questionId: "q_rep_fleet_name", value: "North depot" },
    ];
    for (const [index, instanceId] of instances.entries()) {
      entries.push({ questionId: "q_rep_plate", instanceId, value: `AAA${String(index)}11` });
      entries.push({ questionId: "q_rep_odometer", instanceId, value: 10_000 + index });
      entries.push({ questionId: "q_rep_notes", instanceId, value: `Note ${String(index)}` });
    }
    return entries;
  }

  it("accepts a populated step of 13 answers against a max of 10", async () => {
    const session = await newWideSession();
    await getStep(session);
    expect(deps.config.rateLimit.answersPerSession.max, "the shipped default").toBe(10);

    const entries = await wholeWideStep(session);
    expect(entries, "the step's own bound").toHaveLength(13);

    const { status, body } = await batch(session, entries);

    // 200 under the ruling; 429 before it, which is the regression this holds shut.
    expect(status).toBe(200);
    expect(body.rejected).toEqual([]);
    expect(await answerLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(13);
  });

  it("refuses a batch ABOVE the step's bound, whatever the configured max", async () => {
    // The other half of the ruling: the ceiling is the step's bound, not a blank cheque. The
    // entries are legitimate cells repeated, so what refuses this is the COUNT and nothing
    // about the content.
    const session = await newWideSession();
    await getStep(session);
    const entries = await wholeWideStep(session);
    const instanceId = entries[1]?.instanceId;
    const over = [...entries, { questionId: "q_rep_plate", instanceId, value: "ZZZ999" }];

    const { status } = await batch(session, over);

    expect(status).toBe(429);
    // And nothing was written: the spend happens before any entry is applied.
    expect(await answerLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(0);
  });

  it("sizes the bound per FORM, so a narrow step gets no wider allowance", async () => {
    // The first fixture's step bound is 7 (1 plain + 2 members x max 2 + 1 member x max 2),
    // which is BELOW the configured max of 10. The ceiling is the larger of the two, so this
    // form keeps its configured allowance and a batch above its own bound is still refused:
    // the ruling raises the floor for a wide step without lowering anything for a narrow one.
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;
    const over = Array.from({ length: 8 }, () => ({
      questionId: "q_rep_plate",
      instanceId: vehicle,
      value: "ABC123",
    }));

    expect((await batch(session, over)).status).toBe(429);
  });
});

describe("the roster operation (ADR-43, acceptance cases 54 and 56)", () => {
  it("adds an instance, and refuses the add that would cross max (case 54)", async () => {
    const session = await newSession();
    await getStep(session);

    const added = await roster(session, {
      op: "add",
      groupId: "grp_vehicles",
      opToken: token(),
    });
    expect(added.status).toBe(200);
    expect(added.body.minted).toHaveLength(1);
    expect(instancesOf(added.body, "grp_vehicles")).toHaveLength(2);

    // `max: 2` reached. The per-form bound is the only bound there is (Q14, SEC-16).
    const refused = await roster(session, {
      op: "add",
      groupId: "grp_vehicles",
      opToken: token(),
    });
    expect(refused.status).toBe(409);
    expect((refused.body as unknown as { error: { code: string } }).error.code).toBe(
      "REPEAT_MAX_REACHED",
    );
  });

  it("fills BOTH groups to their own max in one session (case 54's second half)", async () => {
    // No per-session total ceiling exists to refuse it, and that is a positive
    // assertion rather than the absence of a test: the Code Owner removed every
    // installation-wide ceiling on 2026-09-29 (Q14).
    const session = await newSession();
    await getStep(session);
    expect(
      (await roster(session, { op: "add", groupId: "grp_vehicles", opToken: token() })).status,
    ).toBe(200);
    expect(
      (await roster(session, { op: "add", groupId: "grp_incidents", opToken: token() })).status,
    ).toBe(200);
    const body = await getStep(session);
    expect(instancesOf(body, "grp_vehicles")).toHaveLength(2);
    expect(instancesOf(body, "grp_incidents")).toHaveLength(2);
  });

  it("applies a replayed operation token exactly once", async () => {
    // What the 200 re-render costs and what the token pays for: the response to the
    // Add is a page, so a reload can resubmit it. The same token twice is one instance.
    const session = await newSession();
    await getStep(session);
    const replayed = token();

    const first = await roster(session, { op: "add", groupId: "grp_vehicles", opToken: replayed });
    expect(first.body.replayed).toBe(false);
    expect(instancesOf(first.body, "grp_vehicles")).toHaveLength(2);

    const second = await roster(session, { op: "add", groupId: "grp_vehicles", opToken: replayed });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.minted).toEqual([]);
    expect(instancesOf(second.body, "grp_vehicles")).toHaveLength(2);
  });

  it("records no token for a REFUSED add, so a refusal cannot be replayed into one", async () => {
    const session = await newSession();
    await getStep(session);
    await roster(session, { op: "add", groupId: "grp_vehicles", opToken: token() });
    const refusedToken = token();
    expect(
      (await roster(session, { op: "add", groupId: "grp_vehicles", opToken: refusedToken })).status,
    ).toBe(409);
    // Replaying the refused token is refused again rather than being read as "already
    // applied", which would be the shape that turns a refusal into an acceptance.
    expect(
      (await roster(session, { op: "add", groupId: "grp_vehicles", opToken: refusedToken })).status,
    ).toBe(409);
    expect(instancesOf(await getStep(session), "grp_vehicles")).toHaveLength(2);
  });

  it("writes no answer at all (the ruling of 2026-09-30)", async () => {
    const session = await newSession();
    await getStep(session);
    await roster(session, { op: "add", groupId: "grp_vehicles", opToken: token() });
    // Not one ledger row, and no retraction either. This is the property the whole no-JS
    // shape rests on: `formnovalidate` on the Add button is safe because the post
    // commits nothing, so an emptied required field on it is neither stored nor cleared.
    expect(await answerLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(0);
  });

  it("removes an instance by appending, never by deleting (I6)", async () => {
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;
    const removed = await roster(session, {
      op: "remove",
      groupId: "grp_vehicles",
      instanceId: vehicle,
      opToken: token(),
    });
    expect(removed.status).toBe(200);
    expect(instancesOf(removed.body, "grp_vehicles")).toEqual([]);
    const ledger = await rosterLedger(testDb.db, SessionId.parse(session.sessionId));
    expect(ledger.filter((row) => row.instanceId === vehicle).map((row) => row.event)).toEqual([
      "added",
      "removed",
    ]);
  });

  it("refuses a removal naming an instance this session never minted", async () => {
    // Finding 5 of PR #1034's review. A well-formed `ins_` id this roster never minted
    // appended a `removed` row under a key no roster lists: nothing was disclosed and no
    // derived list moved, because every read starts from `minted`, but the table is
    // append-only and only an erasure clears it. The caller obligation on
    // `removeRosterInstance` is discharged in `applyRosterOp` now rather than documented.
    const session = await newSession();
    const served = await getStep(session);
    const mine = instancesOf(served, "grp_vehicles")[0]!;
    const forged = `ins_${"a".repeat(32)}`;

    const res = await roster(session, {
      op: "remove",
      groupId: "grp_vehicles",
      instanceId: forged,
      opToken: token(),
    });

    expect(res.status).toBe(404);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe(
      "UNKNOWN_INSTANCE",
    );
    // Nothing appended, and the token NOT spent: a refusal records nothing, so the
    // respondent's own next press with a fresh token is unaffected.
    const ledger = await rosterLedger(testDb.db, SessionId.parse(session.sessionId));
    expect(ledger.filter((row) => row.instanceId === forged)).toEqual([]);
    expect(instancesOf(await getStep(session), "grp_vehicles")).toEqual([mine]);
  });

  it("refuses a removal of an instance another session minted", async () => {
    // The same check from the direction that matters: two live sessions on the same form,
    // and one may not remove the other's instance even though the id is real.
    const mine = await newSession();
    const theirs = await newSession();
    const theirVehicle = instancesOf(await getStep(theirs), "grp_vehicles")[0]!;
    await getStep(mine);

    const res = await roster(mine, {
      op: "remove",
      groupId: "grp_vehicles",
      instanceId: theirVehicle,
      opToken: token(),
    });

    expect(res.status).toBe(404);
    expect(instancesOf(await getStep(theirs), "grp_vehicles")).toEqual([theirVehicle]);
  });

  it("refuses a group the form does not declare", async () => {
    const session = await newSession();
    await getStep(session);
    const res = await roster(session, { op: "add", groupId: "grp_ghost", opToken: token() });
    expect(res.status).toBe(404);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe("UNKNOWN_GROUP");
  });

  it("is rate limited per session, separately from the answer write (case 56)", async () => {
    // Its own class rather than riding the answer write's, because adding an instance is
    // a distinct action that is cheap to repeat (SEC-16). "Separately" is the assertion
    // that matters: spending the roster allowance must not spend the answer one.
    const session = await newSession();
    await getStep(session);
    let refused = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await roster(session, {
        op: "add",
        groupId: "grp_vehicles",
        opToken: token(),
      });
      if (res.status === 429) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);

    // The answer allowance is untouched by all of that.
    const body = await getStep(session);
    const vehicle = instancesOf(body, "grp_vehicles")[0]!;
    const answered = await batch(session, [
      { questionId: "q_rep_plate", instanceId: vehicle, value: "ABC123" },
    ]);
    expect(answered.status).toBe(200);
  });
});

// --- task 075: the outbox payload (acceptance case 51, ADR-17, SEC-16) -------

describe("the response.submitted payload carries instances inside answers and nowhere else", () => {
  /** The payload the submit transaction enqueued, read from the outbox row itself. */
  async function enqueuedPayload(sessionId: string): Promise<Record<string, unknown>> {
    const res = await testDb.client.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(`select event_type, payload from outbox where payload->>'sessionId' = $1`, [sessionId]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0]!.event_type).toBe("response.submitted");
    return res.rows[0]!.payload;
  }

  /** Answer the whole step on a fresh session and submit it. */
  async function submitFilledSession(): Promise<{ session: Session; plates: string[] }> {
    const session = await newSession();
    // Serve first: the first serve is what mints each group's `min`, and an Add before
    // it would race that mint. Then add a second vehicle, so the payload has to tell
    // two instances of the same question apart.
    await getStep(session);
    await roster(session, { op: "add", groupId: "grp_vehicles", opToken: token() });
    const served = await getStep(session);
    const vehicles = instancesOf(served, "grp_vehicles");
    const incident = instancesOf(served, "grp_incidents")[0]!;
    expect(vehicles).toHaveLength(2);

    // `maxLength: 8` on `q_rep_plate`, so the fixture plates are plate-shaped.
    const plates = ["AAA111", "BBB222"];
    const { status } = await batch(session, [
      { questionId: "q_rep_fleet_name", value: "North depot" },
      ...vehicles.flatMap((instanceId, at) => [
        { questionId: "q_rep_plate", instanceId, value: plates[at] },
        { questionId: "q_rep_odometer", instanceId, value: 1000 * (at + 1) },
      ]),
      { questionId: "q_rep_notes", instanceId: incident, value: "A kerbed wheel." },
    ]);
    expect(status).toBe(200);

    const submitted = await app.request(`/sessions/${session.sessionId}/submit`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({}),
    });
    expect(submitted.status).toBe(200);
    return { session, plates };
  }

  it("carries each instance's answers as LockedAnswer entries with an instanceId", async () => {
    const { session, plates } = await submitFilledSession();
    const payload = await enqueuedPayload(session.sessionId);

    const answers = payload["answers"] as Array<{
      questionId: string;
      instanceId?: string;
      value: unknown;
    }>;
    // Both vehicles are present, told apart by instance and not collapsed to one.
    const platesInPayload = answers
      .filter((entry) => entry.questionId === "q_rep_plate")
      .map((entry) => entry.value);
    expect(platesInPayload).toEqual(plates);
    const instanceIds = new Set(
      answers.filter((entry) => entry.instanceId !== undefined).map((entry) => entry.instanceId),
    );
    expect(instanceIds.size).toBe(3); // two vehicles and one incident
    // The question outside every group carries NO instanceId key at all, which is what
    // keeps a non-repeating form's payload and content hash byte-identical.
    const fleet = answers.find((entry) => entry.questionId === "q_rep_fleet_name")!;
    expect("instanceId" in fleet).toBe(false);
  });

  it("carries no respondent content outside the answers member (the walk)", async () => {
    // This is the assertion the redaction depends on and nothing else states. Erasure
    // and the retention sweep both redact by dropping exactly ONE jsonb key,
    // `payload - 'answers'`, and migration 0016's CHECK enforces that a redacted payload
    // holds no `answers` key. Content in a sibling member - `groups`, `rows`,
    // `instances` - would escape both, silently, and the first anyone would know is a
    // subject-access request answered with data that was supposed to be erased.
    const { session, plates } = await submitFilledSession();
    const payload = await enqueuedPayload(session.sessionId);

    // The member set is exactly this. A new sibling fails here rather than in
    // production, which is the point of asserting the keys rather than their contents.
    expect(Object.keys(payload).sort()).toEqual([
      "answers",
      "contentHash",
      "formId",
      "formVersion",
      "sessionId",
      "submittedAt",
    ]);

    // Everything but the key the redaction drops, serialized, so the assertions below
    // are about the whole remainder rather than about members somebody remembered.
    const rest = Object.fromEntries(
      Object.entries(payload).filter(([member]) => member !== "answers"),
    );
    const outside = JSON.stringify(rest);
    for (const plate of plates) expect(outside).not.toContain(plate);
    expect(outside).not.toContain("North depot");
    expect(outside).not.toContain("kerbed");
    // No instance id and no roster outside `answers` either: an `ins_` id is a
    // permitted correlator in telemetry (SEC-13) and is still respondent-derived
    // state, so the one place it may sit in this payload is the key redaction drops.
    expect(outside).not.toContain("ins_");
    // And no count. "How many vehicles" is disclosive on its own (Q19).
    const counts = Object.values(rest).filter((value) => typeof value === "number");
    expect(counts).toEqual([1]); // formVersion, and nothing else numeric
  });
});
