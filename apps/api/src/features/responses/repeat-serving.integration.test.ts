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
  SEED_WORKSPACE_ID,
  answerLedger,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  insertFormVersion,
  rosterLedger,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  DEFAULT_TEST_ENVIRONMENT,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";
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

// Its step bound is 1 + 3 members x `max: 4` = 13, above the shipped allowance of 10.
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

const PER_INSTANCE_DEFINITION: FormDefinition = (() => {
  const parsed = parseFormDefinition({
    formId: "frm_per_instance",
    defaultLocale: "en",
    title: { en: "One vehicle at a time" },
    steps: [
      {
        stepId: "stp_pi",
        title: { en: "The vehicles" },
        items: [
          { questionId: FLEET.questionId, version: 1 },
          {
            groupId: "grp_pi",
            label: { en: "Vehicles" },
            instanceLabel: { en: "Vehicle {n}" },
            presentation: "perInstanceStep",
            count: { source: "open", min: 3, max: 4 },
            items: [
              { questionId: PLATE.questionId, version: 1 },
              { questionId: NOTES.questionId, version: 1 },
            ],
          },
        ],
      },
    ],
    rules: [],
  });
  if (!parsed.ok)
    throw new Error(`per-instance fixture did not parse: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
})();

const QUESTIONS = [FLEET, PLATE, ODOMETER, NOTES];

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let formId: FormId;
let wideFormId: FormId;
let perInstanceFormId: FormId;
let compiled: ReturnType<typeof compileForm>;
let seeded = 0;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), env: validEnv() });
  app = createApp(deps, PUBLIC_ONLY, {
    groups: { respondent: [registerServeStep, registerSubmit] },
  });
  internalToken = internalTokenFor(deps.config);

  for (const question of QUESTIONS) {
    await createQuestion(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      questionId: question.questionId,
      slug: question.questionId.replaceAll("_", "-"),
    });
    await createQuestionVersion(testDb.db, {
      questionId: question.questionId,
      definition: question,
    });
  }
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
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug: "two-fleets",
    defaultLocale: "en",
  });
  await insertFormVersion(testDb.db, {
    formId,
    definition: DEFINITION,
    compiled,
    compilerVersion: compiled.compilerVersion,
    a2uiSpecVersion: compiled.a2uiSpecVersion,
    semanticsVersion: "1",
  });

  const piDraft = compileDraft({
    definition: PER_INSTANCE_DEFINITION,
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
  if (!piDraft.ok)
    throw new Error(`per-instance fixture did not publish: ${JSON.stringify(piDraft.error)}`);
  const piCompiled = compileForm(piDraft.value.snapshot, {});

  wideFormId = FormId.parse("frm_repeat_wide");
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: wideFormId,
    slug: "wide-fleet",
    defaultLocale: "en",
  });
  await insertFormVersion(testDb.db, {
    formId: wideFormId,
    definition: WIDE_DEFINITION,
    compiled: wideCompiled,
    compilerVersion: wideCompiled.compilerVersion,
    a2uiSpecVersion: wideCompiled.a2uiSpecVersion,
    semanticsVersion: "1",
  });

  perInstanceFormId = FormId.parse("frm_per_instance");
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: perInstanceFormId,
    slug: "one-vehicle-at-a-time",
    defaultLocale: "en",
  });
  await insertFormVersion(testDb.db, {
    formId: perInstanceFormId,
    definition: PER_INSTANCE_DEFINITION,
    compiled: piCompiled,
    compilerVersion: piCompiled.compilerVersion,
    a2uiSpecVersion: piCompiled.a2uiSpecVersion,
    semanticsVersion: "1",
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

beforeEach(async () => {
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
    environment: DEFAULT_TEST_ENVIRONMENT,
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

async function newWideSession(): Promise<Session> {
  seeded += 1;
  const sessionId = SessionId.parse(`ses_wide_${String(seeded)}`);
  await createSession(testDb.db, {
    environment: DEFAULT_TEST_ENVIRONMENT,
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
    readonly currentStep: string | null;
    readonly visibleQuestions: readonly string[];
    readonly missingRequired: readonly string[];
    readonly readyToSubmit: boolean;
  };
  readonly rosters: readonly { readonly groupId: string; readonly instances: readonly string[] }[];
  readonly view: { readonly groupId: string | null; readonly instanceId: string | null };
  readonly progress: { readonly stepIndex: number; readonly totalVisibleSteps: number };
}

interface RosterBody extends StepBody {
  readonly replayed: boolean;
  readonly minted: readonly string[];
}

interface BatchBody extends StepBody {
  readonly rejected: readonly { readonly questionId: string; readonly code: string }[];
}

async function getStep(session: Session, cursor?: number): Promise<StepBody> {
  const query = cursor === undefined ? "" : `?step=${String(cursor)}`;
  const res = await app.request(`/sessions/${session.sessionId}/step${query}`, {
    headers: headers(session),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as StepBody;
}

async function newPerInstanceSession(): Promise<Session> {
  seeded += 1;
  const sessionId = SessionId.parse(`ses_pi_${String(seeded)}`);
  await createSession(testDb.db, {
    environment: DEFAULT_TEST_ENVIRONMENT,
    sessionId,
    formId: perInstanceFormId,
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
    // `grp_incidents` has `min: 0` and still mints one: ADR-42's minting rule.
    expect(instancesOf(first, "grp_vehicles")).toHaveLength(1);
    expect(instancesOf(first, "grp_incidents")).toHaveLength(1);

    const second = await getStep(session);
    expect(second.rosters).toEqual(first.rosters);
    expect(await rosterLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(2);
  });

  it("mints at most once per group per transaction (task 072's exit criterion)", async () => {
    // `occurred_at` defaults to `now()`, the TRANSACTION's timestamp, so two mint
    // statements in one transaction tie and only `instance_id` orders them.
    const session = await newSession();
    await getStep(session);
    const ledger = await rosterLedger(testDb.db, SessionId.parse(session.sessionId));
    const perGroup = new Map<string, Set<number>>();
    for (const row of ledger) {
      const stamps = perGroup.get(row.groupId) ?? new Set<number>();
      stamps.add(row.occurredAt.getTime());
      perGroup.set(row.groupId, stamps);
    }
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
    expect(body.flowState.missingRequired).toContain(`${vehicle}/q_rep_plate`);
    expect(body.flowState.missingRequired).toContain(`${vehicle}/q_rep_odometer`);
  });

  it("serves the stored RepeatGroup template verbatim (ADR-18)", async () => {
    const session = await newSession();
    const body = await getStep(session);
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
    const ledger = await answerLedger(testDb.db, SessionId.parse(session.sessionId));
    expect(ledger).toHaveLength(4);
    expect(
      ledger.filter((row) => row.questionId === QuestionId.parse("q_rep_plate"))[0]?.instanceId,
    ).toBe(vehicle);
    expect(body.flowState.missingRequired).toEqual([]);
    expect(body.flowState.readyToSubmit).toBe(true);
  });

  it("carries an accepted answer back under its QUALIFIED key", async () => {
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;

    const { body } = await batch(session, [
      { questionId: "q_rep_plate", instanceId: vehicle, value: "ABC123" },
    ]);

    expect(body.values[`${vehicle}/q_rep_plate`]).toBe("ABC123");
    expect(body.flowState.missingRequired).not.toContain(`${vehicle}/q_rep_plate`);
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
    const ledger = await answerLedger(testDb.db, SessionId.parse(session.sessionId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.questionId).toBe(QuestionId.parse("q_rep_odometer"));
  });

  it("refuses an answer naming an instance that is not live (task 072's hand-over)", async () => {
    const session = await newSession();
    const served = await getStep(session);
    const vehicle = instancesOf(served, "grp_vehicles")[0]!;
    // A dead instance contributes no visible cell, so the visibility gate is what
    // refuses the answer.
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
  // `validEnv()` sets no rate-limit overrides, so these cases run against the shipped
  // default of ten answers per five seconds per session.

  async function wholeWideStep(
    session: Session,
  ): Promise<{ questionId: string; instanceId?: string; value: unknown }[]> {
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

    expect(status).toBe(200);
    expect(body.rejected).toEqual([]);
    expect(await answerLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(13);
  });

  it("refuses a batch ABOVE the step's bound, whatever the configured max", async () => {
    const session = await newWideSession();
    await getStep(session);
    const entries = await wholeWideStep(session);
    const instanceId = entries[1]?.instanceId;
    const over = [...entries, { questionId: "q_rep_plate", instanceId, value: "ZZZ999" }];

    const { status } = await batch(session, over);

    expect(status).toBe(429);
    expect(await answerLedger(testDb.db, SessionId.parse(session.sessionId))).toHaveLength(0);
  });

  it("sizes the bound per FORM, so a narrow step gets no wider allowance", async () => {
    // This form's step bound is 7, below the configured max of 10, and the ceiling is the
    // larger of the two.
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
    expect(
      (await roster(session, { op: "add", groupId: "grp_vehicles", opToken: refusedToken })).status,
    ).toBe(409);
    expect(instancesOf(await getStep(session), "grp_vehicles")).toHaveLength(2);
  });

  it("writes no answer at all (the ruling of 2026-09-30)", async () => {
    const session = await newSession();
    await getStep(session);
    await roster(session, { op: "add", groupId: "grp_vehicles", opToken: token() });
    // `formnovalidate` on the Add button is safe only because the post commits nothing.
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
    const ledger = await rosterLedger(testDb.db, SessionId.parse(session.sessionId));
    expect(ledger.filter((row) => row.instanceId === forged)).toEqual([]);
    expect(instancesOf(await getStep(session), "grp_vehicles")).toEqual([mine]);
  });

  it("refuses a removal of an instance another session minted", async () => {
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

    const body = await getStep(session);
    const vehicle = instancesOf(body, "grp_vehicles")[0]!;
    const answered = await batch(session, [
      { questionId: "q_rep_plate", instanceId: vehicle, value: "ABC123" },
    ]);
    expect(answered.status).toBe(200);
  });
});

describe("the response.submitted payload carries instances inside answers and nowhere else", () => {
  async function enqueuedPayload(sessionId: string): Promise<Record<string, unknown>> {
    const res = await testDb.client.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(`select event_type, payload from outbox where payload->>'sessionId' = $1`, [sessionId]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0]!.event_type).toBe("response.submitted");
    return res.rows[0]!.payload;
  }

  async function submitFilledSession(): Promise<{ session: Session; plates: string[] }> {
    const session = await newSession();
    // Serve before the Add: the first serve mints each group's `min`, and an Add ahead
    // of it would race that mint.
    await getStep(session);
    await roster(session, { op: "add", groupId: "grp_vehicles", opToken: token() });
    const served = await getStep(session);
    const vehicles = instancesOf(served, "grp_vehicles");
    const incident = instancesOf(served, "grp_incidents")[0]!;
    expect(vehicles).toHaveLength(2);

    // `maxLength: 8` on `q_rep_plate`.
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
    const platesInPayload = answers
      .filter((entry) => entry.questionId === "q_rep_plate")
      .map((entry) => entry.value);
    expect(platesInPayload).toEqual(plates);
    const instanceIds = new Set(
      answers.filter((entry) => entry.instanceId !== undefined).map((entry) => entry.instanceId),
    );
    expect(instanceIds.size).toBe(3);
    const fleet = answers.find((entry) => entry.questionId === "q_rep_fleet_name")!;
    expect("instanceId" in fleet).toBe(false);
  });

  it("carries no respondent content outside the answers member (the walk)", async () => {
    // Erasure and the retention sweep redact by dropping the `answers` key alone, so
    // respondent content in any sibling member would escape both.
    const { session, plates } = await submitFilledSession();
    const payload = await enqueuedPayload(session.sessionId);

    expect(Object.keys(payload).sort()).toEqual([
      "answers",
      "contentHash",
      "formId",
      "formVersion",
      "sessionId",
      "submittedAt",
    ]);

    const rest = Object.fromEntries(
      Object.entries(payload).filter(([member]) => member !== "answers"),
    );
    const outside = JSON.stringify(rest);
    for (const plate of plates) expect(outside).not.toContain(plate);
    expect(outside).not.toContain("North depot");
    expect(outside).not.toContain("kerbed");
    expect(outside).not.toContain("ins_");
    // An instance count is disclosive on its own (Q19).
    const counts = Object.values(rest).filter((value) => typeof value === "number");
    expect(counts).toEqual([1]); // formVersion, and nothing else numeric
  });
});

describe("the ADR-28 cursor indexes step views (task 076, Q22)", () => {
  it("presents a three-instance group as three views and says three", async () => {
    const session = await newPerInstanceSession();
    const first = await getStep(session);
    const live = instancesOf(first, "grp_pi");
    expect(live).toHaveLength(3);
    expect(first.progress.totalVisibleSteps).toBe(3);
    expect(first.progress.stepIndex).toBe(0);
    expect(first.view).toEqual({ groupId: "grp_pi", instanceId: live[0] });
  });

  it("draws one instance per view, in roster order, and the step's own question on each", async () => {
    const session = await newPerInstanceSession();
    const live = instancesOf(await getStep(session), "grp_pi");
    for (const [index, instanceId] of live.entries()) {
      const body = await getStep(session, index);
      expect(body.progress.stepIndex).toBe(index);
      expect(body.view).toEqual({ groupId: "grp_pi", instanceId });
      expect([...body.flowState.visibleQuestions].sort()).toEqual(
        [`${instanceId}/q_rep_plate`, `${instanceId}/q_rep_notes`, "q_rep_fleet_name"].sort(),
      );
      for (const other of live.filter((candidate) => candidate !== instanceId)) {
        expect(body.flowState.visibleQuestions).not.toContain(`${other}/q_rep_plate`);
      }
    }
  });

  it("clamps a cursor past the last view rather than refusing it", async () => {
    const session = await newPerInstanceSession();
    const live = instancesOf(await getStep(session), "grp_pi");
    const body = await getStep(session, 99);
    expect(body.progress.stepIndex).toBe(2);
    expect(body.view.instanceId).toBe(live[2]);
  });

  it("serves the first view whose instance is incomplete when no cursor is given", async () => {
    const session = await newPerInstanceSession();
    const live = instancesOf(await getStep(session), "grp_pi");
    await batch(session, [{ questionId: "q_rep_fleet_name", value: "Northern depot" }]);

    expect((await getStep(session)).view.instanceId).toBe(live[0]);
    await batch(session, [{ questionId: "q_rep_plate", instanceId: live[0], value: "AAA111" }]);
    expect((await getStep(session)).view.instanceId).toBe(live[1]);
    await batch(session, [{ questionId: "q_rep_plate", instanceId: live[1], value: "BBB222" }]);
    const third = await getStep(session);
    expect(third.view.instanceId).toBe(live[2]);
    expect(third.progress.stepIndex).toBe(2);
    expect(third.flowState.readyToSubmit).toBe(false);

    await batch(session, [{ questionId: "q_rep_plate", instanceId: live[2], value: "CCC333" }]);
    expect((await getStep(session)).flowState.readyToSubmit).toBe(true);
  });

  it("serves the LAST view when the step is current for a reason outside the group", async () => {
    // The last view is the one page carrying the Add control, so a filled open group
    // can still grow.
    const session = await newPerInstanceSession();
    const live = instancesOf(await getStep(session), "grp_pi");
    await batch(
      session,
      live.map((instanceId) => ({ questionId: "q_rep_plate", instanceId, value: "ZZZ999" })),
    );
    const body = await getStep(session);
    expect(body.flowState.currentStep).toBe("stp_pi");
    expect(body.flowState.missingRequired).toEqual(["q_rep_fleet_name"]);
    expect(body.view.instanceId).toBe(live[2]);
    expect(body.progress.stepIndex).toBe(2);
  });

  it("renumbers the views when an Add grows the roster", async () => {
    const session = await newPerInstanceSession();
    const before = await getStep(session);
    expect(before.progress.totalVisibleSteps).toBe(3);
    const added = await roster(session, { op: "add", groupId: "grp_pi", opToken: token() });
    expect(added.status).toBe(200);
    expect(added.body.progress.totalVisibleSteps).toBe(4);
    expect(instancesOf(added.body, "grp_pi")).toHaveLength(4);
    const live = instancesOf(added.body, "grp_pi");
    expect((await getStep(session, 3)).view.instanceId).toBe(live[3]);
    expect((await getStep(session, 0)).view.instanceId).toBe(live[0]);
  });

  it("counts one view per visible step for a form whose groups do not paginate", async () => {
    const session = await newSession();
    const body = await getStep(session);
    expect(body.progress.totalVisibleSteps).toBe(1);
    expect(body.progress.stepIndex).toBe(0);
    expect(body.view).toEqual({ groupId: null, instanceId: null });
    const vehicles = instancesOf(body, "grp_vehicles");
    const incidents = instancesOf(body, "grp_incidents");
    expect(body.flowState.visibleQuestions).toContain(`${vehicles[0]!}/q_rep_plate`);
    expect(body.flowState.visibleQuestions).toContain(`${incidents[0]!}/q_rep_notes`);
  });

  it("sizes the batch allowance over the form's widest step, which a view still fits", async () => {
    const session = await newPerInstanceSession();
    const live = instancesOf(await getStep(session), "grp_pi");
    const fits = await batch(session, [
      { questionId: "q_rep_fleet_name", value: "Northern depot" },
      { questionId: "q_rep_plate", instanceId: live[0], value: "AAA111" },
      { questionId: "q_rep_notes", instanceId: live[0], value: "Serviced" },
    ]);
    expect(fits.status).toBe(200);
    expect(fits.body.rejected).toEqual([]);

    // The bound is 1 + 2 x 4 = 9, so ten entries is above it.
    const over = await batch(
      session,
      Array.from({ length: 10 }, () => ({
        questionId: "q_rep_plate",
        instanceId: live[0],
        value: "AAA111",
      })),
    );
    expect(over.status).toBe(429);
  });
});
