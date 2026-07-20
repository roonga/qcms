// The package's public barrel — the exact surface an external consumer imports.
// No deep reach into ./compile.js or ./step-resolver.js internals.
import {
  compileForm,
  compileFormWith,
  staticStepResolver,
  type A2UIDocument,
  type StepResolver,
  type StepResolverContext,
} from "./index.js";
import {
  compileDraft,
  parseFormDefinition,
  parseQuestionVersionRecord,
  type FrozenSnapshot,
  type QuestionId,
  type QuestionVersionRecord,
  type Step,
} from "@qcms/core";
import { describe, expect, it } from "vitest";

/**
 * Step-resolver seam conformance (task 012). Proves the `StepResolver` seam
 * from task 011 (ARCHITECTURE §12) is implementable **from outside the package**
 * — everything here imports from the published `@qcms/a2ui-compiler` surface, no
 * deep `./compile.js`/`./step-resolver.js` reach into compiler internals. A
 * Phase-4 adaptive/agent resolver (ADR-25, authoring-time only) would sit
 * exactly where this test double sits: implement the interface, hand it to
 * `compileFormWith`, and the compiler routes every step through it while still
 * owning the version stamps.
 */

/** A tiny two-step snapshot built through the real publish path (`compileDraft`). */
function buildSnapshot(): FrozenSnapshot {
  const en = (value: string): { en: string } => ({ en: value });
  const rawQuestions = [
    {
      questionId: "q_name",
      version: 1,
      definition: {
        type: "shortText",
        questionId: "q_name",
        label: en("Name"),
        required: true,
      },
    },
    {
      questionId: "q_smoker",
      version: 1,
      definition: { type: "boolean", questionId: "q_smoker", label: en("Smoker?") },
    },
  ];
  const records: QuestionVersionRecord[] = rawQuestions.map((raw) => {
    const parsed = parseQuestionVersionRecord(raw);
    if (!parsed.ok) {
      throw new Error(`seam fixture question invalid: ${JSON.stringify(parsed.error)}`);
    }
    return parsed.value;
  });
  const form = parseFormDefinition({
    formId: "frm_seam",
    defaultLocale: "en",
    title: en("Seam"),
    steps: [
      { stepId: "stp_one", title: en("One"), items: [{ questionId: "q_name", version: 1 }] },
      { stepId: "stp_two", title: en("Two"), items: [{ questionId: "q_smoker", version: 1 }] },
    ],
    rules: [],
  });
  if (!form.ok) {
    throw new Error(`seam fixture form invalid: ${JSON.stringify(form.error)}`);
  }
  const byPin = new Map(records.map((r) => [`${r.questionId} ${String(r.version)}`, r]));
  const result = compileDraft({
    definition: form.value,
    resolveQuestion: (questionId, version) => byPin.get(`${questionId} ${String(version)}`),
    publishedQuestionVersions: new Map<QuestionId, ReadonlySet<number>>(
      records.map((r) => [r.questionId, new Set([r.version])]),
    ),
  });
  if (!result.ok) {
    throw new Error(`seam fixture did not publish: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const snapshot = buildSnapshot();

describe("StepResolver seam is implementable from the public surface", () => {
  it("routes every step through an externally-authored resolver double", () => {
    // A stub standing in for a Phase-4 adaptive resolver, written against only
    // the exported StepResolver / StepResolverContext types.
    const seen: string[] = [];
    const stub: StepResolver = {
      resolveStep: (step: Step, context: StepResolverContext): A2UIDocument => {
        seen.push(step.stepId);
        // The context carries everything a resolver needs — no I/O of its own.
        return {
          stepId: step.stepId,
          root: {
            type: "Text",
            props: { as: "h2" },
            children: `${context.isFirstStep ? "first:" : "rest:"}${context.resolveText(step.title)}`,
          },
        };
      },
    };

    const compiled = compileFormWith(stub, snapshot, {});

    expect(seen).toEqual(["stp_one", "stp_two"]);
    expect(compiled.documents).toEqual([
      { stepId: "stp_one", root: { type: "Text", props: { as: "h2" }, children: "first:One" } },
      { stepId: "stp_two", root: { type: "Text", props: { as: "h2" }, children: "rest:Two" } },
    ]);
    // The compiler owns the version stamps, not the resolver.
    expect(compiled.compilerVersion).toBe("0.1.0");
    expect(compiled.a2uiSpecVersion).toBe("1.0.0-preview.7");
  });

  it("compileForm is compileFormWith(staticStepResolver): same output", () => {
    expect(compileFormWith(staticStepResolver, snapshot, {})).toEqual(compileForm(snapshot, {}));
  });
});
