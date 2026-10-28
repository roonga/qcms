import { describe, expect, it } from "vitest";

import type { A2UIStepDocument } from "@roonga/qcms-ui";

import {
  commitMoments,
  documentForVisible,
  instanceLabels,
  questionLabels,
  questionPositions,
} from "./visible";

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
    expect([...questionPositions(null, ["q_full_name", "q_blank"])]).toEqual([
      ["q_full_name", 1],
      ["q_blank", 2],
    ]);
  });

  it("ignores a question a layout duplicates, keeping its first place", () => {
    expect(questionPositions(doc, ["q_blank", "q_full_name"]).get("q_full_name")).toBe(1);
  });
});

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
      ["q_coverage_level", "change"],
      ["q_long_list", "change"],
      ["q_optional_cover", "groupExit"],
      ["q_full_name", "blur"],
      ["q_extra_detail", "blur"],
      ["q_accident_count", "blur"],
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

function expandedDoc(nodeType: string, children: unknown[]): A2UIStepDocument {
  return {
    stepId: "stp_fleet",
    root: {
      type: "Form",
      children: [
        {
          type: "RepeatGroup",
          props: { groupId: "grp_vehicles" },
          children: [
            { type: nodeType, props: { groupId: "grp_vehicles", label: "Vehicle 1" }, children },
          ],
        },
      ],
    },
  } as unknown as A2UIStepDocument;
}

describe("instanceLabels over both presentations (tasks 073 and 077)", () => {
  it("names a field inside a stacked instance card", () => {
    const labels = instanceLabels(
      expandedDoc("RepeatInstance", [
        { type: "TextField", props: { name: "ins_7k2/q_plate", label: "Registration plate" } },
      ]),
    );
    expect(labels.get("ins_7k2/q_plate")).toBe("Vehicle 1");
  });

  it("names a field inside a table ROW, through the cell between them", () => {
    const labels = instanceLabels(
      expandedDoc("RepeatRow", [
        {
          type: "RepeatCell",
          props: { questionId: "q_plate" },
          children: [
            { type: "TextField", props: { name: "ins_7k2/q_plate", label: "Vehicle 1, plate" } },
          ],
        },
      ]),
    );
    expect(labels.get("ins_7k2/q_plate")).toBe("Vehicle 1");
  });

  it("names nothing on a step with no repeating group, for one walk", () => {
    expect(instanceLabels(stepDoc).size).toBe(0);
    expect(instanceLabels(null).size).toBe(0);
  });
});
