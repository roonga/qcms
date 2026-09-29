/**
 * The minting moments and the live roster, against the real ledger (task 072,
 * ADR-42). Requires Docker.
 *
 * `roster.test.ts` proves the derivation as a function over stated inputs. This
 * file proves the two behaviours that are only true of the pair - the derivation
 * and the append-only table underneath it - and that ADR-42 states as the
 * asymmetry the whole design turns on:
 *
 * - **Lowering a `fromAnswer` count and raising it again restores the SAME
 *   instance id with its answers intact**, because nothing was removed.
 * - **A removed `open` instance is gone for good**, and a later serve mints no
 *   replacement into its place.
 *
 * Neither can be shown against a fake: the first depends on the mint being
 * idempotent against rows already written, and the second on the roster read
 * returning an instance to `minted` and not to `present`.
 */

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
  appendAnswer,
  createForm,
  createSession,
  insertFormVersion,
  latestAnswers,
  readRoster,
  rosterLedger,
  type Executor,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
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
  await createForm(testDb.db, { formId, slug: `${id}-slug`, defaultLocale: "en" });
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

/** Serve the group's step once: read the roster, mint the shortfall, return live. */
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

    // Idempotent under replay: the rows are already there, and there is no "have we
    // served this before" flag anywhere - which is what makes the property hold
    // across a reload, a resumed session and a retried request alike.
    const second = await serve(testDb.db, sessionId, g);
    expect(second).toEqual(first);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(3);
  });

  it("an open group with min 0 mints one, and each Add mints exactly one more", async () => {
    const sessionId = await seedSession("mint_open");
    const g = group({ source: "open", min: 0, max: 4 });

    // One card to fill rather than an empty group with a button.
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

    // Nothing at session start: the count is not known then.
    expect(await serve(testDb.db, sessionId, g)).toEqual([]);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(0);

    const atTwo = await serve(testDb.db, sessionId, g, counted(2));
    expect(atTwo).toHaveLength(2);

    // A raise mints the DIFFERENCE, not a fresh set: the first two ids are the same
    // two, so their answers are still theirs.
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

    // Lower the count. The trailing instance stops being live and NO `removed` row is
    // written, which is the whole mechanism: the derivation shortened the list, not
    // the table.
    const lowered = await serve(testDb.db, sessionId, g, counted(2));
    expect(lowered).toEqual(three.slice(0, 2));
    const ledger = await rosterLedger(testDb.db, sessionId);
    expect(ledger).toHaveLength(3);
    expect(ledger.every((row) => row.event === "added")).toBe(true);

    // Raise it again: the SAME id comes back, and its answer never left the ledger.
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
    // The group is empty and STAYS empty on the next serve. The minting target is
    // measured against rows ever minted, so serving does not quietly undo the
    // respondent's removal by minting a replacement.
    expect(await serve(testDb.db, sessionId, g)).toEqual([]);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(2);

    // An Add after the removal is a NEW instance with no answers, not the old one
    // back (Q5, ruled 2026-09-29).
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

    // And the removed instance's answer is still in the ledger, excluded rather than
    // deleted: I6's semantic, which is the one ADR-42 reuses.
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
    // Refused means nothing was written, not written and then hidden.
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(2);

    // A removal frees the place: the bound is against the live count, so a group
    // that had been filled and emptied is not permanently unable to grow.
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
