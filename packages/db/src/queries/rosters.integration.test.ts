import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import { answerKey, FormId, GroupId, InstanceId, QuestionId, SessionId } from "@roonga/qcms-core";
import type { FormDefinition } from "@roonga/qcms-core";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../testing/harness.js";
import {
  addInstances,
  appendAnswer,
  answerLedger,
  createForm,
  createSession,
  insertFormVersion,
  latestAnswers,
  readRoster,
  readRosters,
  removeInstance,
  retractAnswer,
  rosterLedger,
  sweepExpiredSessions,
  purgeExpired,
} from "./index.js";

/**
 * The instance ledger against a real Postgres (task 072, ADR-42). Acceptance cases
 * 22 and 25 of `plan/repeating-groups-and-table-input.md` section 11 live here;
 * case 23 is in `../schema/append-only.test.ts`, case 24 in
 * `./erasure.integration.test.ts` and case 26 in `../migrations.test.ts`.
 *
 * Real Postgres rather than a fake, because everything asserted below is a
 * property of SQL: whether `DISTINCT ON` treats two NULL instance ids as the same
 * cell, whether a delete reaches a second table through one door, and whether the
 * roster comes back in the order the rows were written.
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

async function seedSession(
  id: string,
  expiresAt = new Date(Date.now() + 86_400_000),
): Promise<SessionId> {
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
    expiresAt,
  });
  return sessionId;
}

const pax = GroupId.parse("grp_pax");
const ins = (n: string): InstanceId => InstanceId.parse(`ins_${n}`);

async function rowCount(table: string, sessionId: SessionId): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from ${table} where session_id = $1`,
    [sessionId],
  );
  return res.rows[0]?.n ?? 0;
}

describe("the answer ledger keyed by instance (acceptance case 22)", () => {
  it("keeps one current value per (question, instance) and one per bare question", async () => {
    const sessionId = await seedSession("cell_grain");
    const passport = QuestionId.parse("q_passport");
    const meal = QuestionId.parse("q_meal");
    const one = ins("one");
    const two = ins("two");
    const t0 = Date.now();

    // The same question answered in two instances. Before migration 0022 the
    // DISTINCT ON would have kept exactly one of these two rows, silently - the same
    // class of collision ADR-42 names in the reporting view's `jsonb_object_agg`.
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: passport,
      instanceId: one,
      value: "P1-first",
      answeredAt: new Date(t0),
    });
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: passport,
      instanceId: two,
      value: "P2",
      answeredAt: new Date(t0 + 1000),
    });
    // A revision of the first cell, which must beat its own earlier row and no other.
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: passport,
      instanceId: one,
      value: "P1-corrected",
      answeredAt: new Date(t0 + 2000),
    });
    // A question outside every group: unqualified, exactly as before ADR-42.
    await appendAnswer(testDb.db, {
      sessionId,
      questionId: meal,
      value: "vegetarian",
      answeredAt: new Date(t0 + 3000),
    });

    const latest = await latestAnswers(testDb.db, sessionId);
    expect(latest.size).toBe(3);
    expect(latest.get(answerKey(passport, one))).toBe("P1-corrected");
    expect(latest.get(answerKey(passport, two))).toBe("P2");
    // The bare `questionId` key is the same key it has always been, which is what
    // lets every existing caller read an unrepeated question unchanged.
    expect(latest.get(meal)).toBe("vegetarian");
    expect(latest.get(passport)).toBeUndefined();

    // All four rows persist: the ledger is append-only and the revision above added
    // a row rather than replacing one.
    const ledger = await answerLedger(testDb.db, sessionId);
    expect(ledger).toHaveLength(4);
    expect(ledger.map((row) => [row.questionId, row.instanceId, row.value])).toEqual([
      [passport, one, "P1-first"],
      [passport, two, "P2"],
      [passport, one, "P1-corrected"],
      [meal, null, "vegetarian"],
    ]);
  });

  it("retracts one cell and leaves the other instances of the same question answered", async () => {
    const sessionId = await seedSession("cell_retract");
    const passport = QuestionId.parse("q_passport");
    const t0 = Date.now();
    for (const [index, instance] of [ins("a"), ins("b"), ins("c")].entries()) {
      await appendAnswer(testDb.db, {
        sessionId,
        questionId: passport,
        instanceId: instance,
        value: `P-${instance}`,
        answeredAt: new Date(t0 + index),
      });
    }

    // ADR-33's Note: a retraction is per instance and clears that cell alone.
    await retractAnswer(testDb.db, {
      sessionId,
      questionId: passport,
      instanceId: ins("b"),
      answeredAt: new Date(t0 + 100),
    });

    const latest = await latestAnswers(testDb.db, sessionId);
    expect(latest.get(answerKey(passport, ins("a")))).toBe("P-ins_a");
    expect(latest.get(answerKey(passport, ins("b")))).toBeUndefined();
    expect(latest.get(answerKey(passport, ins("c")))).toBe("P-ins_c");
    // The tombstone is in the ledger, which is the whole point of the append.
    expect(await answerLedger(testDb.db, sessionId)).toHaveLength(4);
  });
});

describe("the roster read", () => {
  it("returns the minted list in first-added order and the present list without the removed", async () => {
    const sessionId = await seedSession("roster_order");
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    // Three separate mints so the order is the write order rather than the
    // tiebreaker's, which is the ordinary case: an `open` group's Add per press.
    await addInstances(testDb.db, {
      sessionId,
      groupId: pax,
      instanceIds: [ins("zzz")],
      occurredAt: t0,
    });
    await addInstances(testDb.db, {
      sessionId,
      groupId: pax,
      instanceIds: [ins("mmm")],
      occurredAt: new Date(t0.getTime() + 1000),
    });
    await addInstances(testDb.db, {
      sessionId,
      groupId: pax,
      instanceIds: [ins("aaa")],
      occurredAt: new Date(t0.getTime() + 2000),
    });

    const before = await readRoster(testDb.db, sessionId, pax);
    // Insertion order, not id order: `zzz` was minted first and is first.
    expect(before.minted).toEqual([ins("zzz"), ins("mmm"), ins("aaa")]);
    expect(before.present).toEqual([ins("zzz"), ins("mmm"), ins("aaa")]);

    await removeInstance(testDb.db, {
      sessionId,
      groupId: pax,
      instanceId: ins("mmm"),
      occurredAt: new Date(t0.getTime() + 3000),
    });

    const after = await readRoster(testDb.db, sessionId, pax);
    // Removal is an append: the instance stays minted for good and leaves `present`.
    expect(after.minted).toEqual([ins("zzz"), ins("mmm"), ins("aaa")]);
    expect(after.present).toEqual([ins("zzz"), ins("aaa")]);
    expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(4);
  });

  it("orders a batch mint by instance id, deterministically across reads", async () => {
    const sessionId = await seedSession("roster_batch");
    // One call, one statement, one timestamp: `occurred_at` cannot order these, so
    // `instance_id` is the tiebreaker and the order is total and repeatable. A
    // `fromAnswer` count lowered and raised again depends on exactly this.
    await addInstances(testDb.db, {
      sessionId,
      groupId: pax,
      instanceIds: [ins("c"), ins("a"), ins("b")],
    });
    const first = await readRoster(testDb.db, sessionId, pax);
    const second = await readRoster(testDb.db, sessionId, pax);
    expect(first.minted).toEqual([ins("a"), ins("b"), ins("c")]);
    expect(second.minted).toEqual(first.minted);
  });

  it("holds an instance id once even when the table carries a repeated added row", async () => {
    const sessionId = await seedSession("roster_dupe");
    await addInstances(testDb.db, { sessionId, groupId: pax, instanceIds: [ins("solo")] });
    // Forced through raw SQL, because the query helper refuses a batch that repeats
    // an id and no code path in the API writes one. The guarantee under test is the
    // read's, and it has to hold whatever the table holds: the evaluator treats the
    // roster as trusted input, so one id twice becomes duplicate `visible` entries,
    // a duplicated instance in the locked submission, and no error anywhere.
    await testDb.client.query(
      `insert into answer_group_instances (session_id, group_id, instance_id, event)
         values ($1, $2, 'ins_solo', 'added')`,
      [sessionId, pax],
    );
    const roster = await readRoster(testDb.db, sessionId, pax);
    expect(roster.minted).toEqual([ins("solo")]);
    expect(roster.present).toEqual([ins("solo")]);
    // And the whole-session read agrees, since it is a separate derivation.
    expect((await readRosters(testDb.db, sessionId)).get(pax)?.present).toEqual([ins("solo")]);
  });

  it("refuses a mint that repeats an id within one call", async () => {
    const sessionId = await seedSession("roster_dupe_batch");
    await expect(
      addInstances(testDb.db, {
        sessionId,
        groupId: pax,
        instanceIds: [ins("x"), ins("x")],
      }),
    ).rejects.toThrow(/may not repeat an instance id/i);
    expect(await rowCount("answer_group_instances", sessionId)).toBe(0);
  });

  it("separates groups and returns nothing for a session with no roster", async () => {
    const sessionId = await seedSession("roster_groups");
    const bags = GroupId.parse("grp_bags");
    await addInstances(testDb.db, { sessionId, groupId: pax, instanceIds: [ins("p1")] });
    await addInstances(testDb.db, { sessionId, groupId: bags, instanceIds: [ins("b1"), ins("b2")] });

    const rosters = await readRosters(testDb.db, sessionId);
    expect(rosters.get(pax)?.present).toEqual([ins("p1")]);
    expect(rosters.get(bags)?.present).toEqual([ins("b1"), ins("b2")]);
    expect(rosters.get(GroupId.parse("grp_none"))).toBeUndefined();

    const bare = await seedSession("roster_empty");
    expect((await readRosters(testDb.db, bare)).size).toBe(0);
    expect(await readRoster(testDb.db, bare, pax)).toEqual({ minted: [], present: [] });
  });
});

describe("purgeExpired reaches the roster table (acceptance case 25)", () => {
  it("removes the roster rows of a purged session, by count", async () => {
    const horizon = new Date("2026-05-10T00:00:00.000Z");
    const purgeable = await seedSession("purge_roster", new Date("2026-05-01T00:00:00.000Z"));
    await appendAnswer(testDb.db, {
      sessionId: purgeable,
      questionId: QuestionId.parse("q_name"),
      instanceId: ins("p1"),
      value: "wip",
    });
    await addInstances(testDb.db, {
      sessionId: purgeable,
      groupId: pax,
      instanceIds: [ins("p1"), ins("p2")],
    });
    await removeInstance(testDb.db, { sessionId: purgeable, groupId: pax, instanceId: ins("p2") });

    // A session the horizon spares - expired, but exactly at the horizon, which the
    // strictly-before boundary retains - so the assertion below is about the purge's
    // scope and not about the table being empty.
    const spared = await seedSession("purge_roster_spared", horizon);
    await addInstances(testDb.db, { sessionId: spared, groupId: pax, instanceIds: [ins("s1")] });

    await sweepExpiredSessions(testDb.db, new Date("2026-05-11T00:00:00.000Z"));
    expect(await rowCount("answer_group_instances", purgeable)).toBe(3);

    const result = await purgeExpired(testDb.db, horizon);
    expect(result.purgedSessionIds).toContain(purgeable);

    // By count against a real Postgres, not by reading the helper: the purge's table
    // list is hand-kept, so a missing entry here is silent respondent data kept past
    // the retention horizon.
    expect(await rowCount("answers", purgeable)).toBe(0);
    expect(await rowCount("answer_group_instances", purgeable)).toBe(0);
    expect(await rowCount("sessions", purgeable)).toBe(0);
    expect(await rowCount("answer_group_instances", spared)).toBe(1);
  });
});
