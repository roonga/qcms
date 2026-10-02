import { describe, expect, it } from "vitest";

import type { ReadState } from "../read-state.ts";

import { ruleSentence } from "./rule-sentence.ts";
import { ruleScope, scopeChipLabel, targetGroups } from "./rule-targets.ts";
import type { DraftCondition, DraftForm, DraftRule, PinnableQuestion } from "./types.ts";

/**
 * The sentences the three whole-group operators read as, and the scope the editor states for a
 * per-instance rule (task 074, ADR-42; Q7 ruled 2026-09-29).
 *
 * ## Why these two are asserted together
 *
 * They are the two halves of one problem. Scope is implicit by POSITION, so a per-instance rule
 * is written as an ordinary condition and the editor has to say so (the chip); and the
 * outside-in direction has three operators whose sentences have to say what they mean, including
 * one whose reading is a ruling rather than a convention. Both are language decisions about one
 * rule, both are pure functions of the draft, and both are what an author actually reads.
 *
 * ## The two sentences that cost something if they go
 *
 * Exit criterion 2 names them, and the work order's note says which is likelier to be skipped:
 *
 * - **`everyInstance` states its own reading.** Over a group with no live instance it is FALSE,
 *   not vacuously true. An author reading a bare "every passenger holds a passport" supplies the
 *   classical reading, under which it is TRUE of a booking with no passengers - the opposite of
 *   what they meant.
 * - **Its NEGATION states its own reading too, and that is the one to watch.** Closing the
 *   vacuous reading for `everyInstance` makes `not(everyInstance(...))` true over an empty group,
 *   so "show the warning unless every passenger has a passport" fires for a booking with no
 *   passengers. A warning is usually phrased as a negation, so the negation is the sentence an
 *   author will actually write - and the plain one reads like the interesting case, which is how
 *   this gets skipped.
 *
 * Both are asserted on the RENDERED sentence rather than on the builder, which is the exit
 * criterion's own wording: what matters is the words an author reads, not that a frame exists.
 */

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

/** The airline case: a passenger group, then a question after its span. */
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

    // The clause is the ruling, not a flourish (Q7): the empty group is FALSE, and an author
    // reading a bare "every passenger ..." would supply the classical reading instead.
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

    // `not(everyInstance(G, c))` is TRUE over an empty group, so a warning phrased this way
    // fires for a booking with no passengers at all. That has to be in the sentence, because a
    // warning is usually phrased as a negation and this is the form an author writes.
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

    // The generic `not (...)` frame would wrap the plain clause - "and there is at least one
    // passenger" - inside a negation, which reads as the opposite of what the rule does.
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

    // "at least one passenger where A and B" and "at least one passenger where A, and B" are
    // different rules; these frames carry no brackets of their own, unlike `not (...)`.
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
    // The quantifier frames emphasise the SINGULAR noun instead, which is the name one instance
    // carries: "at least one Passenger", never "at least one Passengers".
    expect(
      ruleSentence(
        rule({ op: "anyInstance", groupId: "grp_passengers", condition: HOLDS_PASSPORT }),
        READ,
        DRAFT,
      )
        .filter((segment) => segment.kind === "group")
        .map((segment) => segment.text),
    ).toStrictEqual(["Passenger"]);

    // A group the draft does not declare is `DANGLING_GROUP_REF` at publish. Rendering the id is
    // honest about being an id rather than dressing one up as a name.
    const dangling = ruleSentence(
      rule({ op: "instanceCount", groupId: "grp_nowhere", compare: "gt", value: 0 }),
      READ,
      DRAFT,
    );
    expect(dangling.filter((s) => s.kind === "group")).toStrictEqual([]);
    expect(dangling.map((s) => s.text).join("")).toContain("grp_nowhere");
  });

  it("names a group even when the question library did not load", () => {
    // A group is FORM-owned, so unlike a question's label it never depended on that read
    // (contract §3: a failed read suppresses only what it actually made unknowable).
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
    // Even the step that HOLDS the group: a step target expands to every question in it, which
    // includes the group's members and anything beside them.
    expect(ruleScope(DRAFT, ["stp_travellers"])).toStrictEqual({ kind: "form" });
  });

  it("reports a list straddling two scopes, which publish refuses", () => {
    const scope = ruleScope(DRAFT, ["q_fare_basis", "q_declaration"]);

    // `RULE_TARGETS_SPAN_SCOPES`: one rule is evaluated in one scope, so this has no reading at
    // all. The editor says so before the round trip and names the mechanical remedy.
    expect(scope.kind).toBe("spanning");
    expect(scope.kind === "spanning" ? [...scope.scopes].sort() : []).toStrictEqual([
      "form",
      "grp_passengers",
    ]);
    expect(scopeChipLabel(scope)).toBeUndefined();
  });

  it("reports no scope for a rule with no target, and for one naming nothing pinned", () => {
    expect(ruleScope(DRAFT, [])).toStrictEqual({ kind: "none" });
    // A target the draft does not pin is `DANGLING_QUESTION_REF`, a different refusal with its
    // own sentence; guessing a scope for it would stack a second complaint on the first.
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
