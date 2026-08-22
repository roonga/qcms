import { describe, expect, it } from "vitest";

import type { A2UIStepDocument } from "@qcms/ui";

import { commitMoments, documentForVisible, questionLabels, questionPositions } from "./visible";

/**
 * The portal renders only the questions the API's flow projection marks visible,
 * so a conditional follow-up appears / disappears (screen contract branch states). The
 * insurance step: q_at_fault_accident always visible; q_accident_count visible only after "Yes".
 */
const stepDoc = {
  stepId: "stp_history",
  root: {
    type: "Form",
    children: [
      {
        type: "Flex",
        props: { direction: "column" },
        children: [
          { type: "Text", props: { as: "h1" }, children: "Vehicle insurance quote" },
          {
            type: "RadioGroup",
            props: {
              name: "q_at_fault_accident",
              label: "Any at-fault accident in the last 3 years?",
            },
            children: [{ type: "Radio", props: { value: "true", label: "Yes" } }],
          },
          { type: "NumberField", props: { name: "q_accident_count", label: "How many?" } },
        ],
      },
    ],
  },
} as unknown as A2UIStepDocument;

function serialize(doc: A2UIStepDocument): string {
  return JSON.stringify(doc);
}

describe("documentForVisible", () => {
  it("drops a question that is not in the visible set (branch removed)", () => {
    const pruned = documentForVisible(stepDoc, ["q_at_fault_accident"]);
    expect(serialize(pruned)).toContain("q_at_fault_accident");
    expect(serialize(pruned)).not.toContain("q_accident_count");
  });

  it("keeps a follow-up once it becomes visible (branch inserted)", () => {
    const pruned = documentForVisible(stepDoc, ["q_at_fault_accident", "q_accident_count"]);
    expect(serialize(pruned)).toContain("q_at_fault_accident");
    expect(serialize(pruned)).toContain("q_accident_count");
  });

  it("keeps layout and text nodes (no name) regardless of the visible set", () => {
    const pruned = documentForVisible(stepDoc, []);
    const text = serialize(pruned);
    expect(text).toContain("Vehicle insurance quote");
    expect(text).not.toContain("q_at_fault_accident");
  });

  it("does not mutate the input document", () => {
    const before = serialize(stepDoc);
    documentForVisible(stepDoc, ["q_at_fault_accident"]);
    expect(serialize(stepDoc)).toBe(before);
  });
});

/**
 * The label map behind the error summary's per-question wording (issue #21). It
 * uses the same convention as the projection above: a node is a question iff it
 * carries a string `name`, so an option (a Radio, labelled but unnamed) is never
 * mistaken for a question.
 */
describe("questionLabels", () => {
  it("maps every named question in the tree to its label", () => {
    expect([...questionLabels(stepDoc)]).toEqual([
      ["q_at_fault_accident", "Any at-fault accident in the last 3 years?"],
      ["q_accident_count", "How many?"],
    ]);
  });

  it("omits a named node with no usable label (e.g. the honeypot)", () => {
    const doc = {
      stepId: "stp_about",
      root: {
        type: "Form",
        children: [
          { type: "TextField", props: { name: "q_full_name", label: "Full name" } },
          { type: "Honeypot", props: { name: "website", ariaHidden: true } },
          { type: "TextField", props: { name: "q_blank", label: "   " } },
        ],
      },
    } as unknown as A2UIStepDocument;

    expect([...questionLabels(doc)]).toEqual([["q_full_name", "Full name"]]);
  });
});

/**
 * The ordinal a label-less question is named by in the error summary (issue
 * #326). It counts the step's VISIBLE questions, in document order, because that
 * is what the respondent sees: `documentForVisible` above prunes on exactly the
 * same predicate, so position N here is the Nth field the renderer draws.
 */
describe("questionPositions", () => {
  const doc = {
    stepId: "stp_about",
    root: {
      type: "Form",
      children: [
        { type: "TextField", props: { name: "q_full_name", label: "Full name" } },
        { type: "TextField", props: { name: "q_hidden", label: "Hidden follow-up" } },
        { type: "Text", props: { as: "p" }, children: "A layout node carries no name." },
        { type: "TextField", props: { name: "q_blank", label: "   " } },
      ],
    },
  } as unknown as A2UIStepDocument;

  it("numbers the visible questions 1..n in document order", () => {
    expect([...questionPositions(doc, ["q_full_name", "q_hidden", "q_blank"])]).toEqual([
      ["q_full_name", 1],
      ["q_hidden", 2],
      ["q_blank", 3],
    ]);
  });

  it("skips a question the flow hides, so positions match what is drawn", () => {
    // q_blank is the SECOND field on the page once q_hidden is pruned, and a
    // whole-document numbering would have called it the third.
    expect([...questionPositions(doc, ["q_full_name", "q_blank"])]).toEqual([
      ["q_full_name", 1],
      ["q_blank", 2],
    ]);
  });

  it("gives no position to a question outside the visible set", () => {
    expect(questionPositions(doc, ["q_full_name"]).has("q_hidden")).toBe(false);
  });

  it("numbers a question the document does not carry as absent, not as zero", () => {
    expect(questionPositions(doc, ["q_full_name", "q_unknown"]).get("q_unknown")).toBeUndefined();
  });

  it("falls back to the visible set's own order when there is no document", () => {
    // The API lists `visibleQuestions` in document order too (ADR-16's forward
    // pass), so a completed flow with no step document still numbers correctly.
    expect([...questionPositions(null, ["q_full_name", "q_blank"])]).toEqual([
      ["q_full_name", 1],
      ["q_blank", 2],
    ]);
  });

  it("ignores a question a layout duplicates, keeping its first place", () => {
    expect(questionPositions(doc, ["q_blank", "q_full_name"]).get("q_full_name")).toBe(1);
  });
});

/**
 * WHEN each answer commits, per ADR-31 (issue #31). A single-choice OptionId, a
 * date and a long-text answer are all strings on the wire, so the flow cannot
 * tell them apart from the value: the control kind in the compiled document is
 * what carries the commit moment. This is the pure half of the fix - that the
 * portal actually posts at each moment and not before is asserted in the browser
 * (`apps/portal/e2e/commit-moments.pw.ts`, ADR-23).
 */
describe("commitMoments", () => {
  it("reports the radio group as change and the number field as blur", () => {
    expect([...commitMoments(stepDoc)]).toEqual([
      ["q_at_fault_accident", "change"],
      ["q_accident_count", "blur"],
    ]);
  });

  it("maps every control in ADR-31's table to its commit moment", () => {
    const doc = {
      stepId: "stp_mixed",
      root: {
        type: "Form",
        children: [
          { type: "Text", props: { as: "h1" }, children: "Everything" },
          {
            type: "RadioGroup",
            props: { name: "q_coverage_level" },
            children: [{ type: "Radio", props: { value: "opt_basic", label: "Basic" } }],
          },
          { type: "Select", props: { name: "q_long_list" } },
          { type: "CheckboxGroup", props: { name: "q_optional_cover" } },
          { type: "TextField", props: { name: "q_full_name" } },
          { type: "TextArea", props: { name: "q_extra_detail" } },
          { type: "NumberField", props: { name: "q_accident_count" } },
          { type: "DatePicker", props: { name: "q_dob" } },
        ],
      },
    } as unknown as A2UIStepDocument;

    expect([...commitMoments(doc)]).toEqual([
      // boolean / singleChoice up to 7 options
      ["q_coverage_level", "change"],
      // singleChoice above 7 options
      ["q_long_list", "change"],
      // multiChoice: NOT on change, unlike every other selection control
      ["q_optional_cover", "groupExit"],
      // shortText: not listed in ADR-31's table, read as unchanged
      ["q_full_name", "blur"],
      ["q_extra_detail", "blur"],
      ["q_accident_count", "blur"],
      // the only control with a completion signal distinct from blur
      ["q_dob", "completion"],
    ]);
  });

  it("never reports an option child, which is labelled but unnamed", () => {
    const doc = {
      stepId: "stp_cover",
      root: {
        type: "RadioGroup",
        props: { name: "q_coverage_level" },
        children: [
          { type: "Radio", props: { value: "opt_basic", label: "Basic" } },
          { type: "Radio", props: { value: "opt_premium", label: "Premium" } },
        ],
      },
    } as unknown as A2UIStepDocument;

    expect([...commitMoments(doc)]).toEqual([["q_coverage_level", "change"]]);
  });

  it("omits an unrecognized control, so the caller falls back to the safe moment", () => {
    const doc = {
      stepId: "stp_future",
      root: {
        type: "Form",
        children: [
          { type: "ColorPicker", props: { name: "q_future" } },
          { type: "RadioGroup", props: { name: "q_known" } },
        ],
      },
    } as unknown as A2UIStepDocument;

    const moments = commitMoments(doc);
    expect(moments.has("q_future")).toBe(false);
    expect(moments.get("q_known")).toBe("change");
  });
});
