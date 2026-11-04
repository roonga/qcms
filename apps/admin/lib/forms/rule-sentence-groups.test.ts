import { describe, expect, it } from "vitest";

import type { ReadState } from "../read-state.ts";

import { ruleSentence } from "./rule-sentence.ts";
import { ruleScope, scopeChipLabel, targetGroups } from "./rule-targets.ts";
import type { DraftCondition, DraftForm, DraftRule, PinnableQuestion } from "./types.ts";

const PASSPORT = {
  questionId: "q_passport",
  type: "shortText" as const,
  label: { en: "Passport number" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_passport",
    slug: "passport",
    label: { en: "Passport number" },
    type: "shortText",
    versions: [{ version: 1, status: "published", definition: PASSPORT }],
  },
  {
    questionId: "q_declaration",
    slug: "declaration",
    label: { en: "Infant travel declaration" },
    type: "boolean",
    versions: [
      {
        version: 1,
        status: "published",
        definition: {
          questionId: "q_declaration",
          type: "boolean",
          label: { en: "Infant travel declaration" },
        },
      },
    ],
  },
  {
    questionId: "q_fare_basis",
    slug: "fare-basis",
    label: { en: "Infant fare basis" },
    type: "shortText",
    versions: [
      {
        version: 1,
        status: "published",
        definition: {
          questionId: "q_fare_basis",
          type: "shortText",
          label: { en: "Infant fare basis" },
        },
      },
    ],
  },
];

const READ: ReadState<readonly PinnableQuestion[]> = { ok: true, data: LIBRARY };

const DRAFT: DraftForm = {
  formId: "frm_booking",
  defaultLocale: "en",
  title: { en: "Booking" },
  steps: [
    {
      stepId: "stp_travellers",
      title: { en: "Travellers" },
      items: [
        {
          groupId: "grp_passengers",
          label: { en: "Passengers" },
          instanceLabel: { en: "Passenger {n}" },
          items: [
            { questionId: "q_passport", version: 1 },
            { questionId: "q_fare_basis", version: 1 },
          ],
          count: { source: "open", min: 1, max: 9 },
          presentation: "stacked",
        },
      ],
    },
    {
      stepId: "stp_declaration",
      title: { en: "Declaration" },
      items: [{ questionId: "q_declaration", version: 1 }],
    },
  ],
  rules: [],
};

const HOLDS_PASSPORT: DraftCondition = { op: "answered", questionId: "q_passport" };

function rule(when: DraftCondition, show: readonly string[] = ["q_declaration"]): DraftRule {
  return { ruleId: "rul_one", when, show };
}

function read(when: DraftCondition, show?: readonly string[]): string {
  return ruleSentence(rule(when, show), READ, DRAFT)
    .map((segment) => segment.text)
    .join("");
}

describe("whole-group operators in the sentence", () => {
  it("reads `anyInstance` as at least one of them", () => {
    expect(read({ op: "anyInstance", groupId: "grp_passengers", condition: HOLDS_PASSPORT })).toBe(
      "When at least one Passenger where Passport number is answered, show Infant travel declaration",
    );
  });

  it("states `everyInstance`'s empty-group reading in the sentence itself", () => {
    const sentence = read({
      op: "everyInstance",
      groupId: "grp_passengers",
      condition: HOLDS_PASSPORT,
    });

    expect(sentence).toContain("every Passenger where Passport number is answered");
    expect(sentence).toContain("and there is at least one Passenger");
  });

  it("states the NEGATION's reading too, which is the trap the ruling opens", () => {
    const sentence = read({
      op: "not",
      condition: {
        op: "everyInstance",
        groupId: "grp_passengers",
        condition: HOLDS_PASSPORT,
      },
    });

    expect(sentence).toContain("not every Passenger");
    expect(sentence).toContain("which includes there being no Passenger at all");
  });

  it("does not render the negation as a bare `not (...)` of the plain reading", () => {
    const negated = read({
      op: "not",
      condition: {
        op: "everyInstance",
        groupId: "grp_passengers",
        condition: HOLDS_PASSPORT,
      },
    });
    const plainInsideNot = `not (${read({
      op: "everyInstance",
      groupId: "grp_passengers",
      condition: HOLDS_PASSPORT,
    })
      .replace("When ", "")
      .replace(", show Infant travel declaration", "")})`;

    expect(negated).not.toContain(plainInsideNot);
  });

  it("reads `instanceCount` as a count, in the ordering operators' own vocabulary", () => {
    expect(
      read({ op: "instanceCount", groupId: "grp_passengers", compare: "gte", value: 5 }),
    ).toContain("the number of Passengers is at least 5");
    expect(
      read({ op: "instanceCount", groupId: "grp_passengers", compare: "equals", value: 1 }),
    ).toContain("the number of Passengers is exactly 1");
  });

  it("brackets a nested list under a group read, which is not self-delimiting", () => {
    const sentence = read({
      op: "anyInstance",
      groupId: "grp_passengers",
      condition: {
        op: "and",
        conditions: [HOLDS_PASSPORT, { op: "answered", questionId: "q_fare_basis" }],
      },
    });

    expect(sentence).toContain("at least one Passenger where (");
  });

  it("emphasises a group's name as a name, and renders an undeclared one as the raw id", () => {
    const segments = ruleSentence(
      rule({ op: "instanceCount", groupId: "grp_passengers", compare: "gt", value: 0 }),
      READ,
      DRAFT,
    );
    expect(segments.filter((s) => s.kind === "group").map((s) => s.text)).toStrictEqual([
      "Passengers",
    ]);

    expect(
      ruleSentence(
        rule({ op: "anyInstance", groupId: "grp_passengers", condition: HOLDS_PASSPORT }),
        READ,
        DRAFT,
      )
        .filter((segment) => segment.kind === "group")
        .map((segment) => segment.text),
    ).toStrictEqual(["Passenger"]);

    const dangling = ruleSentence(
      rule({ op: "instanceCount", groupId: "grp_nowhere", compare: "gt", value: 0 }),
      READ,
      DRAFT,
    );
    expect(dangling.filter((s) => s.kind === "group")).toStrictEqual([]);
    expect(dangling.map((s) => s.text).join("")).toContain("grp_nowhere");
  });

  it("names a group even when the question library did not load", () => {
    const sentence = ruleSentence(
      rule({ op: "instanceCount", groupId: "grp_passengers", compare: "gt", value: 0 }),
      { ok: false },
      DRAFT,
    )
      .map((segment) => segment.text)
      .join("");

    expect(sentence).toContain("Passengers");
  });
});

describe("ruleScope", () => {
  it("reports a target inside a group, with the noun the chip reads", () => {
    const scope = ruleScope(DRAFT, ["q_fare_basis"]);

    expect(scope).toStrictEqual({
      kind: "group",
      groupId: "grp_passengers",
      label: "Passengers",
      noun: "Passenger",
    });
    expect(scopeChipLabel(scope)).toBe("evaluated per Passenger");
  });

  it("reports a target outside every group as form scope, and offers no chip", () => {
    const scope = ruleScope(DRAFT, ["q_declaration"]);

    expect(scope).toStrictEqual({ kind: "form" });
    expect(scopeChipLabel(scope)).toBeUndefined();
  });

  it("reports a STEP target as form scope, because a step can never be inside a group", () => {
    expect(ruleScope(DRAFT, ["stp_declaration"])).toStrictEqual({ kind: "form" });

    expect(ruleScope(DRAFT, ["stp_travellers"])).toStrictEqual({ kind: "form" });
  });

  it("reports a list straddling two scopes, which publish refuses", () => {
    const scope = ruleScope(DRAFT, ["q_fare_basis", "q_declaration"]);

    expect(scope.kind).toBe("spanning");
    expect(scope.kind === "spanning" ? [...scope.scopes].sort() : []).toStrictEqual([
      "form",
      "grp_passengers",
    ]);
    expect(scopeChipLabel(scope)).toBeUndefined();
  });

  it("reports no scope for a rule with no target, and for one naming nothing pinned", () => {
    expect(ruleScope(DRAFT, [])).toStrictEqual({ kind: "none" });

    expect(ruleScope(DRAFT, ["q_nowhere"])).toStrictEqual({ kind: "none" });
  });
});

describe("targetGroups with a group in the step", () => {
  it("lists a group's members in the group's own place, and marks the group they sit in", () => {
    const groups = targetGroups(DRAFT, [], ["grp_passengers"]);
    const travellers = [...groups.eligible, ...groups.ineligible].find(
      (group) => group.stepId === "stp_travellers",
    );

    expect(travellers?.options.map((option) => [option.id, option.groupId])).toStrictEqual([
      ["stp_travellers", undefined],
      ["q_passport", "grp_passengers"],
      ["q_fare_basis", "grp_passengers"],
    ]);
  });

  it("puts a target after the group's whole span in the eligible group for a whole-group read", () => {
    const groups = targetGroups(DRAFT, [], ["grp_passengers"]);

    expect(
      groups.eligible.flatMap((group) => group.options.map((option) => option.id)),
    ).toStrictEqual(["stp_declaration", "q_declaration"]);
  });
});
