import { describe, expect, it } from "vitest";

import {
  analyzeRuleGraph,
  answerKey,
  answerKeyParts,
  CONDITION_MAX_DEPTH,
  compileDraft,
  conditionDepth,
  countBounds,
  documentOrder,
  evaluateRules,
  isRepeatGroup,
  labelPlaceholders,
  parseCondition,
  parseFormDefinition,
  parseQuestionDefinition,
  prepareSubmission,
  questionGroups,
  REPEAT_EVALUATION_BUDGET,
  repeatGroups,
  ruleGroupReferences,
  ruleReferences,
  SEMANTICS_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  stepQuestionRefs,
  validateAnswer,
  type AnswerKey,
  type AnswerMap,
  type Condition,
  type DraftInput,
  type FlowState,
  type FormDefinition,
  type FrozenSnapshot,
  type GroupId,
  type InstanceId,
  type PublishError,
  type PublishErrorCode,
  type QuestionDefinition,
  type QuestionId,
  type QuestionVersionRecord,
  type RosterMap,
  type SubmissionError,
  type VisibilityRule,
} from "./index.js";

/**
 * The repeating group in the kernel (task 071, ADR-42; ADR-03 and ADR-16 as
 * amended 2026-09-30; SEC-16).
 *
 * This file carries the acceptance cases of
 * `plan/repeating-groups-and-table-input.md` section 11 that are proved at the
 * unit layer and are **not** behaviour as data: the parse refusals, the publish
 * refusals, the graph readings and the submission sweep. The cases that ARE
 * behaviour as data - per-instance visibility, the three operators, the empty
 * group, a removed instance, a shrinking count - are golden scenarios under
 * `packages/core/golden/evaluator/scenarios/repeat-*.json`, because that corpus
 * is where frozen semantics belong. The focused evaluator tests here are the
 * ones whose point is a property rather than a `FlowState`.
 */

// Casts justified: these are known-valid literals matching the branded
// patterns, and branding once here keeps every call site free of Result
// unwraps. The runtime schemas are exercised on their own below.
const asQuestionId = (id: string): QuestionId => id as QuestionId;
const asGroupId = (id: string): GroupId => id as GroupId;
const asInstanceId = (id: string): InstanceId => id as InstanceId;

interface TestQuestion {
  readonly id: string;
  readonly type: string;
  readonly required?: boolean;
}

/** A group's declaration, as the test forms below spell one. */
interface TestGroup {
  readonly groupId: string;
  readonly items: readonly TestQuestion[];
  readonly count: unknown;
  readonly presentation?: string;
  readonly instanceLabel?: Record<string, string>;
  readonly label?: Record<string, string>;
}

type TestItem = TestQuestion | TestGroup;

function isTestGroup(item: TestItem): item is TestGroup {
  return "groupId" in item;
}

function makeQuestion(definition: unknown): QuestionDefinition {
  const result = parseQuestionDefinition(definition);
  if (!result.ok) {
    throw new Error(`test question did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function rawItem(item: TestItem): unknown {
  if (!isTestGroup(item)) {
    return { questionId: item.id, version: 1 };
  }
  return {
    groupId: item.groupId,
    label: item.label ?? { en: item.groupId },
    instanceLabel: item.instanceLabel ?? { en: "Instance {n}" },
    items: item.items.map((member) => ({ questionId: member.id, version: 1 })),
    count: item.count,
    ...(item.presentation === undefined ? {} : { presentation: item.presentation }),
  };
}

/** The raw JSON of a form built from step descriptors and raw rules. */
function rawForm(steps: readonly [string, readonly TestItem[]][], rules: unknown[]): unknown {
  return {
    formId: "frm_test",
    defaultLocale: "en",
    title: { en: "Test" },
    steps: steps.map(([stepId, items]) => ({
      stepId,
      title: { en: stepId },
      items: items.map(rawItem),
    })),
    rules,
  };
}

interface TestSetup {
  readonly form: FormDefinition;
  readonly questions: ReadonlyMap<string, QuestionDefinition>;
}

function build(steps: readonly [string, readonly TestItem[]][], rules: unknown[]): TestSetup {
  const questions = new Map<string, QuestionDefinition>();
  for (const [, items] of steps) {
    for (const item of items) {
      for (const question of isTestGroup(item) ? item.items : [item]) {
        questions.set(
          question.id,
          makeQuestion({
            type: question.type,
            questionId: question.id,
            label: { en: question.id },
            required: question.required ?? false,
          }),
        );
      }
    }
  }
  const parsed = parseFormDefinition(rawForm(steps, rules));
  if (!parsed.ok) {
    throw new Error(`test form did not parse: ${JSON.stringify(parsed.error)}`);
  }
  return { form: parsed.value, questions };
}

/** Publish a built form, returning the complete error list or the snapshot. */
function publish(setup: TestSetup): { errors: readonly PublishError[]; snapshot?: FrozenSnapshot } {
  const records = new Map<string, QuestionVersionRecord>();
  const published = new Map<QuestionId, Set<number>>();
  for (const definition of setup.questions.values()) {
    records.set(`${definition.questionId}@1`, {
      questionId: definition.questionId,
      version: 1,
      definition,
    });
    published.set(definition.questionId, new Set([1]));
  }
  const draft: DraftInput = {
    definition: setup.form,
    resolveQuestion: (questionId, version) => records.get(`${questionId}@${String(version)}`),
    publishedQuestionVersions: published,
  };
  const result = compileDraft(draft);
  return result.ok ? { errors: [], snapshot: result.value.snapshot } : { errors: result.error };
}

function codesOf(errors: readonly PublishError[]): readonly PublishErrorCode[] {
  return errors.map((error) => error.code);
}

function publishCodes(steps: readonly [string, readonly TestItem[]][], rules: unknown[] = []) {
  return codesOf(publish(build(steps, rules)).errors);
}

function rosterOf(entries: readonly [string, readonly string[]][]): RosterMap {
  return new Map(entries.map(([groupId, ids]) => [asGroupId(groupId), ids.map(asInstanceId)]));
}

function answersOf(entries: readonly [string, unknown][]): AnswerMap {
  return new Map(entries.map(([key, value]) => [key as AnswerKey, value as never]));
}

function evalOk(setup: TestSetup, answers: AnswerMap, rosters?: RosterMap): FlowState {
  const result = evaluateRules(
    setup.form,
    answers,
    (questionId) => setup.questions.get(questionId),
    rosters,
  );
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** A group of one required date plus one gate, the shape most cases here want. */
const PAX_GROUP: TestGroup = {
  groupId: "grp_pax",
  items: [
    { id: "q_dob", type: "date", required: true },
    { id: "q_fare", type: "boolean" },
  ],
  count: { source: "open", min: 0, max: 9 },
};

// --------------------------------------------------------------------------
// Schema and parse
// --------------------------------------------------------------------------

describe("the step item union (ADR-42)", () => {
  it("parses a pinned question and a repeating group side by side, with no kind tag", () => {
    const { form } = build([["stp_one", [{ id: "q_trip", type: "shortText" }, PAX_GROUP]]], []);
    const [plain, group] = form.steps[0]?.items ?? [];
    expect(plain !== undefined && !isRepeatGroup(plain)).toBe(true);
    expect(group !== undefined && isRepeatGroup(group)).toBe(true);
    // The union is discriminated by disjoint required keys, so nothing in a
    // form definition that parses today has to gain a tag.
    expect(JSON.stringify(form.steps[0]?.items)).not.toContain('"kind"');
  });

  it("defaults presentation to stacked, so an authored group may omit it", () => {
    const { form } = build([["stp_one", [PAX_GROUP]]], []);
    const [group] = repeatGroups(form.steps);
    expect(group?.presentation).toBe("stacked");
  });

  it("gives a step's pinned refs with groups expanded, and names each question's group", () => {
    const { form } = build(
      [["stp_one", [{ id: "q_trip", type: "shortText" }, PAX_GROUP]]],
      [],
    );
    const step = form.steps[0];
    expect(step === undefined ? [] : stepQuestionRefs(step).map((ref) => ref.questionId)).toEqual([
      "q_trip",
      "q_dob",
      "q_fare",
    ]);
    const groups = questionGroups(form.steps);
    expect(groups.get(asQuestionId("q_dob"))).toBe("grp_pax");
    expect(groups.get(asQuestionId("q_trip"))).toBeUndefined();
  });

  it("case 6: a questionId pinned both inside a group and outside it is refused at parse", () => {
    const result = parseFormDefinition(
      rawForm(
        [
          [
            "stp_one",
            [
              { id: "q_dob", type: "date" },
              { groupId: "grp_pax", items: [{ id: "q_dob", type: "date" }], count: PAX_GROUP.count },
            ],
          ],
        ],
        [],
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((error) => error.code)).toContain("DUPLICATE_QUESTION_IN_FORM");
    }
  });

  it("case 7: a group inside a group is refused at parse", () => {
    // Hand-written rather than built, because the builder cannot express a
    // shape the schema has no member for - which is the point of the case.
    const result = parseFormDefinition({
      formId: "frm_test",
      defaultLocale: "en",
      title: { en: "Test" },
      steps: [
        {
          stepId: "stp_one",
          title: { en: "stp_one" },
          items: [
            {
              groupId: "grp_pax",
              label: { en: "Passengers" },
              instanceLabel: { en: "Passenger {n}" },
              count: { source: "open", min: 0, max: 9 },
              items: [
                {
                  groupId: "grp_bags",
                  label: { en: "Bags" },
                  instanceLabel: { en: "Bag {n}" },
                  count: { source: "open", min: 0, max: 3 },
                  items: [{ questionId: "q_weight", version: 1 }],
                },
              ],
            },
          ],
        },
      ],
      rules: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The report points inside the nested group rather than at the outer
      // one's absent `questionId`, which is what the union-branch flattening in
      // `internal/coded-issues.ts` buys.
      expect(result.error[0]?.path).toEqual(["steps", 0, "items", 0, "items", 0, "questionId"]);
    }
  });

  it("refuses a duplicate groupId at parse", () => {
    const result = parseFormDefinition(
      rawForm(
        [
          [
            "stp_one",
            [PAX_GROUP, { ...PAX_GROUP, items: [{ id: "q_other", type: "shortText" }] }],
          ],
        ],
        [],
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((error) => error.code)).toContain("DUPLICATE_GROUP_ID");
    }
  });

  it("reads the bounds of all three count sources, a fixed count being its own", () => {
    expect(countBounds({ source: "fixed", count: 3 })).toEqual({ min: 3, max: 3 });
    expect(countBounds({ source: "open", min: 1, max: 9 })).toEqual({ min: 1, max: 9 });
    expect(
      countBounds({ source: "fromAnswer", questionId: asQuestionId("q_n"), min: 0 }),
    ).toEqual({ min: 0, max: undefined });
  });

  it("finds every {placeholder} in an instance label template", () => {
    expect(labelPlaceholders("Passenger {n}")).toEqual(["n"]);
    expect(labelPlaceholders("Passenger")).toEqual([]);
    expect(labelPlaceholders("{n} of {total}")).toEqual(["n", "total"]);
  });
});

describe("the instance-qualified answer key (ADR-42, Q15)", () => {
  it("is the bare questionId outside a group and instanceId/questionId inside one", () => {
    expect(answerKey(asQuestionId("q_dob"))).toBe("q_dob");
    expect(answerKey(asQuestionId("q_dob"), asInstanceId("ins_7k2"))).toBe("ins_7k2/q_dob");
  });

  it("round-trips through its parts, and a bare key has no instance", () => {
    expect(answerKeyParts("ins_7k2/q_dob" as AnswerKey)).toEqual({
      instanceId: "ins_7k2",
      questionId: "q_dob",
    });
    expect(answerKeyParts(asQuestionId("q_dob"))).toEqual({ questionId: "q_dob" });
  });
});

// --------------------------------------------------------------------------
// The rules DSL and the graph
// --------------------------------------------------------------------------

describe("the three whole-group operators (ADR-03 as amended)", () => {
  const nested = (op: string): unknown => ({
    op,
    groupId: "grp_pax",
    condition: { op: "answered", questionId: "q_dob" },
  });

  it("parse with a groupId and, for two of them, a nested condition", () => {
    for (const raw of [
      nested("anyInstance"),
      nested("everyInstance"),
      { op: "instanceCount", groupId: "grp_pax", compare: "gte", value: 5 },
    ]) {
      expect(parseCondition(raw).ok, JSON.stringify(raw)).toBe(true);
    }
  });

  it("refuse a malformed groupId and an unknown comparison", () => {
    expect(parseCondition({ ...(nested("anyInstance") as object), groupId: "q_pax" }).ok).toBe(
      false,
    );
    expect(
      parseCondition({ op: "instanceCount", groupId: "grp_pax", compare: "between", value: 1 }).ok,
    ).toBe(false);
  });

  it("count toward CONDITION_MAX_DEPTH, which is unchanged at 8", () => {
    expect(CONDITION_MAX_DEPTH).toBe(8);
    const parsed = parseCondition(nested("everyInstance"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // leaf 1, the operator 2 - exactly as `not` recurses.
      expect(conditionDepth(parsed.value)).toBe(2);
    }
    // Nine levels of the nested-condition operator is one too many.
    let deep: unknown = { op: "answered", questionId: "q_dob" };
    for (let level = 1; level <= CONDITION_MAX_DEPTH; level += 1) {
      deep = { op: "anyInstance", groupId: "grp_pax", condition: deep };
    }
    const tooDeep = parseCondition(deep);
    expect(tooDeep.ok).toBe(false);
    if (!tooDeep.ok) {
      expect(tooDeep.error.map((error) => error.code)).toContain("RULE_DEPTH_EXCEEDED");
    }
  });

  it("are collected by the reference walkers, which is what applies forward-only rule 2", () => {
    const rule = {
      ruleId: "rul_x",
      when: {
        op: "and",
        conditions: [
          { op: "anyInstance", groupId: "grp_pax", condition: { op: "answered", questionId: "q_dob" } },
          { op: "instanceCount", groupId: "grp_other", compare: "gte", value: 2 },
          { op: "answered", questionId: "q_trip" },
        ],
      },
      show: ["q_gate"],
    } as unknown as VisibilityRule;
    // The default branch of the walker reads `condition.questionId`, which none
    // of the three carries; without the explicit branches a group operator
    // would contribute nothing and its rule would never be checked.
    expect(ruleReferences(rule)).toEqual(["q_dob", "q_trip"]);
    expect(ruleGroupReferences(rule)).toEqual(["grp_pax", "grp_other"]);
  });
});

describe("documentOrder expands a group into a contiguous span (ADR-16 as amended)", () => {
  it("names each span position's group and keeps the span contiguous", () => {
    const { form } = build(
      [
        ["stp_one", [{ id: "q_trip", type: "shortText" }, PAX_GROUP]],
        ["stp_two", [{ id: "q_gate", type: "boolean" }]],
      ],
      [],
    );
    expect(documentOrder(form)).toEqual([
      { stepId: "stp_one", questionId: "q_trip" },
      { stepId: "stp_one", questionId: "q_dob", groupId: "grp_pax" },
      { stepId: "stp_one", questionId: "q_fare", groupId: "grp_pax" },
      { stepId: "stp_two", questionId: "q_gate" },
    ]);
  });

  it("makes a later position inside the instance a backward target, as it always was", () => {
    const { form } = build(
      [["stp_one", [PAX_GROUP]]],
      [
        {
          ruleId: "rul_backward",
          when: { op: "answered", questionId: "q_fare" },
          show: ["q_dob"],
        },
      ],
    );
    expect(analyzeRuleGraph(form).map((finding) => finding.code)).toEqual([
      "RULE_BACKWARD_TARGET",
    ]);
  });
});

// --------------------------------------------------------------------------
// Publish
// --------------------------------------------------------------------------

describe("publish: the count source (cases 8, 9, 10)", () => {
  const countFirst: [string, readonly TestItem[]][] = [
    ["stp_count", [{ id: "q_n", type: "number", required: true }]],
    [
      "stp_pax",
      [
        {
          groupId: "grp_pax",
          items: [{ id: "q_dob", type: "date" }],
          count: { source: "fromAnswer", questionId: "q_n", min: 0, max: 9 },
        },
      ],
    ],
  ];

  it("case 8: a fromAnswer count question before the group publishes", () => {
    expect(publishCodes(countFirst)).toEqual([]);
  });

  it("case 8: a fromAnswer count question after the group is REPEAT_COUNT_BACKWARD_REF", () => {
    expect(
      publishCodes([
        [
          "stp_pax",
          [
            {
              groupId: "grp_pax",
              items: [{ id: "q_dob", type: "date" }],
              count: { source: "fromAnswer", questionId: "q_n", min: 0, max: 9 },
            },
          ],
        ],
        ["stp_count", [{ id: "q_n", type: "number", required: true }]],
      ]),
    ).toEqual(["REPEAT_COUNT_BACKWARD_REF"]);
  });

  it("a fromAnswer count question that is not a number is REPEAT_COUNT_NOT_A_NUMBER", () => {
    expect(
      publishCodes([
        ["stp_count", [{ id: "q_n", type: "shortText" }]],
        [
          "stp_pax",
          [
            {
              groupId: "grp_pax",
              items: [{ id: "q_dob", type: "date" }],
              count: { source: "fromAnswer", questionId: "q_n", min: 0, max: 9 },
            },
          ],
        ],
      ]),
    ).toEqual(["REPEAT_COUNT_NOT_A_NUMBER"]);
  });

  it("case 9: max is required on open AND on fromAnswer, and absent on fixed", () => {
    expect(
      publishCodes([
        ["stp_pax", [{ ...PAX_GROUP, count: { source: "open", min: 1 } }]],
      ]),
    ).toEqual(["REPEAT_MAX_MISSING"]);
    expect(
      publishCodes([
        ["stp_count", [{ id: "q_n", type: "number" }]],
        [
          "stp_pax",
          [
            {
              groupId: "grp_pax",
              items: [{ id: "q_dob", type: "date" }],
              count: { source: "fromAnswer", questionId: "q_n", min: 0 },
            },
          ],
        ],
      ]),
    ).toEqual(["REPEAT_MAX_MISSING"]);
    // A fixed count carries no max at all and publishes: the number is the bound.
    expect(
      publishCodes([["stp_pax", [{ ...PAX_GROUP, count: { source: "fixed", count: 3 } }]]]),
    ).toEqual([]);
  });

  it("refuses min above max", () => {
    expect(
      publishCodes([
        ["stp_pax", [{ ...PAX_GROUP, count: { source: "open", min: 5, max: 2 } }]],
      ]),
    ).toEqual(["REPEAT_MIN_ABOVE_MAX"]);
  });

  it("case 10: there is no installation-wide ceiling, asserted as a positive case", () => {
    // A group declaring five thousand instances publishes, and nothing in core
    // is consulted to decide it: the Q14 ruling of 2026-09-30 removed both the
    // per-group and the per-session ceiling, so the ONLY bound is the author's.
    expect(
      publishCodes([["stp_pax", [{ ...PAX_GROUP, count: { source: "open", min: 0, max: 5000 } }]]]),
    ).toEqual([]);
    // The only constant repetition adds is a cost bound on one rule shape, and
    // it is not an instance ceiling: it never reads a group's max on its own.
    expect(REPEAT_EVALUATION_BUDGET).toBe(10_000);
  });
});

describe("publish: the instance label (ADR-42, Q6)", () => {
  it("refuses a placeholder that is not {n}, in any locale, and allows none at all", () => {
    expect(
      publishCodes([
        ["stp_pax", [{ ...PAX_GROUP, instanceLabel: { en: "Passenger {index}" } }]],
      ]),
    ).toEqual(["INSTANCE_LABEL_PLACEHOLDER_UNKNOWN"]);
    // A group of one has nothing to number, so a template with no placeholder
    // is legal rather than merely tolerated.
    expect(
      publishCodes([["stp_pax", [{ ...PAX_GROUP, instanceLabel: { en: "The passenger" } }]]]),
    ).toEqual([]);
  });

  it("puts a group's own texts through the locale and blank checks", () => {
    expect(
      publishCodes([["stp_pax", [{ ...PAX_GROUP, label: { fr: "Passagers" } }]]]),
    ).toEqual(["LOCALE_INCOMPLETE"]);
    expect(
      publishCodes([["stp_pax", [{ ...PAX_GROUP, instanceLabel: { en: "   " } }]]]),
    ).toEqual(["BLANK_LOCALIZED_TEXT"]);
  });
});

describe("publish: one rule, one scope (case 15)", () => {
  const steps: [string, readonly TestItem[]][] = [
    ["stp_pax", [PAX_GROUP]],
    ["stp_after", [{ id: "q_gate", type: "boolean" }]],
  ];
  const condition = { op: "answered", questionId: "q_dob" };

  it("refuses a show list that straddles a group boundary, naming both scopes", () => {
    const { errors } = publish(
      build(steps, [{ ruleId: "rul_mixed", when: condition, show: ["q_fare", "q_gate"] }]),
    );
    const finding = errors.find((error) => error.code === "RULE_TARGETS_SPAN_SCOPES");
    expect(finding).toBeDefined();
    if (finding?.code === "RULE_TARGETS_SPAN_SCOPES") {
      expect(finding.path).toEqual({ rule: "rul_mixed", scopes: ["grp_pax", "form"] });
    }
  });

  it("publishes the same targets split across two rules, which is always possible", () => {
    expect(
      codesOf(
        publish(
          build(steps, [
            { ruleId: "rul_in", when: condition, show: ["q_fare"] },
            {
              ruleId: "rul_out",
              when: {
                op: "anyInstance",
                groupId: "grp_pax",
                condition: { op: "answered", questionId: "q_dob" },
              },
              show: ["q_gate"],
            },
          ]),
        ).errors,
      ),
    ).toEqual([]);
  });
});

describe("publish: the whole-group read is a read of the whole span (case 14)", () => {
  it("refuses a target inside the span it reads, and accepts one after it", () => {
    const readsGroup = {
      op: "anyInstance",
      groupId: "grp_pax",
      condition: { op: "answered", questionId: "q_dob" },
    };
    // `q_fare` sits inside grp_pax's own span, so it is not strictly after it.
    expect(
      publishCodes(
        [
          ["stp_pax", [PAX_GROUP]],
          ["stp_after", [{ id: "q_gate", type: "boolean" }]],
        ],
        [{ ruleId: "rul_any", when: readsGroup, show: ["q_fare"] }],
      ),
      // Backward AND a cycle: the whole-group read reaches every question in
      // the span, so a target inside that span is a self-loop as well.
    ).toEqual(["RULE_BACKWARD_TARGET", "RULE_CYCLE"]);
    expect(
      publishCodes(
        [
          ["stp_pax", [PAX_GROUP]],
          ["stp_after", [{ id: "q_gate", type: "boolean" }]],
        ],
        [{ ruleId: "rul_any", when: readsGroup, show: ["q_gate"] }],
      ),
    ).toEqual([]);
  });
});

describe("publish: the cross-group evaluation budget (case 16)", () => {
  const twoGroups = (
    firstMax: number,
    secondMax: number,
  ): [string, readonly TestItem[]][] => [
    [
      "stp_one",
      [
        {
          groupId: "grp_g",
          items: [{ id: "q_dob", type: "date" }],
          count: { source: "open", min: 0, max: firstMax },
        },
      ],
    ],
    [
      "stp_two",
      [
        {
          groupId: "grp_h",
          items: [{ id: "q_note", type: "shortText" }],
          count: { source: "open", min: 0, max: secondMax },
        },
      ],
    ],
  ];
  const crossRule = {
    ruleId: "rul_cross",
    when: {
      op: "anyInstance",
      groupId: "grp_g",
      condition: { op: "answered", questionId: "q_dob" },
    },
    show: ["q_note"],
  };

  it("refuses a cross-group rule whose product exceeds the budget, naming both groups", () => {
    const { errors } = publish(build(twoGroups(200, 200), [crossRule]));
    const finding = errors.find(
      (error) => error.code === "REPEAT_EVALUATION_BUDGET_EXCEEDED",
    );
    expect(finding).toBeDefined();
    if (finding?.code === "REPEAT_EVALUATION_BUDGET_EXCEEDED") {
      expect(finding.path).toEqual({
        rule: "rul_cross",
        targetGroup: "grp_h",
        readGroup: "grp_g",
      });
      expect(finding.message).toContain("40000");
      expect(finding.message).toContain(String(REPEAT_EVALUATION_BUDGET));
    }
  });

  it("publishes the same rule at the budget exactly (a hundred by a hundred)", () => {
    expect(codesOf(publish(build(twoGroups(100, 100), [crossRule])).errors)).toEqual([]);
  });

  it("publishes two groups far above the budget when NO rule joins them", () => {
    // This is the half that keeps the constant honest: it bounds a rule shape,
    // never an instance count, so the Q14 ruling stands (SEC-16).
    expect(codesOf(publish(build(twoGroups(5000, 5000), [])).errors)).toEqual([]);
  });

  it("does not charge a rule for reading the group it targets", () => {
    // Inside-out is one walk per live instance, not a product: the rule below
    // is per-instance already, so nothing about it is quadratic.
    expect(
      publishCodes(
        [
          [
            "stp_one",
            [
              {
                groupId: "grp_g",
                items: [
                  { id: "q_dob", type: "date" },
                  { id: "q_fare", type: "boolean" },
                ],
                count: { source: "open", min: 0, max: 5000 },
              },
            ],
          ],
        ],
        [
          {
            ruleId: "rul_self",
            when: {
              op: "instanceCount",
              groupId: "grp_g",
              compare: "gte",
              value: 2,
            },
            show: ["q_fare"],
          },
        ],
      ),
      // It is refused for being backward inside its own span, which is the
      // ordinary ADR-16 rule, and NOT for the budget: no product is charged.
    ).toEqual(["RULE_BACKWARD_TARGET", "RULE_CYCLE"]);
  });
});

describe("publish: a definition built without the parser still reports by name", () => {
  it("reports REPEAT_NESTING_NOT_ALLOWED for a nested group compileDraft is handed", () => {
    const { form, questions } = build([["stp_one", [PAX_GROUP]]], []);
    const group = form.steps[0]?.items[0];
    if (group === undefined || !isRepeatGroup(group)) {
      throw new Error("the test form lost its group");
    }
    // The type does not prove the refinements ran, which is the whole reason
    // `checkStructure` exists; this is the same re-check DUPLICATE_STEP_ID gets.
    const nested = {
      ...form,
      steps: [
        {
          ...form.steps[0],
          items: [{ ...group, items: [...group.items, group] }],
        },
      ],
    } as FormDefinition;
    const result = compileDraft({
      definition: nested,
      resolveQuestion: (questionId, version) => {
        const definition = questions.get(questionId);
        return definition === undefined ? undefined : { questionId, version, definition };
      },
      publishedQuestionVersions: new Map(
        [...questions.keys()].map((id) => [asQuestionId(id), new Set([1])]),
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((error) => error.code)).toContain("REPEAT_NESTING_NOT_ALLOWED");
    }
  });
});

describe("the version stamps (ADR-42's consequences)", () => {
  it("moves SNAPSHOT_SCHEMA_VERSION to 2 and holds SEMANTICS_VERSION at 1", () => {
    // The snapshot's SHAPE changed, so its stamp moves. The SEMANTICS did not,
    // and that is load-bearing rather than tidy: the evaluator implements one
    // version at a time and refuses any other stamp, so a bump would make every
    // published snapshot fail at serve, answer and submit rather than preserve it.
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(2);
    expect(SEMANTICS_VERSION).toBe(1);
    const { snapshot } = publish(build([["stp_pax", [PAX_GROUP]]], []));
    expect(snapshot?.schemaVersion).toBe(2);
    expect(snapshot?.semanticsVersion).toBe(1);
  });
});

// --------------------------------------------------------------------------
// The evaluator
// --------------------------------------------------------------------------

describe("the per-instance forward pass (cases 3, 11, 13)", () => {
  const setup = (): TestSetup =>
    build(
      [
        ["stp_pax", [PAX_GROUP]],
        ["stp_after", [{ id: "q_gate", type: "boolean" }]],
      ],
      [
        {
          ruleId: "rul_fare",
          when: { op: "gte", questionId: "q_dob", value: "2024-01-01" },
          show: ["q_fare"],
        },
      ],
    );

  it("case 3: a form with no group carries none of the four new keys", () => {
    const plain = build([["stp_one", [{ id: "q_trip", type: "shortText" }]]], []);
    const state = evalOk(plain, answersOf([["q_trip", "Sydney"]]));
    // Deep equality against the pre-change shape, not a key-by-key check: an
    // extra key present as `undefined` would pass the latter and fail a golden.
    expect(state).toEqual({
      visible: [{ stepId: "stp_one", questionId: "q_trip" }],
      visibleSteps: ["stp_one"],
      currentStep: null,
      answeredRequired: [],
      missingRequired: [],
      complete: true,
    });
    expect(Object.keys(state).sort()).toEqual([
      "answeredRequired",
      "complete",
      "currentStep",
      "missingRequired",
      "visible",
      "visibleSteps",
    ]);
  });

  it("case 11: an in-group reference resolves to that instance and to no other", () => {
    const state = evalOk(
      setup(),
      answersOf([
        ["ins_a/q_dob", "1990-05-01"],
        ["ins_b/q_dob", "2024-06-15"],
      ]),
      rosterOf([["grp_pax", ["ins_a", "ins_b"]]]),
    );
    expect(state.visible.filter((entry) => entry.questionId === "q_fare")).toEqual([
      { stepId: "stp_pax", questionId: "q_fare", instanceId: "ins_b" },
    ]);
  });

  it("case 13: everyInstance over an empty group is false and is NOT not(anyInstance(not c))", () => {
    const evaluate = (when: unknown, roster: readonly string[]): boolean => {
      const withRule = build(
        [
          ["stp_pax", [PAX_GROUP]],
          ["stp_after", [{ id: "q_gate", type: "boolean" }]],
        ],
        [{ ruleId: "rul_x", when, show: ["q_gate"] }],
      );
      const state = evalOk(withRule, answersOf([]), rosterOf([["grp_pax", roster]]));
      return state.visible.some((entry) => entry.questionId === "q_gate");
    };
    const every = {
      op: "everyInstance",
      groupId: "grp_pax",
      condition: { op: "answered", questionId: "q_dob" },
    };
    const notAnyNot = {
      op: "not",
      condition: {
        op: "anyInstance",
        groupId: "grp_pax",
        condition: { op: "not", condition: { op: "answered", questionId: "q_dob" } },
      },
    };
    // The whole point of the Q7 ruling in two lines: over an EMPTY group the
    // two expressions disagree, so neither may be implemented as a rewrite of
    // the other. (They agree once an instance is live, and the golden corpus
    // carries that half.)
    expect(evaluate(every, [])).toBe(false);
    expect(evaluate(notAnyNot, [])).toBe(true);
  });

  it("treats a group question read with no instance in scope as unanswered, never a throw", () => {
    // A whole-form rule naming an in-group question directly has no
    // forward-only reading, so it is total rather than special-cased.
    const withRule = build(
      [
        ["stp_pax", [PAX_GROUP]],
        ["stp_after", [{ id: "q_gate", type: "boolean" }]],
      ],
      [{ ruleId: "rul_x", when: { op: "answered", questionId: "q_dob" }, show: ["q_gate"] }],
    );
    const state = evalOk(
      withRule,
      answersOf([["ins_a/q_dob", "1990-05-01"]]),
      rosterOf([["grp_pax", ["ins_a"]]]),
    );
    expect(state.visible.some((entry) => entry.questionId === "q_gate")).toBe(false);
  });

  it("omits the roster argument entirely and evaluates a group as empty", () => {
    const state = evalOk(setup(), answersOf([["ins_a/q_dob", "1990-05-01"]]));
    // The group contributes nothing: no instance is live, so no key is built
    // and the answer above is never canonicalized. The untargeted question on
    // the later step is unconditionally visible as it always was.
    expect(state.visible).toEqual([{ stepId: "stp_after", questionId: "q_gate" }]);
    // The four new fields are still PRESENT, because the FORM has a group; what
    // decides their presence is the definition, never the roster.
    expect(state.rosters).toEqual([{ groupId: "grp_pax", instances: [] }]);
  });

  it("lists a repeated required question once and names each instance beside it", () => {
    const state = evalOk(
      setup(),
      answersOf([["ins_a/q_dob", "1990-05-01"]]),
      rosterOf([["grp_pax", ["ins_a", "ins_b"]]]),
    );
    expect(state.missingRequired).toEqual(["q_dob"]);
    expect(state.answeredRequired).toEqual([]);
    expect(state.missingRequiredInstances).toEqual([
      { questionId: "q_dob", instanceId: "ins_b" },
    ]);
    expect(state.answeredRequiredInstances).toEqual([
      { questionId: "q_dob", instanceId: "ins_a" },
    ]);
    expect(state.complete).toBe(false);
  });

  it("paginates a perInstanceStep group into one step view per live instance", () => {
    const paginated = build(
      [["stp_pax", [{ ...PAX_GROUP, presentation: "perInstanceStep" }]]],
      [],
    );
    const state = evalOk(
      paginated,
      answersOf([
        ["ins_a/q_dob", "1990-05-01"],
        ["ins_b/q_dob", "1985-01-01"],
      ]),
      rosterOf([["grp_pax", ["ins_a", "ins_b"]]]),
    );
    expect(state.visibleStepViews).toEqual([
      { stepId: "stp_pax", instanceId: "ins_a" },
      { stepId: "stp_pax", instanceId: "ins_b" },
    ]);
  });
});

// --------------------------------------------------------------------------
// The submission sweep
// --------------------------------------------------------------------------

describe("prepareSubmission with a repeating group (cases 17, 19, 20, 21)", () => {
  const setup = (count: unknown = { source: "open", min: 1, max: 9 }): TestSetup =>
    build([["stp_pax", [{ ...PAX_GROUP, count }]]], []);

  async function lock(
    built: TestSetup,
    answers: AnswerMap,
    rosters?: RosterMap,
  ): Promise<{ errors: readonly SubmissionError[]; locked?: unknown }> {
    const { snapshot } = publish(built);
    if (snapshot === undefined) {
      throw new Error("the test form did not publish");
    }
    const result = await prepareSubmission(snapshot, answers, rosters);
    return result.ok ? { errors: [], locked: result.value.answers } : { errors: result.error };
  }

  it("case 19: three live instances and two answered give exactly one MISSING_REQUIRED", async () => {
    const { errors } = await lock(
      setup(),
      answersOf([
        ["ins_a/q_dob", "1990-05-01"],
        ["ins_b/q_dob", "1985-01-01"],
      ]),
      rosterOf([["grp_pax", ["ins_a", "ins_b", "ins_c"]]]),
    );
    expect(errors).toEqual([
      {
        code: "MISSING_REQUIRED",
        message: 'Required question "q_dob" in instance "ins_c" has no answer',
        questionId: "q_dob",
        instanceId: "ins_c",
      },
    ]);
  });

  it("case 20: a live count below min or above max is REPEAT_COUNT_OUT_OF_RANGE", async () => {
    const belowMin = await lock(setup(), answersOf([]), rosterOf([["grp_pax", []]]));
    expect(belowMin.errors.map((error) => error.code)).toEqual(["REPEAT_COUNT_OUT_OF_RANGE"]);

    const two = { source: "open", min: 0, max: 2 };
    const aboveMax = await lock(
      setup(two),
      answersOf([
        ["ins_a/q_dob", "1990-05-01"],
        ["ins_b/q_dob", "1985-01-01"],
        ["ins_c/q_dob", "1978-11-30"],
      ]),
      rosterOf([["grp_pax", ["ins_a", "ins_b", "ins_c"]]]),
    );
    const finding = aboveMax.errors.find(
      (error) => error.code === "REPEAT_COUNT_OUT_OF_RANGE",
    );
    expect(finding).toBeDefined();
    if (finding?.code === "REPEAT_COUNT_OUT_OF_RANGE") {
      expect(finding).toMatchObject({ groupId: "grp_pax", count: 3 });
    }
  });

  it("case 17: a removed instance's answers are excluded from the locked set", async () => {
    const { errors, locked } = await lock(
      setup(),
      answersOf([
        ["ins_a/q_dob", "1990-05-01"],
        ["ins_b/q_dob", "1985-01-01"],
        ["ins_gone/q_dob", "1978-11-30"],
      ]),
      rosterOf([["grp_pax", ["ins_a", "ins_b"]]]),
    );
    expect(errors).toEqual([]);
    expect(locked).toEqual([
      { questionId: "q_dob", instanceId: "ins_a", value: "1990-05-01" },
      { questionId: "q_dob", instanceId: "ins_b", value: "1985-01-01" },
    ]);
  });

  it("case 21: a cell is validated by the same call as a standalone answer", async () => {
    const definition = makeQuestion({
      type: "shortText",
      questionId: "q_note",
      label: { en: "Note" },
      constraints: { maxLength: 4 },
    });
    // `validateAnswer` takes a question and a value and knows nothing about
    // where the question sits, which is why a table is a presentation rather
    // than a question type: the same call refuses the same values per cell.
    const empty = validateAnswer(definition, "");
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error.map((error) => error.code)).toContain("EMPTY_ANSWER_NOT_ALLOWED");
    }
    const multi = makeQuestion({
      type: "multiChoice",
      questionId: "q_tags",
      label: { en: "Tags" },
      options: [{ optionId: "opt_a", label: { en: "A" } }],
    });
    const emptyList = validateAnswer(multi, []);
    expect(emptyList.ok).toBe(false);
    if (!emptyList.ok) {
      expect(emptyList.error.map((error) => error.code)).toContain("EMPTY_ANSWER_NOT_ALLOWED");
    }
  });

  it("case 21: clearing one cell leaves its siblings untouched", async () => {
    // A retraction is the absence of that one key. Nothing about the sibling
    // cells or the other instance moves, which is what "per cell" means at this
    // layer; the ledger's own append-only retraction is ADR-33's and 072's.
    const optional: TestGroup = {
      groupId: "grp_pax",
      items: [{ id: "q_note", type: "shortText" }],
      count: { source: "open", min: 1, max: 9 },
    };
    const built = build([["stp_pax", [optional]]], []);
    const { errors, locked } = await lock(
      built,
      answersOf([
        ["ins_a/q_note", "kept"],
        ["ins_c/q_note", "also kept"],
      ]),
      rosterOf([["grp_pax", ["ins_a", "ins_b", "ins_c"]]]),
    );
    expect(errors).toEqual([]);
    expect(locked).toEqual([
      { questionId: "q_note", instanceId: "ins_a", value: "kept" },
      { questionId: "q_note", instanceId: "ins_c", value: "also kept" },
    ]);
  });

  it("keeps a group-less form's locked answers free of an instanceId key", async () => {
    const plain = build([["stp_one", [{ id: "q_trip", type: "shortText" }]]], []);
    const { locked } = await lock(plain, answersOf([["q_trip", "Sydney"]]));
    // The absent KEY, not an undefined one: `canonicalJson` omits undefined, so
    // either would hash the same, but a reader of a locked submission should
    // not have to know that.
    expect(locked).toEqual([{ questionId: "q_trip", value: "Sydney" }]);
    expect(JSON.stringify(locked)).not.toContain("instanceId");
  });

  it("reports an answer whose question is not pinned at all as UNKNOWN_QUESTION", async () => {
    const { errors } = await lock(
      setup(),
      answersOf([
        ["ins_a/q_dob", "1990-05-01"],
        ["ins_a/q_ghost", "drift"],
      ]),
      rosterOf([["grp_pax", ["ins_a"]]]),
    );
    expect(errors).toEqual([
      {
        code: "UNKNOWN_QUESTION",
        message: 'Answer references question "q_ghost", which is not in the form',
        questionId: "q_ghost",
        instanceId: "ins_a",
      },
    ]);
  });
});

describe("the condition type is closed over the group operators", () => {
  it("cannot be narrowed to a question-bearing node by accident", () => {
    // A compile-time reminder rather than a runtime assertion: the three group
    // operators carry no `questionId`, which is exactly what every walker in
    // `rule-graph.ts` and `evaluate-rules.ts` has to branch on.
    const condition: Condition = {
      op: "instanceCount",
      groupId: asGroupId("grp_pax"),
      compare: "gte",
      value: 1,
    };
    expect("questionId" in condition).toBe(false);
  });
});
