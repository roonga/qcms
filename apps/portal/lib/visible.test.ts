import { describe, expect, it } from "vitest";

import type { A2UIStepDocument } from "@qcms/ui";

import { documentForVisible } from "./visible";

/**
 * The portal renders only the questions the API's flow projection marks visible,
 * so a conditional follow-up appears / disappears (wireframe branch states). The
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
