import { describe, expect, it } from "vitest";

import { structuralDiff } from "./reads.js";

const VERSION_ONE = {
  formId: "frm_clinic",
  defaultLocale: "en",
  title: { en: "Clinic sign-up" },
  steps: [{ stepId: "stp_about", items: [{ questionId: "q_name", version: 1 }] }],
  rules: [{ ruleId: "rul_a" }],
};

describe("the structural diff behind diff_form_versions", () => {
  it("reports a form with no working draft as missing, not as an emptied one", () => {
    const diff = structuralDiff({
      from: "1",
      to: "draft",
      before: VERSION_ONE,
      after: undefined,
    });

    expect(diff.outcome).toBe("unavailable");
    expect(diff.toFound).toBe(false);
    expect(diff.fromFound).toBe(true);
    expect(diff.questionsRemoved).toBeNull();
    expect(diff.stepsRemoved).toBeNull();
    expect(diff.identical).toBeNull();
    expect(diff.ruleCountTo).toBeNull();
    expect(diff.ruleCountFrom).toBe(1);
  });

  it("says the same of a version that was never published", () => {
    const diff = structuralDiff({ from: "9", to: "1", before: undefined, after: VERSION_ONE });

    expect(diff.outcome).toBe("unavailable");
    expect(diff.fromFound).toBe(false);
    expect(diff.questionsAdded).toBeNull();
    expect(diff.ruleCountFrom).toBeNull();
    expect(diff.ruleCountTo).toBe(1);
  });

  it("tells a draft that really is empty apart from one that is not there", () => {
    const diff = structuralDiff({
      from: "1",
      to: "draft",
      before: VERSION_ONE,
      after: { formId: "frm_clinic", defaultLocale: "en", title: { en: "Clinic sign-up" } },
    });

    expect(diff.outcome).toBe("compared");
    expect(diff.toFound).toBe(true);
    expect(diff.questionsRemoved).toEqual(["q_name"]);
    expect(diff.stepsRemoved).toEqual(["stp_about"]);
    expect(diff.ruleCountTo).toBe(0);
  });

  it("compares two versions that both exist", () => {
    const repinned = {
      ...VERSION_ONE,
      steps: [
        { stepId: "stp_about", items: [{ questionId: "q_name", version: 2 }] },
        { stepId: "stp_visit", items: [{ questionId: "q_reason", version: 1 }] },
      ],
    };
    const diff = structuralDiff({ from: "1", to: "2", before: VERSION_ONE, after: repinned });

    expect(diff.outcome).toBe("compared");
    expect(diff.identical).toBe(false);
    expect(diff.stepsAdded).toEqual(["stp_visit"]);
    expect(diff.questionsAdded).toEqual(["q_reason"]);
    expect(diff.questionsRepinned).toEqual([{ questionId: "q_name", from: 1, to: 2 }]);
  });

  it("calls two identical sides identical", () => {
    const diff = structuralDiff({
      from: "1",
      to: "draft",
      before: VERSION_ONE,
      after: { ...VERSION_ONE },
    });

    expect(diff.identical).toBe(true);
    expect(diff.outcome).toBe("compared");
  });
});
