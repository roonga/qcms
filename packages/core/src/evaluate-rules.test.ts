import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  evaluateRules,
  parseFormDefinition,
  parseQuestionDefinition,
  SEMANTICS_VERSION,
  type AnswerMap,
  type AnswerValue,
  type EvalError,
  type FlowState,
  type FormDefinition,
  type FrozenSnapshot,
  type OptionId,
  type QuestionDefinition,
  type QuestionId,
  type ResolveQuestion,
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

function makeQuestion(definition: unknown): QuestionDefinition {
  const result = parseQuestionDefinition(definition);
  if (!result.ok) {
    throw new Error(`test question did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Resolver over the task-003 question fixtures (what the fixture forms pin). */
function fixtureResolver(): ResolveQuestion {
  const byId = new Map<string, QuestionDefinition>();
  for (const file of readdirSync(path.join(FIXTURES_DIR, "questions", "valid"))) {
    const definition = makeQuestion(readJson("questions", "valid", file));
    byId.set(definition.questionId, definition);
  }
  return (questionId) => byId.get(questionId);
}

// Casts justified: test ids are known-valid `q_*`/`opt_*` literals matching the
// branded patterns; branding once here keeps call sites free of Result unwraps.
const asQuestionId = (id: string): QuestionId => id as QuestionId;
const asOptionId = (id: string): OptionId => id as OptionId;

/** A multiChoice AnswerValue (OptionId[]) from option-id literals. */
const opts = (...ids: string[]): AnswerValue => ids.map(asOptionId);

/** Shorthand question descriptor for building test forms. */
interface TestQuestion {
  id: string;
  type: string;
  required?: boolean;
  options?: readonly string[];
}

interface TestSetup {
  form: FormDefinition;
  resolve: ResolveQuestion;
}

/** Build a parsed form plus a resolver from step descriptors and raw rules. */
function build(steps: readonly [string, readonly TestQuestion[]][], rules: unknown[]): TestSetup {
  const byId = new Map<string, QuestionDefinition>();
  for (const [, questions] of steps) {
    for (const question of questions) {
      byId.set(
        question.id,
        makeQuestion({
          type: question.type,
          questionId: question.id,
          label: { en: question.id },
          required: question.required ?? false,
          ...(question.options === undefined
            ? {}
            : {
                options: question.options.map((optionId) => ({
                  optionId,
                  label: { en: optionId },
                })),
              }),
        }),
      );
    }
  }
  const parsed = parseFormDefinition({
    formId: "frm_test",
    defaultLocale: "en",
    title: { en: "Test" },
    steps: steps.map(([stepId, questions]) => ({
      stepId,
      title: { en: stepId },
      items: questions.map((question) => ({ questionId: question.id, version: 1 })),
    })),
    rules,
  });
  if (!parsed.ok) {
    throw new Error(`test form did not parse: ${JSON.stringify(parsed.error)}`);
  }
  return { form: parsed.value, resolve: (questionId) => byId.get(questionId) };
}

function answersOf(entries: readonly [string, AnswerValue][]): AnswerMap {
  return new Map(entries.map(([id, value]) => [asQuestionId(id), value]));
}

function evalOk(setup: TestSetup, answers: AnswerMap): FlowState {
  const result = evaluateRules(setup.form, answers, setup.resolve);
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function evalErr(setup: TestSetup, answers: AnswerMap): EvalError {
  const result = evaluateRules(setup.form, answers, setup.resolve);
  if (result.ok) {
    throw new Error("expected an EvalError");
  }
  return result.error;
}

function visibleIds(state: FlowState): readonly string[] {
  return state.visible.map((entry) => entry.questionId);
}

/** One boolean question `q_a` gating a target `q_b` via the given rule(s). */
function gate(
  rules: unknown[],
  target: TestQuestion = { id: "q_b", type: "shortText" },
): TestSetup {
  return build([["stp_one", [{ id: "q_a", type: "boolean" }, target]]], rules);
}

const showWhenAccidentTrue = {
  ruleId: "rul_gate",
  when: { op: "equals", questionId: "q_a", value: true },
  show: ["q_b"],
};

describe("semantic 1 - forward walk, targeting", () => {
  it("untargeted items are visible with no answers at all", () => {
    const setup = build(
      [
        ["stp_one", [{ id: "q_a", type: "boolean" }]],
        ["stp_two", [{ id: "q_b", type: "shortText" }]],
      ],
      [],
    );
    const state = evalOk(setup, answersOf([]));
    expect(visibleIds(state)).toEqual(["q_a", "q_b"]);
    expect(state.visibleSteps).toEqual(["stp_one", "stp_two"]);
  });

  it("a targeted item is hidden until a targeting rule is true", () => {
    const setup = gate([showWhenAccidentTrue]);
    expect(visibleIds(evalOk(setup, answersOf([])))).toEqual(["q_a"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", false]])))).toEqual(["q_a"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", true]])))).toEqual(["q_a", "q_b"]);
  });

  it("a target of several rules is visible when at least one is true", () => {
    const setup = build(
      [
        [
          "stp_one",
          [
            { id: "q_a", type: "boolean" },
            { id: "q_b", type: "number" },
            { id: "q_c", type: "shortText" },
          ],
        ],
      ],
      [
        {
          ruleId: "rul_one",
          when: { op: "equals", questionId: "q_a", value: true },
          show: ["q_c"],
        },
        { ruleId: "rul_two", when: { op: "gt", questionId: "q_b", value: 10 }, show: ["q_c"] },
      ],
    );
    expect(visibleIds(evalOk(setup, answersOf([["q_a", false]])))).toEqual(["q_a", "q_b"]);
    expect(
      visibleIds(
        evalOk(
          setup,
          answersOf([
            ["q_a", false],
            ["q_b", 11],
          ]),
        ),
      ),
    ).toEqual(["q_a", "q_b", "q_c"]);
  });

  it("and/or/not compose; depth-capped trees evaluate", () => {
    const setup = gate([
      {
        ruleId: "rul_combo",
        when: {
          op: "and",
          conditions: [
            { op: "answered", questionId: "q_a" },
            { op: "not", condition: { op: "equals", questionId: "q_a", value: false } },
          ],
        },
        show: ["q_b"],
      },
    ]);
    expect(visibleIds(evalOk(setup, answersOf([])))).toEqual(["q_a"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", false]])))).toEqual(["q_a"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", true]])))).toEqual(["q_a", "q_b"]);
  });
});

describe("semantic 2 - unanswered and hidden references", () => {
  it("equals on an unanswered question is false; answered is the existence test", () => {
    const equalsGate = gate([showWhenAccidentTrue]);
    expect(visibleIds(evalOk(equalsGate, answersOf([])))).toEqual(["q_a"]);

    const answeredGate = gate([
      { ruleId: "rul_gate", when: { op: "answered", questionId: "q_a" }, show: ["q_b"] },
    ]);
    expect(visibleIds(evalOk(answeredGate, answersOf([])))).toEqual(["q_a"]);
    // answered is true for any present answer, including falsy ones.
    expect(visibleIds(evalOk(answeredGate, answersOf([["q_a", false]])))).toEqual(["q_a", "q_b"]);
  });

  it("notEquals on an unanswered question is false, not true", () => {
    const setup = gate([
      {
        ruleId: "rul_gate",
        when: { op: "notEquals", questionId: "q_a", value: true },
        show: ["q_b"],
      },
    ]);
    expect(visibleIds(evalOk(setup, answersOf([])))).toEqual(["q_a"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", false]])))).toEqual(["q_a", "q_b"]);
  });

  it("a hidden question's answer is excluded from downstream conditions (I6)", () => {
    const setup = build(
      [
        [
          "stp_one",
          [
            { id: "q_a", type: "boolean" },
            { id: "q_b", type: "number" },
            { id: "q_c", type: "shortText" },
          ],
        ],
      ],
      [
        { ruleId: "rul_ab", when: { op: "equals", questionId: "q_a", value: true }, show: ["q_b"] },
        { ruleId: "rul_bc", when: { op: "gt", questionId: "q_b", value: 10 }, show: ["q_c"] },
      ],
    );
    const stale = answersOf([
      ["q_a", false],
      ["q_b", 20],
    ]);
    // q_b is hidden, so its stale answer must not satisfy rul_bc.
    expect(visibleIds(evalOk(setup, stale))).toEqual(["q_a"]);
    const active = answersOf([
      ["q_a", true],
      ["q_b", 20],
    ]);
    expect(visibleIds(evalOk(setup, active))).toEqual(["q_a", "q_b", "q_c"]);
  });

  it("answered treats a hidden question as unanswered", () => {
    const setup = build(
      [
        [
          "stp_one",
          [
            { id: "q_a", type: "boolean" },
            { id: "q_b", type: "number" },
            { id: "q_c", type: "shortText" },
          ],
        ],
      ],
      [
        { ruleId: "rul_ab", when: { op: "equals", questionId: "q_a", value: true }, show: ["q_b"] },
        { ruleId: "rul_bc", when: { op: "answered", questionId: "q_b" }, show: ["q_c"] },
      ],
    );
    const state = evalOk(
      setup,
      answersOf([
        ["q_a", false],
        ["q_b", 20],
      ]),
    );
    expect(visibleIds(state)).toEqual(["q_a"]);
  });
});

describe("semantic 3 - operator evaluation", () => {
  const multi: TestQuestion = {
    id: "q_a",
    type: "multiChoice",
    options: ["opt_a", "opt_b", "opt_c"],
  };
  const target: TestQuestion = { id: "q_b", type: "shortText" };

  it("equals on multiChoice is whole-answer set equality (ADR-21)", () => {
    const setup = build(
      [["stp_one", [multi, target]]],
      [
        {
          ruleId: "rul_gate",
          when: { op: "equals", questionId: "q_a", value: ["opt_a", "opt_b"] },
          show: ["q_b"],
        },
      ],
    );
    // Order-insensitive.
    expect(visibleIds(evalOk(setup, answersOf([["q_a", opts("opt_b", "opt_a")]])))).toEqual([
      "q_a",
      "q_b",
    ]);
    // A subset is not equal.
    expect(visibleIds(evalOk(setup, answersOf([["q_a", opts("opt_a")]])))).toEqual(["q_a"]);
  });

  it("contains matches a subset selection where equals does not (ADR-21)", () => {
    const setup = build(
      [["stp_one", [multi, target, { id: "q_c", type: "shortText" }]]],
      [
        {
          ruleId: "rul_equals",
          when: { op: "equals", questionId: "q_a", value: ["opt_a", "opt_b"] },
          show: ["q_b"],
        },
        {
          ruleId: "rul_contains",
          when: { op: "contains", questionId: "q_a", value: "opt_a" },
          show: ["q_c"],
        },
      ],
    );
    const state = evalOk(setup, answersOf([["q_a", opts("opt_a")]]));
    expect(visibleIds(state)).toEqual(["q_a", "q_c"]);
  });

  it("containsAny is true when at least one listed option is selected", () => {
    const setup = build(
      [["stp_one", [multi, target]]],
      [
        {
          ruleId: "rul_gate",
          when: { op: "containsAny", questionId: "q_a", values: ["opt_a", "opt_c"] },
          show: ["q_b"],
        },
      ],
    );
    expect(visibleIds(evalOk(setup, answersOf([["q_a", opts("opt_c")]])))).toEqual(["q_a", "q_b"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", opts("opt_b")]])))).toEqual(["q_a"]);
  });

  it("in is membership by valuesEqual", () => {
    const setup = build(
      [["stp_one", [{ id: "q_a", type: "number" }, target]]],
      [
        {
          ruleId: "rul_gate",
          when: { op: "in", questionId: "q_a", values: [1, 2, 3] },
          show: ["q_b"],
        },
      ],
    );
    expect(visibleIds(evalOk(setup, answersOf([["q_a", 2]])))).toEqual(["q_a", "q_b"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", 4]])))).toEqual(["q_a"]);
  });

  it("ordered operators compare numbers numerically and dates lexicographically", () => {
    const numeric = build(
      [["stp_one", [{ id: "q_a", type: "number" }, target]]],
      [{ ruleId: "rul_gate", when: { op: "gte", questionId: "q_a", value: 10 }, show: ["q_b"] }],
    );
    expect(visibleIds(evalOk(numeric, answersOf([["q_a", 10]])))).toEqual(["q_a", "q_b"]);
    expect(visibleIds(evalOk(numeric, answersOf([["q_a", 9.5]])))).toEqual(["q_a"]);

    const dated = build(
      [["stp_one", [{ id: "q_a", type: "date" }, target]]],
      [
        {
          ruleId: "rul_gate",
          when: { op: "lt", questionId: "q_a", value: "2024-03-01" },
          show: ["q_b"],
        },
      ],
    );
    expect(visibleIds(evalOk(dated, answersOf([["q_a", "2024-02-29"]])))).toEqual(["q_a", "q_b"]);
    expect(visibleIds(evalOk(dated, answersOf([["q_a", "2024-03-01"]])))).toEqual(["q_a"]);
  });

  it("equals across canonical types is false, never an error", () => {
    const setup = build(
      [["stp_one", [{ id: "q_a", type: "number" }, target]]],
      [{ ruleId: "rul_gate", when: { op: "equals", questionId: "q_a", value: 5 }, show: ["q_b"] }],
    );
    // Text answer against a number condition value: unequal, not an error.
    const state = evalOk(setup, answersOf([["q_a", "5"]]));
    expect(visibleIds(state)).toEqual(["q_a"]);
  });

  it("ordered comparison over incompatible types is a typed EvalError, not a throw", () => {
    const setup = gate([
      { ruleId: "rul_gate", when: { op: "gt", questionId: "q_a", value: 10 }, show: ["q_b"] },
    ]);
    const error = evalErr(setup, answersOf([["q_a", true]]));
    expect(error.code).toBe("CONDITION_TYPE_MISMATCH");
    expect(error.path).toEqual(["rul_gate", "q_a"]);
    // Answer values are never echoed (SECURITY_DESIGN).
    expect(error.message).not.toContain("true");
  });

  it("contains against a non-array answer is a typed EvalError", () => {
    const setup = gate([
      {
        ruleId: "rul_gate",
        when: { op: "contains", questionId: "q_a", value: "opt_a" },
        show: ["q_b"],
      },
    ]);
    const error = evalErr(setup, answersOf([["q_a", true]]));
    expect(error.code).toBe("CONDITION_TYPE_MISMATCH");
    expect(error.path).toEqual(["rul_gate", "q_a"]);
  });
});

describe("semantic 4 - step-level visibility", () => {
  const twoStep = (rules: unknown[]): TestSetup =>
    build(
      [
        ["stp_one", [{ id: "q_a", type: "boolean" }]],
        [
          "stp_two",
          [
            { id: "q_b", type: "shortText" },
            { id: "q_c", type: "shortText" },
          ],
        ],
        ["stp_three", [{ id: "q_d", type: "shortText" }]],
      ],
      rules,
    );

  it("a step target conditions the whole step; a question target only itself", () => {
    const stepTargeted = twoStep([
      {
        ruleId: "rul_step",
        when: { op: "equals", questionId: "q_a", value: true },
        show: ["stp_two"],
      },
    ]);
    // Step hidden: both of its questions gone, including untargeted q_c.
    expect(visibleIds(evalOk(stepTargeted, answersOf([["q_a", false]])))).toEqual(["q_a", "q_d"]);
    expect(evalOk(stepTargeted, answersOf([["q_a", false]])).visibleSteps).toEqual([
      "stp_one",
      "stp_three",
    ]);

    const questionTargeted = twoStep([
      { ruleId: "rul_q", when: { op: "equals", questionId: "q_a", value: true }, show: ["q_b"] },
    ]);
    // Only q_b is conditional; its sibling q_c stays visible.
    expect(visibleIds(evalOk(questionTargeted, answersOf([["q_a", false]])))).toEqual([
      "q_a",
      "q_c",
      "q_d",
    ]);
  });

  it("a hidden step contributes no visible questions regardless of per-question rules", () => {
    const setup = twoStep([
      {
        ruleId: "rul_step",
        when: { op: "equals", questionId: "q_a", value: true },
        show: ["stp_two"],
      },
      // This rule is true, but it cannot resurrect a question of a hidden step.
      { ruleId: "rul_q", when: { op: "answered", questionId: "q_a" }, show: ["q_b"] },
    ]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", false]])))).toEqual(["q_a", "q_d"]);
  });

  it("step-level and question-level rules AND together inside a visible step", () => {
    const setup = twoStep([
      { ruleId: "rul_step", when: { op: "answered", questionId: "q_a" }, show: ["stp_two"] },
      { ruleId: "rul_q", when: { op: "equals", questionId: "q_a", value: true }, show: ["q_b"] },
    ]);
    // Step shown (answered), but q_b's own rule is false.
    expect(visibleIds(evalOk(setup, answersOf([["q_a", false]])))).toEqual(["q_a", "q_c", "q_d"]);
    expect(visibleIds(evalOk(setup, answersOf([["q_a", true]])))).toEqual([
      "q_a",
      "q_b",
      "q_c",
      "q_d",
    ]);
  });

  it("answers inside a hidden step are excluded downstream", () => {
    const setup = twoStep([
      {
        ruleId: "rul_step",
        when: { op: "equals", questionId: "q_a", value: true },
        show: ["stp_two"],
      },
      {
        ruleId: "rul_later",
        when: { op: "equals", questionId: "q_b", value: "yes" },
        show: ["q_d"],
      },
    ]);
    const state = evalOk(
      setup,
      answersOf([
        ["q_a", false],
        ["q_b", "yes"],
      ]),
    );
    expect(visibleIds(state)).toEqual(["q_a"]);
  });

  it("a step whose questions are all rule-hidden is not in visibleSteps", () => {
    const setup = build(
      [
        ["stp_one", [{ id: "q_a", type: "boolean" }]],
        ["stp_two", [{ id: "q_b", type: "shortText" }]],
      ],
      [{ ruleId: "rul_q", when: { op: "equals", questionId: "q_a", value: true }, show: ["q_b"] }],
    );
    const state = evalOk(setup, answersOf([["q_a", false]]));
    expect(state.visibleSteps).toEqual(["stp_one"]);
    // The only visible question is answered, so nothing is current.
    expect(state.currentStep).toBeNull();
  });
});

describe("semantic 5 - currentStep, required accounting, completeness", () => {
  const threeStep = (): TestSetup =>
    build(
      [
        ["stp_one", [{ id: "q_a", type: "shortText" }]],
        ["stp_two", [{ id: "q_b", type: "boolean", required: true }]],
        ["stp_three", [{ id: "q_c", type: "number", required: true }]],
      ],
      [],
    );

  it("currentStep prefers the first step with a missing required question", () => {
    // stp_one has an unanswered optional question, but required wins.
    const state = evalOk(threeStep(), answersOf([]));
    expect(state.currentStep).toBe("stp_two");
    expect(state.missingRequired).toEqual(["q_b", "q_c"]);
    expect(state.answeredRequired).toEqual([]);
    expect(state.complete).toBe(false);
  });

  it("falls back to the first step with any unanswered question, then null", () => {
    const setup = threeStep();
    const requiredDone = evalOk(
      setup,
      answersOf([
        ["q_b", true],
        ["q_c", 1],
      ]),
    );
    expect(requiredDone.currentStep).toBe("stp_one");
    expect(requiredDone.complete).toBe(true);
    expect(requiredDone.answeredRequired).toEqual(["q_b", "q_c"]);

    const allDone = evalOk(
      setup,
      answersOf([
        ["q_a", "hello"],
        ["q_b", false],
        ["q_c", 0],
      ]),
    );
    expect(allDone.currentStep).toBeNull();
    expect(allDone.complete).toBe(true);
  });

  it("a hidden required question neither blocks completeness nor sets currentStep", () => {
    const setup = build(
      [
        [
          "stp_one",
          [
            { id: "q_a", type: "boolean", required: true },
            { id: "q_b", type: "number", required: true },
          ],
        ],
      ],
      [
        {
          ruleId: "rul_gate",
          when: { op: "equals", questionId: "q_a", value: true },
          show: ["q_b"],
        },
      ],
    );
    const hidden = evalOk(setup, answersOf([["q_a", false]]));
    expect(hidden.complete).toBe(true);
    expect(hidden.currentStep).toBeNull();
    expect(hidden.missingRequired).toEqual([]);

    const shown = evalOk(setup, answersOf([["q_a", true]]));
    expect(shown.complete).toBe(false);
    expect(shown.currentStep).toBe("stp_one");
    expect(shown.missingRequired).toEqual(["q_b"]);
  });
});

describe("totality - typed errors on malformed input", () => {
  const wellFormed = (): TestSetup => gate([showWhenAccidentTrue]);

  it("junk input is INVALID_FORM_DEFINITION, not a throw", () => {
    const { resolve } = wellFormed();
    for (const junk of [null, 42, "form", { steps: [] }, []]) {
      // Cast justified: deliberately malformed input to exercise the typed error path.
      const result = evaluateRules(junk as unknown as FormDefinition, answersOf([]), resolve);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORM_DEFINITION");
      }
    }
  });

  it("a snapshot with an unknown semanticsVersion is a typed error", () => {
    const { form, resolve } = wellFormed();
    const snapshot: FrozenSnapshot = {
      definition: form,
      questions: [],
      semanticsVersion: 2,
      schemaVersion: 1,
    };
    const result = evaluateRules(snapshot, answersOf([]), resolve);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");
    }
  });

  it("a version-1 snapshot evaluates identically to its bare definition", () => {
    const { form, resolve } = wellFormed();
    // `questions` is empty on purpose: evaluateRules resolves pins through its
    // injected lookup, not the snapshot's embedded records.
    const snapshot: FrozenSnapshot = {
      definition: form,
      questions: [],
      semanticsVersion: SEMANTICS_VERSION,
      schemaVersion: 1,
    };
    const answers = answersOf([["q_a", true]]);
    expect(evaluateRules(snapshot, answers, resolve)).toEqual(
      evaluateRules(form, answers, resolve),
    );
  });

  it("an unresolvable pin is UNRESOLVED_QUESTION_PIN naming the question", () => {
    const { form } = wellFormed();
    const result = evaluateRules(form, answersOf([]), () => undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNRESOLVED_QUESTION_PIN");
      expect(result.error.path).toEqual(["q_a", "q_b"]);
    }
  });

  it("a malformed answer value is MALFORMED_ANSWER_VALUE and never echoed", () => {
    const setup = wellFormed();
    const answers = new Map([
      // Cast justified: deliberately non-canonical value to exercise MALFORMED_ANSWER_VALUE.
      [asQuestionId("q_a"), { secret: "hunter2" } as unknown as AnswerValue],
    ]);
    const error = evalErr(setup, answers);
    expect(error.code).toBe("MALFORMED_ANSWER_VALUE");
    expect(error.path).toEqual(["q_a"]);
    expect(JSON.stringify(error)).not.toContain("hunter2");
  });

  it("answer keys not pinned in the form are ignored", () => {
    const setup = wellFormed();
    const state = evalOk(
      setup,
      answersOf([
        ["q_a", true],
        ["q_zzz", "ignored"],
      ]),
    );
    expect(visibleIds(state)).toEqual(["q_a", "q_b"]);
  });

  it("a backward (publish-invalid) reference reads as unanswered, deterministically", () => {
    // q_b's rule reads q_c which sits *after* it - publish rejects this
    // (RULE_BACKWARD_TARGET), but evaluation stays total: the unsettled
    // reference is unanswered, so the rule is false.
    const setup = build(
      [
        [
          "stp_one",
          [
            { id: "q_a", type: "boolean" },
            { id: "q_b", type: "shortText" },
            { id: "q_c", type: "boolean" },
          ],
        ],
      ],
      [
        {
          ruleId: "rul_back",
          when: { op: "equals", questionId: "q_c", value: true },
          show: ["q_b"],
        },
      ],
    );
    const state = evalOk(setup, answersOf([["q_c", true]]));
    expect(visibleIds(state)).toEqual(["q_a", "q_c"]);
  });
});

describe("insurance fixture (exit criterion 3)", () => {
  const setup = (): TestSetup => ({ form: loadForm("insurance.json"), resolve: fixtureResolver() });

  it("q_at_fault_accident=true shows q_accident_count and requires it", () => {
    const state = evalOk(setup(), answersOf([["q_at_fault_accident", true]]));
    expect(visibleIds(state)).toEqual(["q_at_fault_accident", "q_accident_count"]);
    expect(state.missingRequired).toEqual(["q_accident_count"]);
    expect(state.currentStep).toBe("stp_history");
    expect(state.complete).toBe(false);
  });

  it("answering the follow-up completes the form", () => {
    const state = evalOk(
      setup(),
      answersOf([
        ["q_at_fault_accident", true],
        ["q_accident_count", 20],
      ]),
    );
    expect(state.complete).toBe(true);
    expect(state.currentStep).toBeNull();
    expect(state.answeredRequired).toEqual(["q_at_fault_accident", "q_accident_count"]);
  });

  it("changing q_at_fault_accident to false hides q_accident_count; the stale answer is inert", () => {
    const state = evalOk(
      setup(),
      answersOf([
        ["q_at_fault_accident", false],
        ["q_accident_count", 20], // stale ledger-latest answer, now hidden
      ]),
    );
    expect(visibleIds(state)).toEqual(["q_at_fault_accident"]);
    expect(state.missingRequired).toEqual([]);
    expect(state.complete).toBe(true);
  });

  it("the stale hidden answer does not affect any later condition", () => {
    // The fixture extended with a downstream question gated on q_accident_count
    // (fixture file untouched - extension happens in-memory).
    const raw = readJson("forms", "valid", "insurance.json") as {
      steps: { items: { questionId: string; version: number }[] }[];
      rules: unknown[];
    };
    raw.steps[0]?.items.push({ questionId: "q_heavy_extra", version: 1 });
    raw.rules.push({
      ruleId: "rul_heavy",
      when: { op: "gte", questionId: "q_accident_count", value: 10 },
      show: ["q_heavy_extra"],
    });
    const parsed = parseFormDefinition(raw);
    if (!parsed.ok) {
      throw new Error("extended insurance form did not parse");
    }
    const fixtures = fixtureResolver();
    const extra = makeQuestion({
      type: "boolean",
      questionId: "q_heavy_extra",
      label: { en: "Extra" },
    });
    const extended: TestSetup = {
      form: parsed.value,
      resolve: (questionId) => (questionId === extra.questionId ? extra : fixtures(questionId)),
    };
    const stale = answersOf([
      ["q_at_fault_accident", false],
      ["q_accident_count", 20],
    ]);
    expect(visibleIds(evalOk(extended, stale))).toEqual(["q_at_fault_accident"]);
    const active = answersOf([
      ["q_at_fault_accident", true],
      ["q_accident_count", 20],
    ]);
    expect(visibleIds(evalOk(extended, active))).toEqual([
      "q_at_fault_accident",
      "q_accident_count",
      "q_heavy_extra",
    ]);
  });
});

describe("kitchen-sink fixture", () => {
  it("evaluates the multiChoice containsAny rule", () => {
    const setup: TestSetup = { form: loadForm("kitchen-sink.json"), resolve: fixtureResolver() };
    const state = evalOk(
      setup,
      answersOf([
        ["q_at_fault_accident", false],
        ["q_preexisting_conditions", opts("opt_asthma")],
      ]),
    );
    expect(visibleIds(state)).toContain("q_medical_history");
    expect(visibleIds(state)).not.toContain("q_accident_count");
  });
});

// --- Property tests (exit criterion 1) -------------------------------------

type GenType = "boolean" | "number" | "shortText" | "date" | "singleChoice" | "multiChoice";

const OPTION_IDS = ["opt_a", "opt_b", "opt_c"] as const;
const DATES = ["1999-12-31", "2020-01-01", "2024-02-29", "2024-03-01"] as const;

interface GenQuestion {
  type: GenType;
  required: boolean;
  newStep: boolean;
}

const genQuestionArb: fc.Arbitrary<GenQuestion> = fc.record({
  type: fc.constantFrom<GenType>(
    "boolean",
    "number",
    "shortText",
    "date",
    "singleChoice",
    "multiChoice",
  ),
  required: fc.boolean(),
  newStep: fc.boolean(),
});

function answerValueArb(type: GenType): fc.Arbitrary<AnswerValue> {
  switch (type) {
    case "boolean":
      return fc.boolean();
    case "number":
      return fc.double({ noNaN: true, noDefaultInfinity: true });
    case "shortText":
      return fc.string();
    case "date":
      return fc.constantFrom(...DATES);
    case "singleChoice":
      return fc.constantFrom(...OPTION_IDS);
    case "multiChoice":
      return fc.subarray([...OPTION_IDS]).map((ids): AnswerValue => ids.map(asOptionId));
  }
}

/** A type-correct leaf condition over question `index` of the given type. */
function leafConditionArb(index: number, type: GenType): fc.Arbitrary<unknown> {
  const questionId = `q_g${String(index)}`;
  const answered = fc.constant({ op: "answered", questionId });
  switch (type) {
    case "boolean":
    case "shortText":
      return fc.oneof(
        answered,
        fc.record({
          op: fc.constantFrom("equals", "notEquals"),
          questionId: fc.constant(questionId),
          value: answerValueArb(type),
        }),
      );
    case "number":
    case "date":
      return fc.oneof(
        answered,
        fc.record({
          op: fc.constantFrom("gt", "gte", "lt", "lte", "equals"),
          questionId: fc.constant(questionId),
          value: type === "number" ? fc.integer({ min: -5, max: 5 }) : fc.constantFrom(...DATES),
        }),
      );
    case "singleChoice":
      return fc.oneof(
        answered,
        fc.record({
          op: fc.constant("in"),
          questionId: fc.constant(questionId),
          values: fc.uniqueArray(fc.constantFrom(...OPTION_IDS), { minLength: 1 }),
        }),
      );
    case "multiChoice":
      return fc.oneof(
        answered,
        fc.record({
          op: fc.constant("contains"),
          questionId: fc.constant(questionId),
          value: fc.constantFrom(...OPTION_IDS),
        }),
        fc.record({
          op: fc.constant("containsAny"),
          questionId: fc.constant(questionId),
          values: fc.uniqueArray(fc.constantFrom(...OPTION_IDS), { minLength: 1 }),
        }),
      );
  }
}

function conditionArb(index: number, type: GenType): fc.Arbitrary<unknown> {
  const leaf = leafConditionArb(index, type);
  return fc.oneof(
    { weight: 3, arbitrary: leaf },
    leaf.map((condition) => ({ op: "not", condition })),
    fc
      .tuple(fc.constantFrom("and", "or"), leaf, leaf)
      .map(([op, a, b]) => ({ op, conditions: [a, b] })),
  );
}

/** Rules whose condition references an earlier question than their target
 * (forward-only, as publish guarantees). */
function rulesArb(questions: readonly GenQuestion[]): fc.Arbitrary<unknown[]> {
  if (questions.length < 2) {
    return fc.constant([]);
  }
  const ruleArb = fc
    .tuple(fc.nat({ max: questions.length - 2 }), fc.nat())
    .chain(([refIndex, targetSeed]) => {
      const targetIndex = refIndex + 1 + (targetSeed % (questions.length - 1 - refIndex));
      const reference = questions[refIndex];
      /* v8 ignore next 3 -- indices are in range by construction */
      if (reference === undefined) {
        return fc.constant(undefined);
      }
      return conditionArb(refIndex, reference.type).map((when) => ({
        ruleId: "rul_gen",
        when,
        show: [`q_g${String(targetIndex)}`],
      }));
    });
  return fc
    .array(ruleArb, { maxLength: 3 })
    .map((rules) => rules.filter((rule) => rule !== undefined));
}

interface GenCase {
  questions: readonly GenQuestion[];
  rules: unknown[];
  entries: readonly [string, AnswerValue][];
}

const caseArb: fc.Arbitrary<GenCase> = fc
  .array(genQuestionArb, { minLength: 1, maxLength: 6 })
  .chain((questions) =>
    fc
      .tuple(
        rulesArb(questions),
        fc.tuple(
          ...questions.map((question) =>
            fc.option(answerValueArb(question.type), { nil: undefined }),
          ),
        ),
      )
      .map(([rules, values]) => ({
        questions,
        rules,
        entries: values.flatMap((value, index): [string, AnswerValue][] =>
          value === undefined ? [] : [[`q_g${String(index)}`, value]],
        ),
      })),
  );

function setupOf(generated: GenCase): TestSetup {
  const steps: [string, TestQuestion[]][] = [];
  generated.questions.forEach((question, index) => {
    const testQuestion: TestQuestion = {
      id: `q_g${String(index)}`,
      type: question.type,
      required: question.required,
      ...(question.type === "singleChoice" || question.type === "multiChoice"
        ? { options: [...OPTION_IDS] }
        : {}),
    };
    const current = steps[steps.length - 1];
    if (current === undefined || (question.newStep && index > 0)) {
      steps.push([`stp_s${String(steps.length)}`, [testQuestion]]);
    } else {
      current[1].push(testQuestion);
    }
  });
  return build(steps, generated.rules);
}

describe("properties (fast-check)", () => {
  it("determinism: the same inputs evaluate to deep-equal FlowStates (I7)", () => {
    fc.assert(
      fc.property(caseArb, (generated) => {
        const setup = setupOf(generated);
        const answers = answersOf(generated.entries);
        const first = evaluateRules(setup.form, answers, setup.resolve);
        const second = evaluateRules(setup.form, answers, setup.resolve);
        expect(second).toEqual(first);
      }),
    );
  });

  it("totality: generated valid forms and type-correct answers always evaluate ok", () => {
    fc.assert(
      fc.property(caseArb, (generated) => {
        const setup = setupOf(generated);
        // Never throws; on publish-shaped input it also never errs.
        const result = evaluateRules(setup.form, answersOf(generated.entries), setup.resolve);
        expect(result.ok).toBe(true);
        // A version-1 snapshot wrapper changes nothing.
        const snapshot: FrozenSnapshot = {
          definition: setup.form,
          questions: [],
          semanticsVersion: SEMANTICS_VERSION,
          schemaVersion: 1,
        };
        expect(evaluateRules(snapshot, answersOf(generated.entries), setup.resolve)).toEqual(
          result,
        );
      }),
    );
  });

  it("answer-order independence: AnswerMap is a map, not a ledger", () => {
    fc.assert(
      fc.property(caseArb, (generated) => {
        const setup = setupOf(generated);
        const forward = answersOf(generated.entries);
        const reversed = answersOf([...generated.entries].reverse());
        expect(evaluateRules(setup.form, reversed, setup.resolve)).toEqual(
          evaluateRules(setup.form, forward, setup.resolve),
        );
      }),
    );
  });
});
