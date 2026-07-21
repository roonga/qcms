import { describe, expect, it } from "vitest";

import type { A2UIStepDocument } from "@qcms/ui";

import { documentForVisible } from "./visible";

/**
 * The portal renders only the questions the API's flow projection marks visible,
 * so a conditional follow-up appears / disappears (wireframe branch states). The
 * insurance step: q_smoker always visible; q_cigs_daily visible only after "Yes".
 */
const stepDoc = {
  stepId: "stp_health",
  root: {
    type: "Form",
    children: [
      {
        type: "Flex",
        props: { direction: "column" },
        children: [
          { type: "Text", props: { as: "h1" }, children: "Life insurance sign-up" },
          {
            type: "RadioGroup",
            props: { name: "q_smoker", label: "Do you currently smoke?" },
            children: [{ type: "Radio", props: { value: "true", label: "Yes" } }],
          },
          { type: "NumberField", props: { name: "q_cigs_daily", label: "How many?" } },
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
    const pruned = documentForVisible(stepDoc, ["q_smoker"]);
    expect(serialize(pruned)).toContain("q_smoker");
    expect(serialize(pruned)).not.toContain("q_cigs_daily");
  });

  it("keeps a follow-up once it becomes visible (branch inserted)", () => {
    const pruned = documentForVisible(stepDoc, ["q_smoker", "q_cigs_daily"]);
    expect(serialize(pruned)).toContain("q_smoker");
    expect(serialize(pruned)).toContain("q_cigs_daily");
  });

  it("keeps layout and text nodes (no name) regardless of the visible set", () => {
    const pruned = documentForVisible(stepDoc, []);
    const text = serialize(pruned);
    expect(text).toContain("Life insurance sign-up");
    expect(text).not.toContain("q_smoker");
  });

  it("does not mutate the input document", () => {
    const before = serialize(stepDoc);
    documentForVisible(stepDoc, ["q_smoker"]);
    expect(serialize(stepDoc)).toBe(before);
  });
});
