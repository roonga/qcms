import {
  GroupId,
  QuestionId,
  RepeatGroup,
  SessionId,
  FormId,
  answerKey,
  type AnswerMap,
  type FormDefinition,
  type InstanceId,
  type RepeatCount,
} from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  SEED_WORKSPACE_ID,
  appendAnswer,
  createForm,
  createSession,
  insertFormVersion,
  latestAnswers,
  readRoster,
  rosterLedger,
  type Executor,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  DEFAULT_TEST_ENVIRONMENT,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addRosterInstance, mintForServedGroup, removeRosterInstance } from "./roster.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const pax = GroupId.parse("grp_pax");
const passport = QuestionId.parse("q_passport");
const howMany = QuestionId.parse("q_how_many");

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

async function seedSession(id: string): Promise<SessionId> {
  const formId = FormId.parse(`frm_${id}`);
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug: `${id}-slug`,
    defaultLocale: "en",
  });
  const version = await insertFormVersion(testDb.db, {
    formId,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  const sessionId = SessionId.parse(`ses_${id}`);
  await createSession(testDb.db, {
    environment: DEFAULT_TEST_ENVIRONMENT,
    sessionId,
    formId,
    formVersion: version.version,
    accessMode: "anonymous",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return sessionId;
}

function group(count: RepeatCount): RepeatGroup {
  return RepeatGroup.parse({
    groupId: pax,
    label: { en: "Passengers" },
    instanceLabel: { en: "Passenger {n}" },
    items: [{ questionId: passport, version: 1 }],
    count,
  });
}

const noAnswers: AnswerMap = new Map();
const counted = (n: number): AnswerMap => new Map([[howMany, n]]);

async function serve(
  exec: Executor,
  sessionId: SessionId,
  repeatGroup: RepeatGroup,
  answers: AnswerMap = noAnswers,
): Promise<readonly InstanceId[]> {
  return mintForServedGroup(exec, {
    sessionId,
    group: repeatGroup,
    roster: await readRoster(exec, sessionId, repeatGroup.groupId),
    answers,
  });
}

describe("minting on serve", () => {
  it("a fixed group mints its count once, and a second serve mints nothing", async () => {
    const sessionId = await seedSession("mint_fixed");
    const g = group({ source: "fixed", count: 3 });

    const first = await serve(testDb.db, sessionId, g);
    expect(first).toHaveLength(3);

    const second = await serve(testDb.db, sessionId, g);
    expect(second).toEqual(first);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(3);
  });

  it("an open group with min 0 mints one, and each Add mints exactly one more", async () => {
    const sessionId = await seedSession("mint_open");
    const g = group({ source: "open", min: 0, max: 4 });

    const served = await serve(testDb.db, sessionId, g);
    expect(served).toHaveLength(1);

    const added = await addRosterInstance(testDb.db, {
      sessionId,
      group: g,
      roster: await readRoster(testDb.db, sessionId, pax),
      answers: noAnswers,
    });
    expect(added.ok).toBe(true);

    const live = await serve(testDb.db, sessionId, g);
    expect(live).toHaveLength(2);
    expect(live[0]).toBe(served[0]);
  });

  it("an open group with min 2 mints two on first serve", async () => {
    const sessionId = await seedSession("mint_open_min");
    expect(
      await serve(testDb.db, sessionId, group({ source: "open", min: 2, max: 4 })),
    ).toHaveLength(2);
  });

  it("a fromAnswer group mints nothing until the count is answered, then the difference", async () => {
    const sessionId = await seedSession("mint_from_answer");
    const g = group({ source: "fromAnswer", questionId: howMany, min: 1, max: 5 });

    expect(await serve(testDb.db, sessionId, g)).toEqual([]);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(0);

    const atTwo = await serve(testDb.db, sessionId, g, counted(2));
    expect(atTwo).toHaveLength(2);

    const atFour = await serve(testDb.db, sessionId, g, counted(4));
    expect(atFour).toHaveLength(4);
    expect(atFour.slice(0, 2)).toEqual(atTwo);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(4);
  });
});

describe("the two asymmetric behaviours ADR-42 turns on", () => {
  it("lowering a fromAnswer count hides the trailing instance; raising restores it with its answers", async () => {
    const sessionId = await seedSession("count_restore");
    const g = group({ source: "fromAnswer", questionId: howMany, min: 1, max: 5 });

    const three = await serve(testDb.db, sessionId, g, counted(3));
    expect(three).toHaveLength(3);
    const trailing = three[2]!;
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: passport,
      instanceId: trailing,
      value: "P-THIRD",
    });

    const lowered = await serve(testDb.db, sessionId, g, counted(2));
    expect(lowered).toEqual(three.slice(0, 2));
    const ledger = await rosterLedger(testDb.db, sessionId);
    expect(ledger).toHaveLength(3);
    expect(ledger.every((row) => row.event === "added")).toBe(true);

    const restored = await serve(testDb.db, sessionId, g, counted(3));
    expect(restored).toEqual(three);
    expect(restored[2]).toBe(trailing);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(3);
    const answers = await latestAnswers(testDb.db, sessionId);
    expect(answers.get(answerKey(passport, trailing))).toBe("P-THIRD");
  });

  it("a removed open instance is never restored, and no replacement is minted into its place", async () => {
    const sessionId = await seedSession("removal_final");
    const g = group({ source: "open", min: 0, max: 4 });

    const first = await serve(testDb.db, sessionId, g);
    const only = first[0]!;
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: passport,
      instanceId: only,
      value: "P-GONE",
    });

    await removeRosterInstance(testDb.db, { sessionId, groupId: pax, instanceId: only });
    expect(await serve(testDb.db, sessionId, g)).toEqual([]);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(2);

    const added = await addRosterInstance(testDb.db, {
      sessionId,
      group: g,
      roster: await readRoster(testDb.db, sessionId, pax),
      answers: noAnswers,
    });
    expect(added.ok).toBe(true);
    const live = await serve(testDb.db, sessionId, g);
    expect(live).toHaveLength(1);
    expect(live[0]).not.toBe(only);

    const answers = await latestAnswers(testDb.db, sessionId);
    expect(answers.get(answerKey(passport, only))).toBe("P-GONE");
    expect(answers.get(answerKey(passport, live[0]))).toBeUndefined();
  });
});

describe("the roster write refusals (SEC-16)", () => {
  it("refuses an Add that would take the group past its max", async () => {
    const sessionId = await seedSession("add_max");
    const g = group({ source: "open", min: 2, max: 2 });
    expect(await serve(testDb.db, sessionId, g)).toHaveLength(2);

    const refused = await addRosterInstance(testDb.db, {
      sessionId,
      group: g,
      roster: await readRoster(testDb.db, sessionId, pax),
      answers: noAnswers,
    });
    expect(refused).toEqual({ ok: false, code: "REPEAT_MAX_REACHED" });
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(2);

    // The bound is against the live count, so a removal frees a place.
    const live = await readRoster(testDb.db, sessionId, pax);
    await removeRosterInstance(testDb.db, {
      sessionId,
      groupId: pax,
      instanceId: live.present[0]!,
    });
    const accepted = await addRosterInstance(testDb.db, {
      sessionId,
      group: g,
      roster: await readRoster(testDb.db, sessionId, pax),
      answers: noAnswers,
    });
    expect(accepted.ok).toBe(true);
  });

  it("refuses an Add on a group whose size is not the respondent's to change", async () => {
    const sessionId = await seedSession("add_not_open");
    for (const count of [
      { source: "fixed", count: 2 } as const,
      { source: "fromAnswer", questionId: howMany, min: 1, max: 5 } as const,
    ]) {
      const g = group(count);
      const refused = await addRosterInstance(testDb.db, {
        sessionId,
        group: g,
        roster: undefined,
        answers: counted(2),
      });
      expect(refused).toEqual({ ok: false, code: "REPEAT_NOT_ADDABLE" });
    }
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(0);
  });
});
