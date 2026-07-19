import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CONDITION_MAX_DEPTH,
  SEMANTICS_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  compileDraft,
  parseFormDefinition,
  parseQuestionDefinition,
  type DraftInput,
  type FormDefinition,
  type PublishError,
  type PublishResult,
  type QuestionDefinition,
  type QuestionId,
  type QuestionVersionRecord,
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
function makeForm(
  steps: readonly [string, readonly string[]][],
  rules: readonly unknown[],
  overrides: Record<string, unknown> = {},
): FormDefinition {
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
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`test form did not parse: ${JSON.stringify(result.error)}`);
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

function boolQ(questionId: string, extra: Record<string, unknown> = {}): QuestionDefinition {
  return makeQuestion({ questionId, type: "boolean", label: { en: questionId }, ...extra });
}

function textQ(questionId: string, extra: Record<string, unknown> = {}): QuestionDefinition {
  return makeQuestion({ questionId, type: "shortText", label: { en: questionId }, ...extra });
}

function multiQ(
  questionId: string,
  optionIds: readonly string[],
  labelFor: (optionId: string) => Record<string, string> = (optionId) => ({ en: optionId }),
): QuestionDefinition {
  return makeQuestion({
    questionId,
    type: "multiChoice",
    label: { en: questionId },
    options: optionIds.map((optionId) => ({ optionId, label: labelFor(optionId) })),
  });
}

function record(definition: QuestionDefinition, version = 1): QuestionVersionRecord {
  return { questionId: definition.questionId, version, definition };
}

/** In-memory question store: resolution plus the published-version set the
 * caller would load (versions listed in `unpublished` resolve but are not
 * published — the §4.2 QDraft case). */
function makeStore(
  records: readonly QuestionVersionRecord[],
  unpublished: readonly string[] = [],
): Pick<DraftInput, "resolveQuestion" | "publishedQuestionVersions"> {
  const byKey = new Map<string, QuestionVersionRecord>();
  const published = new Map<QuestionId, Set<number>>();
  for (const entry of records) {
    const key = `${entry.questionId}@${String(entry.version)}`;
    byKey.set(key, entry);
    if (!unpublished.includes(key)) {
      const versions = published.get(entry.questionId) ?? new Set<number>();
      versions.add(entry.version);
      published.set(entry.questionId, versions);
    }
  }
  return {
    resolveQuestion: (questionId, version) => byKey.get(`${questionId}@${String(version)}`),
    publishedQuestionVersions: published,
  };
}

/** Store over the task-003 question fixtures, published at versions 1 and 2
 * (the form fixtures pin q_smoker@2 and everything else @1). */
function fixtureStore(): Pick<DraftInput, "resolveQuestion" | "publishedQuestionVersions"> {
  const records: QuestionVersionRecord[] = [];
  for (const file of readdirSync(path.join(FIXTURES_DIR, "questions", "valid"))) {
    const definition = makeQuestion(readJson("questions", "valid", file));
    records.push(record(definition, 1), record(definition, 2));
  }
  return makeStore(records);
}

function errorsOf(result: PublishResult): readonly PublishError[] {
  if (result.ok) {
    throw new Error("expected err, got ok");
  }
  return result.error;
}

function snapshotOf(result: PublishResult) {
  if (!result.ok) {
    throw new Error(`expected ok, got errors: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`no element at ${String(index)}`);
  }
  return item;
}

/** Two-step base draft: q_a (boolean) then q_b (shortText), all published. */
function twoStepDraft(
  rules: readonly unknown[],
  overrides: Record<string, unknown> = {},
): DraftInput {
  return {
    definition: makeForm(
      [
        ["stp_one", ["q_a"]],
        ["stp_two", ["q_b"]],
      ],
      rules,
      overrides,
    ),
    ...makeStore([record(boolQ("q_a")), record(textQ("q_b"))]),
  };
}

const showBWhenA = {
  ruleId: "rul_one",
  when: { op: "equals", questionId: "q_a", value: true },
  show: ["q_b"],
};

describe("compileDraft — success path", () => {
  it("compiles the kitchen-sink, insurance, and minimal fixtures", () => {
    const store = fixtureStore();
    for (const file of ["kitchen-sink.json", "insurance.json", "minimal.json"]) {
      const definition = loadForm(file);
      const snapshot = snapshotOf(compileDraft({ definition, ...store }));
      expect(snapshot.definition).toEqual(definition);
      expect(snapshot.semanticsVersion).toBe(SEMANTICS_VERSION);
      expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
      // Resolved records are embedded per pin, in document order.
      expect(
        snapshot.questions.map((entry) => `${entry.questionId}@${String(entry.version)}`),
      ).toEqual(
        definition.steps.flatMap((step) =>
          step.items.map((item) => `${item.questionId}@${String(item.version)}`),
        ),
      );
    }
  });

  it("embeds the pinned version's definition, not some other version", () => {
    const snapshot = snapshotOf(compileDraft(twoStepDraft([showBWhenA])));
    expect(at(snapshot.questions, 0).definition.type).toBe("boolean");
    expect(at(snapshot.questions, 1).definition.type).toBe("shortText");
  });

  it("deep-freezes the snapshot: mutation throws in strict mode (I1)", () => {
    const snapshot = snapshotOf(compileDraft(twoStepDraft([showBWhenA])));

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.definition)).toBe(true);
    expect(Object.isFrozen(snapshot.definition.steps)).toBe(true);
    expect(Object.isFrozen(at(snapshot.definition.rules, 0))).toBe(true);
    expect(Object.isFrozen(at(snapshot.questions, 0).definition)).toBe(true);

    expect(() => {
      (snapshot as { semanticsVersion: number }).semanticsVersion = 99;
    }).toThrowError(TypeError);
    expect(() => {
      (snapshot.definition.title as Record<string, string>)["en"] = "mutated";
    }).toThrowError(TypeError);
    expect(() => {
      (snapshot.definition.steps as unknown as unknown[]).push({});
    }).toThrowError(TypeError);
    expect(() => {
      (at(snapshot.questions, 0).definition.label as Record<string, string>)["en"] = "mutated";
    }).toThrowError(TypeError);
  });

  it("freezes a clone: the caller's draft definition stays editable", () => {
    const draft = twoStepDraft([showBWhenA]);
    const snapshot = snapshotOf(compileDraft(draft));
    expect(Object.isFrozen(draft.definition)).toBe(false);
    expect(snapshot.definition).not.toBe(draft.definition);
    // Editing the draft afterwards does not leak into the snapshot.
    (draft.definition.title as Record<string, string>)["en"] = "edited";
    expect(snapshot.definition.title).toEqual({ en: "Test" });
  });

  it("is deterministic: same draft and lookups yield a structurally identical snapshot (I7)", () => {
    const draft = twoStepDraft([showBWhenA]);
    const first = snapshotOf(compileDraft(draft));
    const second = snapshotOf(compileDraft(draft));
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).not.toBe(first);
  });
});

describe("compileDraft — each invariant violated alone yields only its error", () => {
  it("DANGLING_QUESTION_REF: a pin that does not resolve", () => {
    const draft = twoStepDraft([showBWhenA]);
    const errors = errorsOf(
      compileDraft({ ...draft, ...makeStore([record(boolQ("q_a"))]) }), // q_b missing
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "DANGLING_QUESTION_REF",
        path: { question: "q_b", step: "stp_two" },
      }),
    ]);
  });

  it("DANGLING_QUESTION_REF: a resolver returning a mismatched record is unresolvable", () => {
    const draft = twoStepDraft([showBWhenA]);
    const errors = errorsOf(
      compileDraft({
        ...draft,
        // Misbehaving lookup: answers the q_b pin with version 7's content.
        resolveQuestion: (questionId, version) =>
          questionId === "q_b"
            ? record(textQ("q_b"), 7)
            : draft.resolveQuestion(questionId, version),
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "DANGLING_QUESTION_REF",
        path: { question: "q_b", step: "stp_two" },
      }),
    ]);
  });

  it("UNPUBLISHED_QUESTION_PIN: a pin onto a draft (unpublished) version", () => {
    const draft = twoStepDraft([showBWhenA]);
    const errors = errorsOf(
      compileDraft({
        ...draft,
        ...makeStore([record(boolQ("q_a")), record(textQ("q_b"))], ["q_b@1"]),
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "UNPUBLISHED_QUESTION_PIN",
        path: { step: "stp_two", question: "q_b", version: 1 },
      }),
    ]);
  });

  it("DANGLING_QUESTION_REF: a rule reading a question not pinned in the form", () => {
    const errors = errorsOf(
      compileDraft(
        twoStepDraft([
          { ruleId: "rul_one", when: { op: "answered", questionId: "q_missing" }, show: ["q_b"] },
        ]),
      ),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "DANGLING_QUESTION_REF",
        path: { question: "q_missing", rule: "rul_one" },
      }),
    ]);
  });

  it("DANGLING_QUESTION_REF: a rule showing a question not pinned in the form", () => {
    const errors = errorsOf(
      compileDraft(
        twoStepDraft([
          { ruleId: "rul_one", when: { op: "answered", questionId: "q_a" }, show: ["q_missing"] },
        ]),
      ),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "DANGLING_QUESTION_REF",
        path: { question: "q_missing", rule: "rul_one" },
      }),
    ]);
  });

  it("DANGLING_STEP_REF: a rule showing a step not in the form", () => {
    const errors = errorsOf(
      compileDraft(
        twoStepDraft([
          { ruleId: "rul_one", when: { op: "answered", questionId: "q_a" }, show: ["stp_missing"] },
        ]),
      ),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "DANGLING_STEP_REF",
        path: { rule: "rul_one", step: "stp_missing" },
      }),
    ]);
  });

  it("DANGLING_OPTION_REF: a rule referencing an option the pinned version does not declare", () => {
    const definition = makeForm(
      [
        ["stp_one", ["q_m"]],
        ["stp_two", ["q_b"]],
      ],
      [
        {
          ruleId: "rul_one",
          when: { op: "contains", questionId: "q_m", value: "opt_missing" },
          show: ["q_b"],
        },
      ],
    );
    const errors = errorsOf(
      compileDraft({
        definition,
        ...makeStore([record(multiQ("q_m", ["opt_a"])), record(textQ("q_b"))]),
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "DANGLING_OPTION_REF",
        path: { rule: "rul_one", question: "q_m", option: "opt_missing" },
      }),
    ]);
  });

  it("RULE_BACKWARD_TARGET: a target at or before a referenced question (ADR-16)", () => {
    const errors = errorsOf(
      compileDraft(
        twoStepDraft([
          { ruleId: "rul_one", when: { op: "answered", questionId: "q_b" }, show: ["q_a"] },
        ]),
      ),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "RULE_BACKWARD_TARGET",
        path: { rule: "rul_one", target: "q_a" },
      }),
    ]);
  });

  it("RULE_CYCLE: a reads→shows cycle (with its structurally unavoidable backward edge)", () => {
    // Any cycle must contain at least one backward edge in document order, so
    // the two ADR-16 findings co-occur by construction; both are graph errors
    // of the same invariant (I10) and nothing else fires.
    const errors = errorsOf(
      compileDraft(
        twoStepDraft([
          { ruleId: "rul_one", when: { op: "answered", questionId: "q_a" }, show: ["q_b"] },
          { ruleId: "rul_two", when: { op: "answered", questionId: "q_b" }, show: ["q_a"] },
        ]),
      ),
    );
    expect(errors.map((entry) => entry.code).sort()).toEqual([
      "RULE_BACKWARD_TARGET",
      "RULE_CYCLE",
    ]);
    const cycle = errors.find((entry) => entry.code === "RULE_CYCLE");
    expect(cycle?.path).toEqual({ rules: ["rul_one", "rul_two"] });
  });

  it("RULE_TYPE_MISMATCH: an operator applied to an incompatible question type", () => {
    const errors = errorsOf(
      compileDraft(
        twoStepDraft([
          { ruleId: "rul_one", when: { op: "gt", questionId: "q_a", value: 1 }, show: ["q_b"] },
        ]),
      ),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "RULE_TYPE_MISMATCH",
        path: { rule: "rul_one", question: "q_a" },
      }),
    ]);
  });

  it("RULE_DEPTH_EXCEEDED: the condition nesting cap is enforced at publish too", () => {
    const base = twoStepDraft([]);
    let when: unknown = { op: "answered", questionId: "q_a" };
    for (let i = 0; i < CONDITION_MAX_DEPTH; i += 1) {
      when = { op: "not", condition: when };
    }
    // Cast justified: parseFormDefinition rejects an over-deep rule at parse,
    // so a definition carrying one can only be hand-built; compileDraft must
    // still report it (the type does not prove the refinements ran).
    const definition = {
      ...base.definition,
      rules: [{ ruleId: "rul_deep", when, show: ["q_b"] }],
    } as FormDefinition;
    const errors = errorsOf(compileDraft({ ...base, definition }));
    expect(errors).toEqual([
      expect.objectContaining({ code: "RULE_DEPTH_EXCEEDED", path: { rule: "rul_deep" } }),
    ]);
  });

  it("DUPLICATE_STEP_ID: re-checked with a domain path on hand-built definitions", () => {
    const base = twoStepDraft([]);
    const stepOne = at(base.definition.steps, 0);
    const stepTwo = at(base.definition.steps, 1);
    const definition: FormDefinition = {
      ...base.definition,
      steps: [stepOne, { ...stepTwo, stepId: stepOne.stepId }],
    };
    const errors = errorsOf(compileDraft({ ...base, definition }));
    expect(errors).toEqual([
      expect.objectContaining({ code: "DUPLICATE_STEP_ID", path: { step: "stp_one" } }),
    ]);
  });

  it("DUPLICATE_QUESTION_IN_FORM: re-checked with a domain path on hand-built definitions", () => {
    const base = twoStepDraft([]);
    const stepOne = at(base.definition.steps, 0);
    const stepTwo = at(base.definition.steps, 1);
    const definition: FormDefinition = {
      ...base.definition,
      steps: [stepOne, { ...stepTwo, items: [at(stepOne.items, 0)] }],
    };
    const errors = errorsOf(compileDraft({ ...base, definition }));
    expect(errors).toEqual([
      expect.objectContaining({
        code: "DUPLICATE_QUESTION_IN_FORM",
        path: { step: "stp_two", question: "q_a" },
      }),
    ]);
  });

  it("LOCALE_INCOMPLETE: form title missing the default locale (I3)", () => {
    const errors = errorsOf(compileDraft(twoStepDraft([], { title: { fr: "Essai" } })));
    expect(errors).toEqual([
      expect.objectContaining({ code: "LOCALE_INCOMPLETE", path: { locale: "en" } }),
    ]);
  });

  it("LOCALE_INCOMPLETE: step title missing the default locale", () => {
    const parsed = parseFormDefinition({
      formId: "frm_test",
      defaultLocale: "en",
      title: { en: "Test" },
      steps: [
        { stepId: "stp_one", title: { en: "One" }, items: [{ questionId: "q_a", version: 1 }] },
        { stepId: "stp_two", title: { fr: "Deux" }, items: [{ questionId: "q_b", version: 1 }] },
      ],
      rules: [],
    });
    if (!parsed.ok) {
      throw new Error("test form did not parse");
    }
    const errors = errorsOf(
      compileDraft({
        definition: parsed.value,
        ...makeStore([record(boolQ("q_a")), record(textQ("q_b"))]),
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "LOCALE_INCOMPLETE",
        path: { locale: "en", step: "stp_two" },
      }),
    ]);
  });

  it("LOCALE_INCOMPLETE: pinned question label missing the default locale", () => {
    const draft = twoStepDraft([]);
    const errors = errorsOf(
      compileDraft({
        ...draft,
        ...makeStore([
          record(boolQ("q_a")),
          record(makeQuestion({ questionId: "q_b", type: "shortText", label: { fr: "B" } })),
        ]),
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "LOCALE_INCOMPLETE",
        path: { locale: "en", question: "q_b" },
      }),
    ]);
  });

  it("LOCALE_INCOMPLETE: optional help text, when present, must carry the default locale", () => {
    const draft = twoStepDraft([]);
    const errors = errorsOf(
      compileDraft({
        ...draft,
        ...makeStore([record(boolQ("q_a", { help: { fr: "Aide" } })), record(textQ("q_b"))]),
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "LOCALE_INCOMPLETE",
        path: { locale: "en", question: "q_a" },
      }),
    ]);
  });

  it("LOCALE_INCOMPLETE: option label missing the default locale", () => {
    const definition = makeForm([["stp_one", ["q_m"]]], []);
    const errors = errorsOf(
      compileDraft({
        definition,
        ...makeStore([
          record(
            multiQ("q_m", ["opt_a", "opt_b"], (optionId) =>
              optionId === "opt_b" ? { fr: "Bé" } : { en: optionId },
            ),
          ),
        ]),
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "LOCALE_INCOMPLETE",
        path: { locale: "en", question: "q_m", option: "opt_b" },
      }),
    ]);
  });
});

describe("compileDraft — error accumulation", () => {
  it("a draft violating three invariants reports all three in one result", () => {
    // I2 (dangling pin) + I2 (dangling step target) + I3 (locale) at once.
    const draft = twoStepDraft(
      [{ ruleId: "rul_one", when: { op: "answered", questionId: "q_a" }, show: ["stp_missing"] }],
      { title: { fr: "Essai" } },
    );
    const errors = errorsOf(
      compileDraft({ ...draft, ...makeStore([record(boolQ("q_a"))]) }), // q_b missing
    );
    expect(errors).toHaveLength(3);
    expect(errors.map((entry) => entry.code).sort()).toEqual([
      "DANGLING_QUESTION_REF",
      "DANGLING_STEP_REF",
      "LOCALE_INCOMPLETE",
    ]);
  });

  it("error order is deterministic across calls", () => {
    const draft = twoStepDraft(
      [{ ruleId: "rul_one", when: { op: "answered", questionId: "q_a" }, show: ["stp_missing"] }],
      { title: { fr: "Essai" } },
    );
    const store = makeStore([record(boolQ("q_a"))]);
    const first = errorsOf(compileDraft({ ...draft, ...store }));
    const second = errorsOf(compileDraft({ ...draft, ...store }));
    expect(second).toEqual(first);
  });
});
