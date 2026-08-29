import { describe, expect, it } from "vitest";

import type { ReadState } from "../read-state.ts";

import { isCombinator } from "./condition.ts";
import { ruleSentence, type RuleSentenceSegment } from "./rule-sentence.ts";
import { CONDITION_OPS } from "./types.ts";
import type {
  DraftCondition,
  DraftForm,
  DraftRule,
  LeafConditionOp,
  PinnableQuestion,
} from "./types.ts";

/**
 * The rules table's sentence.
 *
 * Three properties here are the reason this file exists rather than a rendering test over
 * the table, and each of them is invisible in a screenshot:
 *
 * 1. **A failed library read is not an empty one** (`lib/read-state.ts`, issues 543/544/572,
 *    contract §3). Every question name in a sentence is a library lookup, so the collapse
 *    those issues describe would make every rule in the form claim its question had no
 *    label, on a screen already showing the alert that says the library did not load.
 * 2. **Nesting cannot be misread.** "A or B, and C" and "A, or B and C" are different
 *    rules; the sentence has to bracket so that no reader has to guess which one it is.
 * 3. **Every operator is worded.** An operator with no wording must say so rather than
 *    print its own token in the middle of a sentence as though it were English.
 */

const SMOKING = {
  questionId: "q_smoking",
  type: "singleChoice" as const,
  label: { en: "How often do you smoke?" },
  options: [
    { optionId: "opt_daily", label: { en: "Daily" } },
    { optionId: "opt_weekly", label: { en: "Weekly" } },
  ],
};

const CONDITIONS = {
  questionId: "q_conditions",
  type: "multiChoice" as const,
  label: { en: "Which conditions apply?" },
  options: [
    { optionId: "opt_asthma", label: { en: "Asthma" } },
    { optionId: "opt_diabetes", label: { en: "Diabetes" } },
  ],
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_at_fault",
    slug: "at-fault",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [
      {
        version: 1,
        status: "published",
        definition: {
          questionId: "q_at_fault",
          type: "boolean",
          label: { en: "Were you at fault?" },
        },
      },
    ],
  },
  {
    questionId: "q_smoking",
    slug: "smoking",
    label: { en: "How often do you smoke?" },
    type: "singleChoice",
    // Two published versions with different option labels, so the test can prove the
    // sentence reads the version this form PINS (R6/R7) rather than the newest.
    versions: [
      {
        version: 1,
        status: "published",
        definition: {
          ...SMOKING,
          options: [{ optionId: "opt_daily", label: { en: "Every day (v1 wording)" } }],
        },
      },
      { version: 2, status: "published", definition: SMOKING },
    ],
  },
  {
    questionId: "q_conditions",
    slug: "conditions",
    label: { en: "Which conditions apply?" },
    type: "multiChoice",
    versions: [{ version: 1, status: "published", definition: CONDITIONS }],
  },
  {
    questionId: "q_age",
    slug: "age",
    label: { en: "Age" },
    type: "number",
    versions: [
      {
        version: 1,
        status: "published",
        definition: { questionId: "q_age", type: "number", label: { en: "Age" } },
      },
    ],
  },
  {
    questionId: "q_city",
    slug: "city",
    label: { en: "Which city?" },
    type: "shortText",
    versions: [
      {
        version: 1,
        status: "published",
        definition: { questionId: "q_city", type: "shortText", label: { en: "Which city?" } },
      },
    ],
  },
  {
    questionId: "q_nameless",
    slug: "nameless",
    label: null,
    type: "shortText",
    versions: [],
  },
];

const READ: ReadState<readonly PinnableQuestion[]> = { ok: true, data: LIBRARY };
const FAILED: ReadState<readonly PinnableQuestion[]> = { ok: false };

const DRAFT: DraftForm = {
  formId: "frm_cover",
  defaultLocale: "en",
  title: { en: "Cover" },
  steps: [
    {
      stepId: "stp_history",
      title: { en: "Driving history" },
      items: [
        { questionId: "q_at_fault", version: 1 },
        { questionId: "q_smoking", version: 2 },
        { questionId: "q_conditions", version: 1 },
        { questionId: "q_age", version: 1 },
        { questionId: "q_city", version: 1 },
        { questionId: "q_nameless", version: 1 },
      ],
    },
    { stepId: "stp_review", title: {}, items: [] },
    { stepId: "stp_extra", title: { en: "Extra cover" }, items: [] },
  ],
  rules: [],
};

function rule(when: DraftCondition, show: readonly string[] = ["stp_extra"]): DraftRule {
  return { ruleId: "rul_one", when, show };
}

/** The sentence as a reader sees it: every segment's text, in order. */
function read(
  when: DraftCondition,
  show?: readonly string[],
  library: ReadState<readonly PinnableQuestion[]> = READ,
): string {
  return ruleSentence(rule(when, show), library, DRAFT)
    .map((segment) => segment.text)
    .join("");
}

/** Only the runs the table emphasises. */
function names(segments: readonly RuleSentenceSegment[]): readonly string[] {
  return segments.filter((segment) => segment.isName === true).map((segment) => segment.text);
}

const ANSWERED: DraftCondition = { op: "answered", questionId: "q_at_fault" };

describe("ruleSentence", () => {
  it("writes the Code Owner's example", () => {
    expect(read(ANSWERED, ["stp_history"])).toBe(
      "When Were you at fault? is answered, show Driving history",
    );
  });

  it("hands the table the names already separated from the prose around them", () => {
    const segments = ruleSentence(rule(ANSWERED, ["stp_history"]), READ, DRAFT);

    expect(segments).toStrictEqual([
      { text: "When " },
      { text: "Were you at fault?", isName: true },
      { text: " is answered, show " },
      { text: "Driving history", isName: true },
    ]);
  });

  it("leaves every connective, comma and bracket outside a name", () => {
    const segments = ruleSentence(
      rule(
        {
          op: "and",
          conditions: [
            { op: "or", conditions: [ANSWERED, { op: "answered", questionId: "q_age" }] },
            { op: "answered", questionId: "q_city" },
          ],
        },
        ["stp_review", "stp_extra"],
      ),
      READ,
      DRAFT,
    );

    for (const segment of segments) {
      if (segment.isName !== true) continue;
      expect(segment.text).not.toMatch(/[(),]|\band\b|\bor\b/);
    }
    // "Untitled step" stands where a name could not be read, so it is not emphasised.
    expect(names(segments)).toStrictEqual([
      "Were you at fault?",
      "Age",
      "Which city?",
      "Extra cover",
    ]);
  });

  it("emits no empty segment and never splits prose across two of them", () => {
    const segments = ruleSentence(
      rule({ op: "not", condition: { op: "or", conditions: [ANSWERED] } }, ["stp_extra", "q_age"]),
      READ,
      DRAFT,
    );

    expect(segments.every((segment) => segment.text !== "")).toBe(true);
    for (const [index, segment] of segments.entries()) {
      const next = segments[index + 1];
      if (next === undefined) break;
      expect(segment.isName === true || next.isName === true).toBe(true);
    }
  });
});

describe("targets", () => {
  it("reads two targets as a pair and three as a list", () => {
    expect(read(ANSWERED, ["stp_history", "stp_extra"])).toContain(
      "show Driving history and Extra cover",
    );
    expect(read(ANSWERED, ["stp_history", "stp_extra", "q_age"])).toContain(
      "show Driving history, Extra cover and Age",
    );
  });

  it("names a step by its title and a question by its label, from the one mixed list", () => {
    expect(read(ANSWERED, ["q_smoking", "stp_extra"])).toContain(
      "show How often do you smoke? and Extra cover",
    );
  });

  it("uses the builder's own stand-in for an untitled step", () => {
    expect(read(ANSWERED, ["stp_review"])).toContain("show Untitled step");
  });

  it("says what a rule with no targets does rather than trailing off", () => {
    expect(read(ANSWERED, [])).toBe("When Were you at fault? is answered, show nothing");
  });
});

describe("a library that did not answer", () => {
  it("says the label is not known, and never that the question is missing", () => {
    const sentence = read(ANSWERED, ["q_age"], FAILED);

    expect(sentence).toBe("When Label not known is answered, show Label not known");
    expect(sentence).not.toContain("No label in the library");
  });

  it("still names every step, because a step is form-owned", () => {
    expect(read(ANSWERED, ["stp_history"], FAILED)).toBe(
      "When Label not known is answered, show Driving history",
    );
  });

  it("does not emphasise a stand-in as though it were a name", () => {
    const segments = ruleSentence(rule(ANSWERED, ["q_age"]), FAILED, DRAFT);

    expect(names(segments)).toStrictEqual([]);
  });

  it("leaves a choice operand as the id the rule holds rather than inventing a label", () => {
    const segments = ruleSentence(
      rule({ op: "equals", questionId: "q_smoking", value: "opt_daily" }),
      FAILED,
      DRAFT,
    );

    expect(segments.map((segment) => segment.text).join("")).toContain("is exactly opt_daily");
    expect(names(segments)).toStrictEqual(["Extra cover"]);
  });
});

describe("a library that answered", () => {
  it("reports a question it does not hold as missing from the library", () => {
    expect(read({ op: "answered", questionId: "q_gone" })).toContain(
      "When No label in the library is answered",
    );
  });

  it("reports a question it holds without a label the same way", () => {
    expect(read({ op: "answered", questionId: "q_nameless" })).toContain(
      "When No label in the library is answered",
    );
  });
});

describe("combinators", () => {
  it("reads and, or and not as English", () => {
    expect(
      read({ op: "and", conditions: [ANSWERED, { op: "answered", questionId: "q_age" }] }),
    ).toContain("When Were you at fault? is answered and Age is answered,");
    expect(
      read({ op: "or", conditions: [ANSWERED, { op: "answered", questionId: "q_age" }] }),
    ).toContain("When Were you at fault? is answered or Age is answered,");
    expect(read({ op: "not", condition: ANSWERED })).toContain(
      "When not (Were you at fault? is answered),",
    );
  });

  it("brackets a nested group so the two readings cannot be confused", () => {
    const orInsideAnd: DraftCondition = {
      op: "and",
      conditions: [
        { op: "or", conditions: [ANSWERED, { op: "answered", questionId: "q_age" }] },
        { op: "answered", questionId: "q_city" },
      ],
    };
    const andInsideOr: DraftCondition = {
      op: "or",
      conditions: [
        { op: "and", conditions: [ANSWERED, { op: "answered", questionId: "q_age" }] },
        { op: "answered", questionId: "q_city" },
      ],
    };

    expect(read(orInsideAnd)).toContain(
      "(Were you at fault? is answered or Age is answered) and Which city? is answered",
    );
    expect(read(andInsideOr)).toContain(
      "(Were you at fault? is answered and Age is answered) or Which city? is answered",
    );
    expect(read(orInsideAnd)).not.toBe(read(andInsideOr));
  });

  it("does not bracket a not twice: its own frame already delimits it", () => {
    expect(
      read({
        op: "and",
        conditions: [
          { op: "not", condition: ANSWERED },
          { op: "answered", questionId: "q_age" },
        ],
      }),
    ).toContain("not (Were you at fault? is answered) and Age is answered");
  });

  it("keeps the author's tree rather than flattening a same-operator nest", () => {
    expect(
      read({
        op: "and",
        conditions: [
          ANSWERED,
          {
            op: "and",
            conditions: [
              { op: "answered", questionId: "q_age" },
              { op: "answered", questionId: "q_city" },
            ],
          },
        ],
      }),
    ).toContain("Were you at fault? is answered and (Age is answered and Which city? is answered)");
  });

  it("says so when a group carries no branch at all", () => {
    expect(read({ op: "and", conditions: [] })).toBe(
      "When a group with no branches, show Extra cover",
    );
  });
});

/**
 * One condition per leaf operator, against a question whose type the operator applies to.
 *
 * Total over `LeafConditionOp`, which is what makes "every operator is worded" a property
 * of the type system as well as of the loop below: an operator added to the DSL fails to
 * compile here until it has a case, and fails in `rule-sentence.ts` until it has wording.
 */
const LEAF_CASES: Readonly<Record<LeafConditionOp, DraftCondition>> = {
  answered: ANSWERED,
  equals: { op: "equals", questionId: "q_smoking", value: "opt_daily" },
  notEquals: { op: "notEquals", questionId: "q_smoking", value: "opt_daily" },
  in: { op: "in", questionId: "q_age", values: [18, 21] },
  contains: { op: "contains", questionId: "q_conditions", value: "opt_asthma" },
  containsAny: {
    op: "containsAny",
    questionId: "q_conditions",
    values: ["opt_asthma", "opt_diabetes"],
  },
  gt: { op: "gt", questionId: "q_age", value: 18 },
  gte: { op: "gte", questionId: "q_age", value: 18 },
  lt: { op: "lt", questionId: "q_age", value: 65 },
  lte: { op: "lte", questionId: "q_age", value: 65 },
};

describe("leaf operators", () => {
  it("words every operator the DSL carries", () => {
    const leaves = CONDITION_OPS.filter((op) => !isCombinator(op));

    expect(Object.keys(LEAF_CASES).sort()).toStrictEqual([...leaves].sort());
    for (const condition of Object.values(LEAF_CASES)) {
      const sentence = read(condition);
      expect(sentence).not.toContain("cannot describe");
      expect(sentence).toContain("When ");
    }
  });

  it("gives each operator its own wording", () => {
    const written = Object.values(LEAF_CASES).map((condition) => read(condition));

    expect(new Set(written).size).toBe(written.length);
  });

  it("writes each comparison the way it would be read aloud", () => {
    expect(read(LEAF_CASES.answered)).toContain("Were you at fault? is answered");
    expect(read(LEAF_CASES.equals)).toContain("How often do you smoke? is exactly Daily");
    expect(read(LEAF_CASES.notEquals)).toContain("How often do you smoke? is not exactly Daily");
    expect(read(LEAF_CASES.in)).toContain("Age is one of 18 or 21");
    expect(read(LEAF_CASES.contains)).toContain("Which conditions apply? includes Asthma");
    expect(read(LEAF_CASES.containsAny)).toContain(
      "Which conditions apply? includes any of Asthma or Diabetes",
    );
    expect(read(LEAF_CASES.gt)).toContain("Age is greater than 18");
    expect(read(LEAF_CASES.gte)).toContain("Age is at least 18");
    expect(read(LEAF_CASES.lt)).toContain("Age is less than 65");
    expect(read(LEAF_CASES.lte)).toContain("Age is at most 65");
  });

  it("admits an operator this build has never seen instead of printing its token", () => {
    const sentence = read({
      op: "startsWith",
      questionId: "q_city",
      value: "Mel",
    } as unknown as DraftCondition);

    expect(sentence).toBe(
      "When a condition this build cannot describe (startsWith), show Extra cover",
    );
  });
});

describe("operands", () => {
  it("names a choice option as the pinned version labels it", () => {
    const segments = ruleSentence(
      rule({ op: "equals", questionId: "q_smoking", value: "opt_daily" }),
      READ,
      DRAFT,
    );

    // The form pins v2, so the label is v2's - not the v1 wording of the same option id.
    expect(names(segments)).toStrictEqual(["How often do you smoke?", "Daily", "Extra cover"]);
  });

  it("leaves an option id the pinned version does not declare as itself", () => {
    const segments = ruleSentence(
      rule({ op: "equals", questionId: "q_smoking", value: "opt_never" }),
      READ,
      DRAFT,
    );

    expect(segments.map((segment) => segment.text).join("")).toContain("is exactly opt_never");
    expect(names(segments)).toStrictEqual(["How often do you smoke?", "Extra cover"]);
  });

  it("reads a whole multiChoice answer as one answer made of several selections", () => {
    expect(
      read({ op: "equals", questionId: "q_conditions", value: ["opt_asthma", "opt_diabetes"] }),
    ).toContain("Which conditions apply? is exactly Asthma and Diabetes");
  });

  it("uses the operand control's own words for a boolean", () => {
    expect(read({ op: "equals", questionId: "q_at_fault", value: true })).toContain(
      "is exactly Yes",
    );
    expect(read({ op: "equals", questionId: "q_at_fault", value: false })).toContain(
      "is exactly No",
    );
  });

  it("renders free text as itself and does not emphasise it as a name", () => {
    const segments = ruleSentence(
      rule({ op: "equals", questionId: "q_city", value: "Melbourne" }),
      READ,
      DRAFT,
    );

    expect(segments.map((segment) => segment.text).join("")).toContain("is exactly Melbourne");
    expect(names(segments)).toStrictEqual(["Which city?", "Extra cover"]);
  });

  it("says an operand is empty rather than stopping mid-sentence", () => {
    // The state a freshly created `equals` against a text question is in
    // (`condition.ts`, `startingOperand`), so an author meets it by ordinary editing.
    expect(read({ op: "equals", questionId: "q_city", value: "" })).toBe(
      "When Which city? is exactly an empty value, show Extra cover",
    );
    expect(read({ op: "in", questionId: "q_age", values: [] })).toContain(
      "Age is one of an empty value",
    );
    expect(read({ op: "equals", questionId: "q_conditions", value: [] })).toContain(
      "is exactly an empty value",
    );
  });
});
