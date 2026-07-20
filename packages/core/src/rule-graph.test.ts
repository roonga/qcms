import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  analyzeRuleGraph,
  checkRuleTypes,
  documentOrder,
  parseFormDefinition,
  parseQuestionDefinition,
  ruleReferences,
  ruleTargets,
  type FormDefinition,
  type QuestionDefinition,
  type ResolveQuestion,
  type VisibilityRule,
} from "./index.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, ...segments), "utf8"));
}

function loadForm(file: string): FormDefinition {
  const result = parseFormDefinition(readJson("forms", "valid", file));
  if (!result.ok) {
    throw new Error(`fixture ${file} did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Build a parsed form from steps of `stepId -> questionIds` plus raw rules. */
function makeForm(steps: readonly [string, readonly string[]][], rules: unknown[]): FormDefinition {
  const result = parseFormDefinition({
    formId: "frm_test",
    defaultLocale: "en",
    title: { en: "Test" },
    steps: steps.map(([stepId, questionIds]) => ({
      stepId,
      title: { en: stepId },
      items: questionIds.map((questionId) => ({ questionId, version: 1 })),
    })),
    rules,
  });
  if (!result.ok) {
    throw new Error(`test form did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function onlyRule(form: FormDefinition): VisibilityRule {
  const rule = form.rules[0];
  if (rule === undefined) {
    throw new Error("test form has no rules");
  }
  return rule;
}

function makeQuestion(definition: unknown): QuestionDefinition {
  const result = parseQuestionDefinition(definition);
  if (!result.ok) {
    throw new Error(`test question did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Resolver over the task-003 question fixtures (what the forms pin). */
function fixtureResolver(): ResolveQuestion {
  const byId = new Map<string, QuestionDefinition>();
  for (const file of readdirSync(path.join(FIXTURES_DIR, "questions", "valid"))) {
    const definition = makeQuestion(readJson("questions", "valid", file));
    byId.set(definition.questionId, definition);
  }
  return (questionId) => byId.get(questionId);
}

describe("documentOrder", () => {
  it("flattens steps into (stepId, questionId) pairs in order", () => {
    const order = documentOrder(loadForm("kitchen-sink.json"));
    expect(order.map((entry) => entry.questionId)).toEqual([
      "q_full_name",
      "q_dob",
      "q_smoker",
      "q_cigs_daily",
      "q_preexisting_conditions",
      "q_medical_history",
      "q_coverage_level",
    ]);
    expect(order[0]?.stepId).toBe("stp_about");
    expect(order[6]?.stepId).toBe("stp_cover");
  });
});

describe("ruleReferences", () => {
  it("collects every referenced questionId recursively, deduplicated", () => {
    const form = makeForm(
      [["stp_one", ["q_a", "q_b", "q_c", "q_d"]]],
      [
        {
          ruleId: "rul_nested",
          when: {
            op: "and",
            conditions: [
              { op: "equals", questionId: "q_a", value: true },
              {
                op: "or",
                conditions: [
                  { op: "not", condition: { op: "answered", questionId: "q_b" } },
                  { op: "gt", questionId: "q_c", value: 1 },
                  { op: "equals", questionId: "q_a", value: false },
                ],
              },
            ],
          },
          show: ["q_d"],
        },
      ],
    );
    expect(ruleReferences(onlyRule(form))).toEqual(["q_a", "q_b", "q_c"]);
  });
});

describe("ruleTargets", () => {
  it("expands a StepId target to all of the step's questions", () => {
    const form = makeForm(
      [
        ["stp_one", ["q_a"]],
        ["stp_two", ["q_b", "q_c"]],
      ],
      [
        {
          ruleId: "rul_step",
          when: { op: "answered", questionId: "q_a" },
          show: ["stp_two", "q_b"],
        },
      ],
    );
    expect(ruleTargets(form, onlyRule(form))).toEqual(["q_b", "q_c"]);
  });

  it("expands an unknown StepId to nothing (dangling refs are 008's)", () => {
    const form = makeForm(
      [["stp_one", ["q_a", "q_b"]]],
      [
        {
          ruleId: "rul_dangling",
          when: { op: "answered", questionId: "q_a" },
          show: ["stp_missing", "q_b"],
        },
      ],
    );
    expect(ruleTargets(form, onlyRule(form))).toEqual(["q_b"]);
  });
});

describe("analyzeRuleGraph", () => {
  it("accepts a forward chain (A shows B, B shows C)", () => {
    const form = makeForm(
      [["stp_one", ["q_a", "q_b", "q_c"]]],
      [
        {
          ruleId: "rul_one",
          when: { op: "equals", questionId: "q_a", value: true },
          show: ["q_b"],
        },
        {
          ruleId: "rul_two",
          when: { op: "answered", questionId: "q_b" },
          show: ["q_c"],
        },
      ],
    );
    expect(analyzeRuleGraph(form)).toEqual([]);
  });

  it("accepts the kitchen-sink and insurance fixtures", () => {
    expect(analyzeRuleGraph(loadForm("kitchen-sink.json"))).toEqual([]);
    expect(analyzeRuleGraph(loadForm("insurance.json"))).toEqual([]);
  });

  it("flags a target at the same position as a referenced question", () => {
    const form = makeForm(
      [["stp_one", ["q_a", "q_b"]]],
      [
        {
          ruleId: "rul_self",
          when: { op: "answered", questionId: "q_b" },
          show: ["q_b"],
        },
      ],
    );
    const findings = analyzeRuleGraph(form);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "RULE_BACKWARD_TARGET",
          path: { rule: "rul_self", target: "q_b" },
        }),
      ]),
    );
  });

  it("flags a target strictly before a referenced question", () => {
    const form = makeForm(
      [["stp_one", ["q_a", "q_b"]]],
      [
        {
          ruleId: "rul_back",
          when: { op: "answered", questionId: "q_b" },
          show: ["q_a"],
        },
      ],
    );
    expect(analyzeRuleGraph(form)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "RULE_BACKWARD_TARGET",
          path: { rule: "rul_back", target: "q_a" },
        }),
      ]),
    );
  });

  it("flags the A-shows-B / B-shows-A cycle with both rules", () => {
    const form = makeForm(
      [["stp_one", ["q_a", "q_b"]]],
      [
        {
          ruleId: "rul_one",
          when: { op: "equals", questionId: "q_a", value: true },
          show: ["q_b"],
        },
        {
          ruleId: "rul_two",
          when: { op: "equals", questionId: "q_b", value: true },
          show: ["q_a"],
        },
      ],
    );
    const findings = analyzeRuleGraph(form);
    const cycles = findings.filter((finding) => finding.code === "RULE_CYCLE");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.path.rules.slice().sort()).toEqual(["rul_one", "rul_two"]);
    // A cycle necessarily contains a backward edge too.
    expect(findings.some((finding) => finding.code === "RULE_BACKWARD_TARGET")).toBe(true);
  });

  it("expands step targets when checking direction", () => {
    const form = makeForm(
      [
        ["stp_one", ["q_a", "q_b"]],
        ["stp_two", ["q_c"]],
      ],
      [
        {
          ruleId: "rul_back_step",
          when: { op: "answered", questionId: "q_c" },
          show: ["stp_one"],
        },
        {
          ruleId: "rul_fwd_step",
          when: { op: "answered", questionId: "q_a" },
          show: ["stp_two"],
        },
      ],
    );
    const findings = analyzeRuleGraph(form);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "RULE_BACKWARD_TARGET",
          path: { rule: "rul_back_step", target: "stp_one" },
        }),
      ]),
    );
    expect(
      findings.some(
        (finding) =>
          finding.code === "RULE_BACKWARD_TARGET" && finding.path.rule === "rul_fwd_step",
      ),
    ).toBe(false);
  });

  it("skips references and targets that do not resolve in the form", () => {
    const form = makeForm(
      [["stp_one", ["q_a"]]],
      [
        {
          ruleId: "rul_dangling",
          when: { op: "answered", questionId: "q_missing" },
          show: ["q_also_missing"],
        },
      ],
    );
    expect(analyzeRuleGraph(form)).toEqual([]);
  });
});

describe("checkRuleTypes", () => {
  const questions = new Map<string, QuestionDefinition>(
    [
      makeQuestion({ type: "boolean", questionId: "q_bool", label: { en: "Bool" } }),
      makeQuestion({ type: "number", questionId: "q_num", label: { en: "Num" } }),
      makeQuestion({ type: "date", questionId: "q_date", label: { en: "Date" } }),
      makeQuestion({ type: "shortText", questionId: "q_text", label: { en: "Text" } }),
      makeQuestion({
        type: "singleChoice",
        questionId: "q_single",
        label: { en: "Single" },
        options: [
          { optionId: "opt_a", label: { en: "A" } },
          { optionId: "opt_b", label: { en: "B" } },
        ],
      }),
      makeQuestion({
        type: "multiChoice",
        questionId: "q_multi",
        label: { en: "Multi" },
        options: [
          { optionId: "opt_x", label: { en: "X" } },
          { optionId: "opt_y", label: { en: "Y" } },
        ],
      }),
    ].map((definition) => [definition.questionId, definition]),
  );
  const resolve: ResolveQuestion = (questionId) => questions.get(questionId);

  function check(when: unknown) {
    const form = makeForm([["stp_one", ["q_text"]]], [{ ruleId: "rul_t", when, show: ["q_text"] }]);
    return checkRuleTypes(form, resolve);
  }

  it("finds no issues in the fixture forms against the fixture questions", () => {
    const resolveFixtures = fixtureResolver();
    expect(checkRuleTypes(loadForm("kitchen-sink.json"), resolveFixtures)).toEqual([]);
    expect(checkRuleTypes(loadForm("insurance.json"), resolveFixtures)).toEqual([]);
  });

  it("flags gt on a boolean question", () => {
    expect(check({ op: "gt", questionId: "q_bool", value: 1 })).toEqual([
      expect.objectContaining({
        code: "RULE_TYPE_MISMATCH",
        path: { rule: "rul_t", question: "q_bool" },
      }),
    ]);
  });

  it("accepts ordered operators on number and date questions", () => {
    expect(check({ op: "gt", questionId: "q_num", value: 10 })).toEqual([]);
    expect(check({ op: "lte", questionId: "q_date", value: "2020-01-01" })).toEqual([]);
  });

  it("flags cross-type ordered comparison (number question, date value)", () => {
    expect(check({ op: "gt", questionId: "q_num", value: "2020-01-01" })).toEqual([
      expect.objectContaining({ code: "RULE_TYPE_MISMATCH" }),
    ]);
    expect(check({ op: "lt", questionId: "q_date", value: 5 })).toEqual([
      expect.objectContaining({ code: "RULE_TYPE_MISMATCH" }),
    ]);
  });

  it("flags equals with a wrong-typed value", () => {
    expect(check({ op: "equals", questionId: "q_num", value: true })).toEqual([
      expect.objectContaining({
        code: "RULE_TYPE_MISMATCH",
        path: { rule: "rul_t", question: "q_num" },
      }),
    ]);
    expect(check({ op: "notEquals", questionId: "q_text", value: 3 })).toEqual([
      expect.objectContaining({ code: "RULE_TYPE_MISMATCH" }),
    ]);
    expect(check({ op: "equals", questionId: "q_date", value: "not-a-date" })).toEqual([
      expect.objectContaining({ code: "RULE_TYPE_MISMATCH" }),
    ]);
    expect(check({ op: "equals", questionId: "q_bool", value: false })).toEqual([]);
  });

  it("requires declared optionIds for equals/in on choice questions", () => {
    expect(check({ op: "equals", questionId: "q_single", value: "opt_a" })).toEqual([]);
    expect(check({ op: "equals", questionId: "q_single", value: "opt_zz" })).toEqual([
      expect.objectContaining({
        code: "DANGLING_OPTION_REF",
        path: { rule: "rul_t", question: "q_single", option: "opt_zz" },
      }),
    ]);
    // A plain string that is not OptionId-shaped is a type mismatch, not a
    // dangling reference.
    expect(check({ op: "equals", questionId: "q_single", value: "basic" })).toEqual([
      expect.objectContaining({ code: "RULE_TYPE_MISMATCH" }),
    ]);
    expect(check({ op: "in", questionId: "q_single", values: ["opt_a", "opt_zz"] })).toEqual([
      expect.objectContaining({ code: "DANGLING_OPTION_REF" }),
    ]);
  });

  it("treats multiChoice equals as whole-answer set equality (ADR-21)", () => {
    expect(check({ op: "equals", questionId: "q_multi", value: ["opt_x", "opt_y"] })).toEqual([]);
    // A single optionId is not a multiChoice answer - use contains.
    expect(check({ op: "equals", questionId: "q_multi", value: "opt_x" })).toEqual([
      expect.objectContaining({ code: "RULE_TYPE_MISMATCH" }),
    ]);
    expect(check({ op: "equals", questionId: "q_multi", value: ["opt_zz"] })).toEqual([
      expect.objectContaining({ code: "DANGLING_OPTION_REF" }),
    ]);
  });

  it("flags contains on a non-multiChoice question", () => {
    expect(check({ op: "contains", questionId: "q_single", value: "opt_a" })).toEqual([
      expect.objectContaining({
        code: "RULE_TYPE_MISMATCH",
        path: { rule: "rul_t", question: "q_single" },
      }),
    ]);
    expect(check({ op: "containsAny", questionId: "q_text", values: ["opt_a"] })).toEqual([
      expect.objectContaining({ code: "RULE_TYPE_MISMATCH" }),
    ]);
  });

  it("requires declared optionIds for contains/containsAny", () => {
    expect(check({ op: "contains", questionId: "q_multi", value: "opt_x" })).toEqual([]);
    expect(check({ op: "contains", questionId: "q_multi", value: "opt_zz" })).toEqual([
      expect.objectContaining({
        code: "DANGLING_OPTION_REF",
        path: { rule: "rul_t", question: "q_multi", option: "opt_zz" },
      }),
    ]);
    expect(
      check({ op: "containsAny", questionId: "q_multi", values: ["opt_x", "opt_zz"] }),
    ).toEqual([expect.objectContaining({ code: "DANGLING_OPTION_REF" })]);
  });

  it("checks conditions nested under and/or/not", () => {
    const findings = check({
      op: "and",
      conditions: [
        { op: "not", condition: { op: "gt", questionId: "q_bool", value: 1 } },
        {
          op: "or",
          conditions: [{ op: "contains", questionId: "q_text", value: "opt_x" }],
        },
      ],
    });
    expect(findings.map((finding) => finding.code).sort()).toEqual([
      "RULE_TYPE_MISMATCH",
      "RULE_TYPE_MISMATCH",
    ]);
  });

  it("accepts answered on any type and skips unresolvable questions", () => {
    expect(check({ op: "answered", questionId: "q_bool" })).toEqual([]);
    expect(check({ op: "gt", questionId: "q_unknown", value: 1 })).toEqual([]);
  });

  it("deduplicates identical findings", () => {
    const findings = check({
      op: "and",
      conditions: [
        { op: "contains", questionId: "q_multi", value: "opt_zz" },
        { op: "contains", questionId: "q_multi", value: "opt_zz" },
      ],
    });
    expect(findings).toHaveLength(1);
  });
});
