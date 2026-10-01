/**
 * The live-roster derivation, as a pure function (task 072, ADR-42).
 *
 * The third exit criterion of the work order is that the derivation is tested per
 * count source, including that lowering and raising a `fromAnswer` count restores
 * the **same** instance id and that a removed `open` instance is never restored.
 * Those two are proved end to end against a real Postgres in
 * `roster.integration.test.ts`; what is proved here is the function they rest on,
 * where every input can be stated directly and the asymmetry between the sources
 * is visible in one file.
 */

import {
  answerKey,
  GroupId,
  InstanceId,
  QuestionId,
  RepeatGroup,
  StepId,
  type AnswerMap,
  type AnswerValue,
  type RepeatCount,
  type Step,
} from "@roonga/qcms-core";
import type { GroupRoster } from "@roonga/qcms-db";
import { describe, expect, it } from "vitest";

import {
  deriveRosters,
  liveInstanceLimit,
  liveInstances,
  mintTarget,
  newInstanceId,
} from "./roster.js";

const pax = GroupId.parse("grp_pax");
const bags = GroupId.parse("grp_bags");
const howMany = QuestionId.parse("q_how_many");
const passport = QuestionId.parse("q_passport");

const ins = (n: string): InstanceId => InstanceId.parse(`ins_${n}`);
const roster = (present: readonly InstanceId[], minted = present): GroupRoster => ({
  minted,
  present,
});
const answers = (entries: Record<string, AnswerValue> = {}): AnswerMap =>
  new Map(Object.entries(entries)) as unknown as AnswerMap;
const countAnswer = (n: number): AnswerMap => new Map([[howMany, n]]);

const OPEN: RepeatCount = { source: "open", min: 0, max: 9 };
const FIXED: RepeatCount = { source: "fixed", count: 3 };
const FROM_ANSWER: RepeatCount = { source: "fromAnswer", questionId: howMany, min: 1, max: 5 };

const three = [ins("a"), ins("b"), ins("c")];

function group(groupId: GroupId, count: RepeatCount): RepeatGroup {
  return RepeatGroup.parse({
    groupId,
    label: { en: "Passengers" },
    instanceLabel: { en: "Passenger {n}" },
    items: [{ questionId: passport, version: 1 }],
    count,
  });
}

function stepsWith(...groups: readonly RepeatGroup[]): Step[] {
  return [
    {
      stepId: StepId.parse("stp_pax"),
      title: { en: "Passengers" },
      items: [...groups],
    } as Step,
  ];
}

describe("liveInstances, per count source", () => {
  it("open: the event record itself, whatever its length", () => {
    // Nobody shortens an `open` group: removal is an explicit `removed` row, which
    // `present` already reflects. Truncating here would hide an instance the
    // respondent can see, which is the opposite of what removal means for it.
    expect(liveInstances(OPEN, roster(three), answers())).toEqual(three);
    expect(liveInstanceLimit(OPEN, answers())).toBeUndefined();
  });

  it("fixed: the first `count`, however many were minted", () => {
    expect(liveInstances(FIXED, roster(three), answers())).toEqual(three);
    // A `fixed` group whose count is below what the table holds - a form version
    // that once declared more - is truncated by the derivation rather than repaired
    // by a write. Nothing is deleted; the trailing instance is simply not live.
    expect(liveInstances({ source: "fixed", count: 2 }, roster(three), answers())).toEqual([
      ins("a"),
      ins("b"),
    ]);
  });

  it("fromAnswer: the first N, N the count answer clamped to min and max", () => {
    const five = [...three, ins("d"), ins("e")];
    expect(liveInstances(FROM_ANSWER, roster(five), countAnswer(2))).toEqual([ins("a"), ins("b")]);
    // Clamped up to `min` and down to `max`, so a count answer outside the declared
    // range never sets the size of the loop (SEC-16).
    expect(liveInstances(FROM_ANSWER, roster(five), countAnswer(0))).toEqual([ins("a")]);
    expect(liveInstances(FROM_ANSWER, roster(five), countAnswer(99))).toEqual(five);
  });

  it("fromAnswer: nothing is live until the count question is answered", () => {
    // The count is not known at session start, so the group mints nothing and holds
    // nothing. `min` is not read in as a floor here: that would make a group live
    // before the respondent had said how big it is. It is enforced at submit
    // (`REPEAT_COUNT_OUT_OF_RANGE`) and as the clamp above once an answer exists.
    expect(liveInstances(FROM_ANSWER, roster(three), answers())).toEqual([]);
    // A count answer of the wrong type is treated as unanswered rather than as an
    // error: publish already refuses a count question that is not a `number`.
    expect(liveInstances(FROM_ANSWER, roster(three), answers({ [howMany]: "two" }))).toEqual([]);
    // A fractional answer floors rather than rounds: three and a half passengers is
    // three passengers, and the half is not a card.
    expect(liveInstances(FROM_ANSWER, roster(three), countAnswer(2.9))).toEqual([
      ins("a"),
      ins("b"),
    ]);
  });

  it("fromAnswer: lowering then raising the count re-lives the SAME instances", () => {
    const minted = roster(three);
    const atTwo = liveInstances(FROM_ANSWER, minted, countAnswer(2));
    expect(atTwo).toEqual([ins("a"), ins("b")]);
    // No `removed` row was written, so nothing about the roster changed: raising the
    // count back produces the same three ids, which is what makes the third
    // instance's answers come back with it (ADR-42, Q5 ruled 2026-09-29).
    expect(liveInstances(FROM_ANSWER, minted, countAnswer(3))).toEqual(three);
  });

  it("open: a removed instance is gone for good and its place is not reused", () => {
    // `present` drops it; `minted` keeps it, which is what stops a later mint from
    // minting a replacement into its place.
    const afterRemoval = roster([ins("a"), ins("c")], three);
    expect(liveInstances(OPEN, afterRemoval, answers())).toEqual([ins("a"), ins("c")]);
    expect(mintTarget(OPEN, answers())).toBe(1);
    // The target is measured against `minted`, which is 3, so nothing is minted.
    expect(mintTarget(OPEN, answers()) - afterRemoval.minted.length).toBeLessThanOrEqual(0);
  });

  it("holds no instance id twice, even handed a roster that repeats one", () => {
    // The kernel treats the roster as a trusted input: given an id twice it yields
    // duplicate `visible` entries, duplicate `missingRequired` entries and a
    // duplicated instance in the locked submission, with no error raised anywhere.
    // This is the seam where a `RosterMap` is built, so it is where the guarantee is
    // asserted - `readRosters` holds it by construction as well.
    const repeated = roster([ins("a"), ins("a"), ins("b")]);
    expect(liveInstances(OPEN, repeated, answers())).toEqual([ins("a"), ins("b")]);
    // Deduplication runs BEFORE the truncation, so a limit counts distinct instances
    // rather than rows: two of these three rows are the same instance, so a fixed
    // count of 2 is `a` and `b` and not `a` alone.
    expect(liveInstances({ source: "fixed", count: 2 }, repeated, answers())).toEqual([
      ins("a"),
      ins("b"),
    ]);
  });

  it("is empty for a group with no roster row at all", () => {
    expect(liveInstances(OPEN, undefined, answers())).toEqual([]);
    expect(liveInstances(FIXED, undefined, answers())).toEqual([]);
    expect(liveInstances(FROM_ANSWER, undefined, countAnswer(3))).toEqual([]);
  });
});

describe("mintTarget, the minting moment per source", () => {
  it("fixed mints its count, open mints min (or one), fromAnswer mints the answer", () => {
    expect(mintTarget(FIXED, answers())).toBe(3);
    // `min` 0 still mints one, so the respondent sees a card to fill rather than an
    // empty group with a button.
    expect(mintTarget(OPEN, answers())).toBe(1);
    expect(mintTarget({ source: "open", min: 2, max: 9 }, answers())).toBe(2);
    // Nothing at session start: a `fromAnswer` group's count is not known then.
    expect(mintTarget(FROM_ANSWER, answers())).toBe(0);
    expect(mintTarget(FROM_ANSWER, countAnswer(4))).toBe(4);
    // The target is clamped exactly as liveness is, so the two can never disagree
    // about how many instances a group should hold.
    expect(mintTarget(FROM_ANSWER, countAnswer(99))).toBe(5);
  });
});

describe("deriveRosters", () => {
  it("gives every declared group an entry, each truncated and ordered", () => {
    const steps = stepsWith(group(pax, FROM_ANSWER), group(bags, OPEN));
    const stored = new Map<GroupId, GroupRoster>([
      [pax, roster(three)],
      [bags, roster([ins("x")], [ins("x"), ins("y")])],
    ]);

    const derived = deriveRosters(steps, stored, countAnswer(2));
    expect(derived.get(pax)).toEqual([ins("a"), ins("b")]);
    expect(derived.get(bags)).toEqual([ins("x")]);
    expect(derived.size).toBe(2);
  });

  it("gives a group with no stored roster an empty entry rather than no entry", () => {
    const derived = deriveRosters(stepsWith(group(pax, OPEN)), new Map(), answers());
    expect(derived.has(pax)).toBe(true);
    expect(derived.get(pax)).toEqual([]);
  });

  it("returns an empty map for a form with no repeating group", () => {
    const plain: Step[] = [
      {
        stepId: StepId.parse("stp_plain"),
        title: { en: "Plain" },
        items: [{ questionId: passport, version: 1 }],
      } as Step,
    ];
    expect(deriveRosters(plain, new Map(), answers()).size).toBe(0);
  });

  it("reads the count answer by its bare question id", () => {
    // A `fromAnswer` count question is pinned outside every group - publish refuses
    // one that does not precede the group's whole span, and a group may not contain a
    // group - so it is never instance-qualified in the answer map.
    const steps = stepsWith(group(pax, FROM_ANSWER));
    const qualified = new Map([[answerKey(howMany, ins("a")), 3]]) as AnswerMap;
    expect(deriveRosters(steps, new Map([[pax, roster(three)]]), qualified).get(pax)).toEqual([]);
  });
});

describe("newInstanceId", () => {
  it("mints a parseable, branded, unique id carrying no respondent content", () => {
    const minted = Array.from({ length: 64 }, () => newInstanceId());
    for (const id of minted) {
      expect(InstanceId.safeParse(id).success).toBe(true);
      expect(id.startsWith("ins_")).toBe(true);
    }
    expect(new Set(minted).size).toBe(minted.length);
  });
});
