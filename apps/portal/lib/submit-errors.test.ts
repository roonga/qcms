import type { A2UIStepDocument } from "@roonga/qcms-ui";
import { describe, expect, it } from "vitest";

import { authoredFieldErrors } from "./error-summary";
import {
  contextRefusals,
  NO_SUBMIT_REFUSAL,
  otherStepErrors,
  otherStepMessage,
  refusedFields,
  submitRefusal,
  withoutField,
} from "./submit-errors";

/** The submit slice's 422 detail, as the BFF forwards it. */
function detail(errors: readonly unknown[]): unknown {
  return { missingRequired: [], errors };
}

const MISSING = "This question needs an answer.";
const GENERIC = "That answer is not valid.";

describe("reading the sweep's verdict", () => {
  it("splits an unanswered required question from a refused value", () => {
    const refusal = submitRefusal(
      detail([
        { code: "MISSING_REQUIRED", message: "x", questionId: "q_dob" },
        {
          code: "INVALID_ANSWER",
          message: "x",
          questionId: "q_full_name",
          errors: [{ code: "PATTERN_MISMATCH", constraint: "pattern", message: "Letters only" }],
        },
      ]),
    );

    expect(refusal.missingRequired).toEqual(["q_dob"]);
    expect(refusal.invalid).toEqual({
      q_full_name: { constraint: "pattern", message: "Letters only" },
    });
    expect(refusedFields(refusal)).toEqual(["q_dob", "q_full_name"]);
  });

  it("keys a question inside a repeating group the way the API keys its answer", () => {
    const refusal = submitRefusal(
      detail([
        { code: "MISSING_REQUIRED", message: "x", questionId: "q_name", instanceId: "ins_7k2" },
        {
          code: "INVALID_ANSWER",
          message: "x",
          questionId: "q_age",
          instanceId: "ins_9m4",
          errors: [{ code: "VALUE_ABOVE_MAX", constraint: "max", message: "Too high" }],
        },
      ]),
    );

    expect(refusal.missingRequired).toEqual(["ins_7k2/q_name"]);
    expect(Object.keys(refusal.invalid)).toEqual(["ins_9m4/q_age"]);
  });

  it("falls back to the catalogue when the refusal carries no message of its own", () => {
    const refusal = submitRefusal(
      detail([{ code: "INVALID_ANSWER", message: "x", questionId: "q_full_name", errors: [] }]),
    );

    expect(refusal.invalid.q_full_name).toEqual({ constraint: undefined, message: GENERIC });
  });

  it("leaves the entries with no field to report against to the page-level notice", () => {
    const refusal = submitRefusal(
      detail([
        { code: "REPEAT_COUNT_OUT_OF_RANGE", message: "x", groupId: "grp_cars", count: 0 },
        { code: "UNKNOWN_QUESTION", message: "x", questionId: "q_gone" },
        { code: "FLOW_EVALUATION_FAILED", message: "x" },
      ]),
    );

    expect(refusal.missingRequired).toEqual([]);
    expect(refusal.invalid).toEqual({});
  });

  it("degrades to no refusal on anything that is not the envelope", () => {
    for (const details of [undefined, null, 7, "errors", {}, { errors: "no" }, { errors: [1] }]) {
      expect(submitRefusal(details).missingRequired).toEqual([]);
      expect(submitRefusal(details).invalid).toEqual({});
    }
  });

  it("drops only the field the respondent changed, and keeps the object when it has none", () => {
    const refusal = submitRefusal(
      detail([
        { code: "MISSING_REQUIRED", message: "x", questionId: "q_dob" },
        { code: "MISSING_REQUIRED", message: "x", questionId: "q_name" },
        {
          code: "INVALID_ANSWER",
          message: "x",
          questionId: "q_full_name",
          errors: [{ code: "PATTERN_MISMATCH", constraint: "pattern", message: "Letters only" }],
        },
      ]),
    );

    const afterDob = withoutField(refusal, "q_dob");
    expect(afterDob.missingRequired).toEqual(["q_name"]);
    expect(Object.keys(afterDob.invalid)).toEqual(["q_full_name"]);

    const afterName = withoutField(afterDob, "q_full_name");
    expect(afterName.invalid).toEqual({});
    expect(afterName.missingRequired).toEqual(["q_name"]);

    expect(withoutField(afterName, "q_elsewhere")).toBe(afterName);
    expect(withoutField(NO_SUBMIT_REFUSAL, "q_dob")).toBe(NO_SUBMIT_REFUSAL);
  });
});

function document(nodes: readonly Record<string, unknown>[]): A2UIStepDocument {
  return {
    stepId: "stp_about",
    root: { type: "Flex", children: nodes },
  } as unknown as A2UIStepDocument;
}

describe("the messages a step draws beside its own fields", () => {
  it("prefers the author's message for the constraint that failed", () => {
    const errors = authoredFieldErrors(
      document([
        {
          type: "TextField",
          props: { name: "q_full_name", messages: { pattern: "Letters, please" } },
        },
      ]),
      { q_full_name: { constraint: "pattern", message: "Letters only" } },
      ["q_full_name"],
    );

    expect(errors).toEqual({ q_full_name: "Letters, please" });
  });

  it("keeps the refusal's own message when the author wrote none for that constraint", () => {
    const errors = authoredFieldErrors(
      document([
        { type: "TextField", props: { name: "q_full_name", messages: { required: "Needed" } } },
      ]),
      { q_full_name: { constraint: "pattern", message: "Letters only" } },
      ["q_full_name"],
    );

    expect(errors).toEqual({ q_full_name: "Letters only" });
  });

  it("drops a refusal naming a question this step does not render", () => {
    const errors = authoredFieldErrors(
      document([{ type: "TextField", props: { name: "q_full_name" } }]),
      {
        q_full_name: { message: "Letters only" },
        q_dob: { message: "Too late" },
      },
      ["q_full_name"],
    );

    expect(errors).toEqual({ q_full_name: "Letters only" });
  });

  it("drops a refusal for a question a branch has hidden since the sweep read it", () => {
    const errors = authoredFieldErrors(
      document([{ type: "TextField", props: { name: "q_accident_count" } }]),
      { q_accident_count: { message: "Too high" } },
      [],
    );

    expect(errors).toEqual({});
  });

  it("resolves the no-JS context's parallel records the same way", () => {
    const refusals = contextRefusals({ q_full_name: "Letters only" }, { q_full_name: "pattern" });
    expect(refusals).toEqual({ q_full_name: { constraint: "pattern", message: "Letters only" } });

    const errors = authoredFieldErrors(
      document([
        {
          type: "TextField",
          props: { name: "q_full_name", messages: { pattern: "Letters, please" } },
        },
      ]),
      refusals,
      ["q_full_name"],
    );
    expect(errors).toEqual({ q_full_name: "Letters, please" });
  });
});

describe("the steps the respondent is not looking at", () => {
  const stepOfField = new Map([
    ["q_full_name", 0],
    ["q_dob", 0],
    ["q_at_fault_accident", 1],
  ]);

  it("groups by the step each field was last rendered at, lowest cursor first", () => {
    const grouped = otherStepErrors(
      ["q_at_fault_accident", "q_full_name", "q_dob", "q_medical_history", "q_coverage_level"],
      ["q_coverage_level"],
      stepOfField,
    );

    expect(grouped).toEqual([
      { stepIndex: 0, count: 2 },
      { stepIndex: 1, count: 1 },
      { stepIndex: undefined, count: 1 },
    ]);
    expect(grouped.map(otherStepMessage)).toEqual([
      "Step 1 has 2 answers to fix.",
      "Step 2 has 1 answer to fix.",
      "Another step has 1 answer to fix.",
    ]);
  });

  it("counts a question only once and never one on the rendered step", () => {
    expect(otherStepErrors(["q_dob", "q_dob"], ["q_full_name"], stepOfField)).toEqual([
      { stepIndex: 0, count: 1 },
    ]);
    expect(otherStepErrors(["q_dob"], ["q_dob"], stepOfField)).toEqual([]);
  });

  it("names more than one unplaced question in the plural", () => {
    expect(otherStepMessage({ stepIndex: undefined, count: 3 })).toBe(
      "Other steps have 3 answers to fix.",
    );
  });

  it("is the catalogue's own wording for a missing answer", () => {
    const refusal = submitRefusal(
      detail([{ code: "MISSING_REQUIRED", message: "x", questionId: "q_dob" }]),
    );
    expect(refusal.missingRequired).toEqual(["q_dob"]);
    // The required wording comes from the summary helpers, not from the refusal.
    expect(Object.values(refusal.invalid)).not.toContain(MISSING);
  });
});
