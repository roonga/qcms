import {
  type AnswerMap,
  type AnswerValue,
  evaluateRules,
  type FlowState,
  type InstanceId,
  parseFormDefinition,
  parseQuestionDefinition,
  type QuestionDefinition,
  type QuestionId,
  type StepId,
} from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { lastReachableView, railEntries, stepViewsOf } from "./steps.js";

const QUESTIONS = [
  { type: "boolean", questionId: "q_accident", label: { en: "Any accident?" }, required: true },
  { type: "number", questionId: "q_count", label: { en: "How many?" }, required: true },
  { type: "shortText", questionId: "q_name", label: { en: "Your name" }, required: true },
].map((raw) => {
  const parsed = parseQuestionDefinition(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
});
const byId = new Map<string, QuestionDefinition>(QUESTIONS.map((q) => [q.questionId, q]));

const FORM = (() => {
  const parsed = parseFormDefinition({
    formId: "frm_rail",
    defaultLocale: "en",
    title: { en: "Rail" },
    steps: [
      { stepId: "stp_a", title: { en: "A" }, items: [{ questionId: "q_accident", version: 1 }] },
      { stepId: "stp_b", title: { en: "B" }, items: [{ questionId: "q_count", version: 1 }] },
      { stepId: "stp_c", title: { en: "C" }, items: [{ questionId: "q_name", version: 1 }] },
    ],
    rules: [
      {
        ruleId: "rul_count",
        when: { op: "equals", questionId: "q_accident", value: true },
        show: ["q_count"],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
})();
const STEPS = FORM.steps.map((step) => step.stepId);

function flowOf(answers: Record<string, AnswerValue>): FlowState {
  const map: AnswerMap = new Map(
    Object.entries(answers).map(([key, value]) => [key as QuestionId, value]),
  );
  const result = evaluateRules(FORM, map, (questionId) => byId.get(questionId));
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** The rail as the handler derives it, with the resume point the no-cursor serve picks. */
function rail(flow: FlowState, servedIndex: number) {
  const views = stepViewsOf(flow);
  const resume = flow.currentStep === null ? views.length : views.findIndex((v) => v.stepId === flow.currentStep);
  return railEntries({ steps: STEPS, views, servedIndex, resumeIndex: resume }).map(
    (entry) => [entry.stepId, entry.state, entry.cursor] as const,
  );
}

describe("rail state derivation (X1)", () => {
  it("names every step, with a rule-hidden one Not needed rather than dropped", () => {
    const flow = flowOf({});
    expect(rail(flow, 0)).toEqual([
      ["stp_a", "current", null],
      ["stp_b", "notNeeded", null],
      ["stp_c", "ahead", null],
    ]);
  });

  it("links completed steps by their cursor and leaves the rest unlinked", () => {
    const flow = flowOf({ q_accident: true, q_count: 2 });
    expect(rail(flow, 2)).toEqual([
      ["stp_a", "completed", 0],
      ["stp_b", "completed", 1],
      ["stp_c", "current", null],
    ]);
  });

  it("keeps a step between a back-jump and the resume point completed", () => {
    const flow = flowOf({ q_accident: true, q_count: 2 });
    expect(rail(flow, 0)).toEqual([
      ["stp_a", "current", null],
      ["stp_b", "completed", 1],
      ["stp_c", "ahead", null],
    ]);
  });

  it("turns a step Not needed when a back-jump changes the answer that showed it", () => {
    const before = flowOf({ q_accident: true, q_count: 2 });
    expect(rail(before, 0)[1]).toEqual(["stp_b", "completed", 1]);

    const after = flowOf({ q_accident: false, q_count: 2 });
    expect(rail(after, 0)).toEqual([
      ["stp_a", "current", null],
      ["stp_b", "notNeeded", null],
      ["stp_c", "ahead", null],
    ]);
    expect(stepViewsOf(after)).toHaveLength(2);
  });

  it("marks every visible step completed once nothing is left to render", () => {
    const flow = flowOf({ q_accident: false, q_name: "Ada" });
    expect(flow.currentStep).toBeNull();
    expect(rail(flow, stepViewsOf(flow).length)).toEqual([
      ["stp_a", "completed", 0],
      ["stp_b", "notNeeded", null],
      ["stp_c", "completed", 1],
    ]);
  });
});

describe("the furthest view Continue could reach (forward refusal)", () => {
  it("stops at the first step still missing a required answer", () => {
    expect(lastReachableView(flowOf({}), stepViewsOf(flowOf({})), new Set())).toBe(0);
    const revealed = flowOf({ q_accident: true });
    expect(lastReachableView(revealed, stepViewsOf(revealed), new Set())).toBe(1);
    const answered = flowOf({ q_accident: true, q_count: 2 });
    expect(lastReachableView(answered, stepViewsOf(answered), new Set())).toBe(2);
  });

  it("reaches every view once the flow is complete", () => {
    const flow = flowOf({ q_accident: false, q_name: "Ada" });
    expect(lastReachableView(flow, stepViewsOf(flow), new Set())).toBe(1);
  });

  it("stops at a step owed a roster mint even when nothing required is missing", () => {
    const flow = flowOf({ q_accident: false, q_name: "Ada" });
    expect(lastReachableView(flow, stepViewsOf(flow), new Set(["stp_a" as StepId]))).toBe(0);
  });

  it("covers every page of the blocking step, since its own questions are on each", () => {
    const views = [
      { stepId: "stp_a" as StepId, instanceId: null },
      { stepId: "stp_b" as StepId, instanceId: "ins_one" as InstanceId },
      { stepId: "stp_b" as StepId, instanceId: "ins_two" as InstanceId },
      { stepId: "stp_c" as StepId, instanceId: null },
    ];
    const flow = { complete: false, currentStep: "stp_b", visibleStepViews: views } as unknown as FlowState;
    expect(lastReachableView(flow, views, new Set())).toBe(2);
    expect(
      railEntries({ steps: STEPS, views, servedIndex: 0, resumeIndex: 2 }).map((e) => e.state),
    ).toEqual(["current", "ahead", "ahead"]);
  });
});
