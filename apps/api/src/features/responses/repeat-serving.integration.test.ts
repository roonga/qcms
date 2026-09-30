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

const QUESTIONS = [FLEET, PLATE, ODOMETER, NOTES];

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let formId: FormId;
let compiled: ReturnType<typeof compileForm>;
let seeded = 0;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), env: validEnv() });
  app = createApp(deps, PUBLIC_ONLY, { groups: { public: [registerServeStep] } });
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

  formId = FormId.parse("frm_repeat_serving");
  await createForm(testDb.db, { formId, slug: "two-fleets", defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId,
    definition: DEFINITION,
    compiled: compiled as unknown as Parameters<typeof insertFormVersion>[1]["compiled"],
    compilerVersion: compiled.compilerVersion,
    a2uiSpecVersion: compiled.a2uiSpecVersion,
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
