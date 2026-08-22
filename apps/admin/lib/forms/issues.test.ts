import { describe, expect, it } from "vitest";

import { stepIssueCounts } from "./issues.ts";
import type { DraftForm, FormIssue } from "./types.ts";

/**
 * The rail's per-step badge, checked against the count it is not allowed to contradict
 * (issue 561).
 *
 * `plan/admin-ux-audit.md` §5.6 makes `components/forms/validation-panel.tsx` the single
 * authoritative issue count, and §1 names the defect that follows from ignoring that: the
 * POC's own step screen collapses two sections whose digests count overlapping facts
 * ("Rules . 3 rules . 1 issue" beside "Validation . saved 14:02, 2 issues"), and no reader
 * can tell whether that is three issues or two. Two independent counts of overlapping sets
 * is worse than one count and a click.
 *
 * The rail carries a number per step, so the invariant it has to satisfy is arithmetic:
 * over one verdict, the badges partition a SUBSET of the issues the panel counts. Every
 * issue is counted at most once across all steps, and no issue is counted that the panel
 * would not have listed. That is what makes "4 issues" in the panel and a "2 issues" badge
 * a decomposition rather than a contradiction, and it is checked here rather than inferred
 * from the shape of the code.
 *
 * `stepIssueCounts` is also the reason the rail can be wired on seven screens without a
 * second source of truth: the counts come from the API's verdict handed to it (R2 - this
 * app never decides whether a draft is legal), and every screen's rail is fed by the one
 * loader in `lib/server/form-rail.ts`.
 */

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

/** The total a step's badges may never exceed: what the panel would list. */
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
    // The property that keeps the badges a decomposition rather than a second opinion: an
    // issue naming both a step and a question pinned in a different step still lands once.
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
    // A rule belongs to the form rather than to any one step. Spreading a `RULE_CYCLE`
    // over the steps it happens to mention would make the rail's numbers exceed the
    // panel's, which is the arithmetic a reader cannot check.
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
    // `DANGLING_QUESTION_REF` names a question that is by definition pinned nowhere, and
    // the panel renders it as plain text for the same reason: there is no step it belongs
    // to, so inventing one for the badge would put a number on an innocent step.
    const issues: readonly FormIssue[] = [
      { code: "DANGLING_QUESTION_REF", message: "x", path: { question: "q_gone" } },
      { code: "LOCALE_INCOMPLETE", message: "x", path: { locale: "fr" } },
      { code: "SOMETHING_NEW", message: "x" },
    ];
    expect(railTotal(stepIssueCounts(issues, DRAFT))).toBe(0);
  });

  it("hands back an empty map for a clean verdict rather than zeroes", () => {
    // A step with no issues carries no badge at all; a zero rendered as a tag would be
    // decoration where the contract asks for a count.
    expect(stepIssueCounts([], DRAFT).size).toBe(0);
  });
});
