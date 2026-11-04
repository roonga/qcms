import { describe, expect, it } from "vitest";

import { stepIssueCounts, anchorIsOnRulesScreen, stepOwningAnchor } from "./issues.ts";
import type { DraftForm, FormIssue } from "./types.ts";

const DRAFT: DraftForm = {
  formId: "frm_life",
  defaultLocale: "en",
  title: { en: "Life cover" },
  steps: [
    {
      stepId: "stp_about",
      title: { en: "About you" },
      items: [{ questionId: "q_age", version: 1 }],
    },
    {
      stepId: "stp_health",
      title: { en: "Health" },
      items: [
        { questionId: "q_smoker", version: 1 },
        { questionId: "q_bmi", version: 2 },
      ],
    },
  ],
  rules: [{ ruleId: "rul_one", when: { op: "answered", questionId: "q_age" }, show: ["q_smoker"] }],
};

function panelCount(issues: readonly FormIssue[]): number {
  return issues.length;
}

function railTotal(counts: ReadonlyMap<string, number>): number {
  return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

describe("attributing issues to steps for the rail's badge", () => {
  it("counts an issue that names a step, and an issue that names a question inside one", () => {
    const issues: readonly FormIssue[] = [
      { code: "DUPLICATE_STEP_ID", message: "x", path: { step: "stp_about" } },
      { code: "DEPRECATED_PIN", message: "x", path: { question: "q_smoker", version: 1 } },
      { code: "UNPUBLISHED_QUESTION_PIN", message: "x", path: { question: "q_bmi", version: 2 } },
    ];
    const counts = stepIssueCounts(issues, DRAFT);
    expect(counts.get("stp_about")).toBe(1);
    expect(counts.get("stp_health")).toBe(2);
    expect(railTotal(counts)).toBe(panelCount(issues));
  });

  it("never counts one issue against two steps", () => {
    const issues: readonly FormIssue[] = [
      {
        code: "DANGLING_STEP_REF",
        message: "x",
        path: { step: "stp_about", question: "q_smoker" },
      },
    ];
    const counts = stepIssueCounts(issues, DRAFT);
    expect(railTotal(counts)).toBe(1);
    expect(counts.get("stp_about")).toBe(1);
    expect(counts.has("stp_health")).toBe(false);
  });

  it("leaves a rule's issues to the panel, so the badges never add up to more than it", () => {
    const issues: readonly FormIssue[] = [
      { code: "RULE_BACKWARD_TARGET", message: "x", path: { rule: "rul_one", step: "stp_about" } },
      { code: "RULE_CYCLE", message: "x", path: { rules: ["rul_one"], step: "stp_health" } },
      { code: "DEPRECATED_PIN", message: "x", path: { question: "q_age", version: 1 } },
    ];
    const counts = stepIssueCounts(issues, DRAFT);
    expect(railTotal(counts)).toBe(1);
    expect(railTotal(counts)).toBeLessThanOrEqual(panelCount(issues));
  });

  it("counts nothing for an issue that names nothing the draft holds", () => {
    const issues: readonly FormIssue[] = [
      { code: "DANGLING_QUESTION_REF", message: "x", path: { question: "q_gone" } },
      { code: "LOCALE_INCOMPLETE", message: "x", path: { locale: "fr" } },
      { code: "SOMETHING_NEW", message: "x" },
    ];
    expect(railTotal(stepIssueCounts(issues, DRAFT))).toBe(0);
  });

  it("hands back an empty map for a clean verdict rather than zeroes", () => {
    expect(stepIssueCounts([], DRAFT).size).toBe(0);
  });
});

describe("which screen an issue's anchor is on", () => {
  it("puts a rule's issue on the rules screen", () => {
    const issue = { code: "RULE_BACKWARD_TARGET", message: "x", path: { rule: "rul_one" } };
    expect(anchorIsOnRulesScreen(issue, DRAFT)).toBe(true);
    expect(stepOwningAnchor(issue, DRAFT), "and not on a step's").toBeUndefined();
  });

  it("puts a cycle on the rules screen too, which names its rules as a list", () => {
    const cycle = { code: "RULE_CYCLE", message: "x", path: { rules: ["rul_one"] } };
    expect(anchorIsOnRulesScreen(cycle, DRAFT)).toBe(true);
  });

  it("puts a pin's issue on the step that holds it, not on the rules screen", () => {
    const issue = { code: "DEPRECATED_PIN", message: "x", path: { question: "q_smoker" } };
    expect(anchorIsOnRulesScreen(issue, DRAFT)).toBe(false);
    expect(stepOwningAnchor(issue, DRAFT)).toBe("stp_health");
  });

  it("claims nothing for a rule the draft no longer has", () => {
    const gone = { code: "RULE_CYCLE", message: "x", path: { rule: "rul_gone" } };
    expect(anchorIsOnRulesScreen(gone, DRAFT)).toBe(false);
  });

  it("claims nothing for an issue with no path at all", () => {
    expect(anchorIsOnRulesScreen({ code: "X", message: "x" }, DRAFT)).toBe(false);
  });
});
