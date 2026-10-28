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
    expect(liveInstances(OPEN, roster(three), answers())).toEqual(three);
    expect(liveInstanceLimit(OPEN, answers())).toBeUndefined();
  });

  it("fixed: the first `count`, however many were minted", () => {
    expect(liveInstances(FIXED, roster(three), answers())).toEqual(three);
    expect(liveInstances({ source: "fixed", count: 2 }, roster(three), answers())).toEqual([
      ins("a"),
      ins("b"),
    ]);
  });

  it("fromAnswer: the first N, N the count answer clamped to min and max", () => {
    const five = [...three, ins("d"), ins("e")];
    expect(liveInstances(FROM_ANSWER, roster(five), countAnswer(2))).toEqual([ins("a"), ins("b")]);
    // A count outside the declared range never sets the size of the loop (SEC-16).
    expect(liveInstances(FROM_ANSWER, roster(five), countAnswer(0))).toEqual([ins("a")]);
    expect(liveInstances(FROM_ANSWER, roster(five), countAnswer(99))).toEqual(five);
  });

  it("fromAnswer: nothing is live until the count question is answered", () => {
    // `min` is deliberately not a floor before an answer exists; it is enforced at
    // submit and as the clamp above.
    expect(liveInstances(FROM_ANSWER, roster(three), answers())).toEqual([]);
    // A wrong-typed count reads as unanswered: publish refuses a non-number count.
    expect(liveInstances(FROM_ANSWER, roster(three), answers({ [howMany]: "two" }))).toEqual([]);
    expect(liveInstances(FROM_ANSWER, roster(three), countAnswer(2.9))).toEqual([
      ins("a"),
      ins("b"),
    ]);
  });

  it("fromAnswer: lowering then raising the count re-lives the SAME instances", () => {
    const minted = roster(three);
    const atTwo = liveInstances(FROM_ANSWER, minted, countAnswer(2));
    expect(atTwo).toEqual([ins("a"), ins("b")]);
    expect(liveInstances(FROM_ANSWER, minted, countAnswer(3))).toEqual(three);
  });

  it("open: a removed instance is gone for good and its place is not reused", () => {
    // `present` drops it; `minted` keeps it, which is what stops a later mint from
    // putting a replacement in its place.
    const afterRemoval = roster([ins("a"), ins("c")], three);
    expect(liveInstances(OPEN, afterRemoval, answers())).toEqual([ins("a"), ins("c")]);
    expect(mintTarget(OPEN, answers())).toBe(1);
    expect(mintTarget(OPEN, answers()) - afterRemoval.minted.length).toBeLessThanOrEqual(0);
  });

  it("holds no instance id twice, even handed a roster that repeats one", () => {
    // The kernel treats the roster as trusted input and raises nothing on a duplicate.
    const repeated = roster([ins("a"), ins("a"), ins("b")]);
    expect(liveInstances(OPEN, repeated, answers())).toEqual([ins("a"), ins("b")]);
    // Deduplication runs before the truncation, so a limit counts distinct instances.
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
    expect(mintTarget(OPEN, answers())).toBe(1);
    expect(mintTarget({ source: "open", min: 2, max: 9 }, answers())).toBe(2);
    expect(mintTarget(FROM_ANSWER, answers())).toBe(0);
    expect(mintTarget(FROM_ANSWER, countAnswer(4))).toBe(4);
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
    // A `fromAnswer` count question always sits outside the group, so it is never
    // instance-qualified in the answer map.
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
