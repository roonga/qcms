import { describe, expect, it } from "vitest";

import {
  layoutFindings,
  layoutReportFact,
  selectionFact,
  type MeasuredQuestion,
} from "./builder-facts.ts";

const SELECTION = {
  formId: "frm_contact",
  stepId: "stp_one",
  questionId: "q_first_name",
  device: "phone",
  viewport: { width: 390, height: 844 },
} as const;

const REPORT = {
  formId: "frm_contact",
  stepId: "stp_one",
  device: "tablet",
  viewport: { width: 768, height: 1024 },
  zoomPercent: 100,
  colorScheme: "dark",
  highContrast: false,
  pageHeight: 1800,
  findings: [],
} as const;

function question(questionId: string, overrides: Partial<MeasuredQuestion> = {}): MeasuredQuestion {
  return {
    questionId,
    box: { left: 16, top: 0, right: 300, bottom: 80 },
    overflows: false,
    clipped: false,
    labelTruncated: false,
    smallTarget: false,
    ...overrides,
  };
}

describe("the preview selection fact", () => {
  it("carries the question's id and nothing it does not name", () => {
    expect(selectionFact(SELECTION)).toEqual({ fact: "preview-selection", ...SELECTION });
    expect(selectionFact({ ...SELECTION, instanceId: "ins_p2" })).toEqual({
      fact: "preview-selection",
      ...SELECTION,
      instanceId: "ins_p2",
    });
  });

  it("is withheld when any id is not one", () => {
    expect(selectionFact({ ...SELECTION, questionId: "What is your name?" })).toBeUndefined();
    expect(selectionFact({ ...SELECTION, formId: "contact" })).toBeUndefined();
    expect(selectionFact({ ...SELECTION, instanceId: "first" })).toBeUndefined();
    expect(selectionFact({ ...SELECTION, questionId: `q_${"a".repeat(200)}` })).toBeUndefined();
  });

  it("bounds the viewport", () => {
    expect(
      selectionFact({ ...SELECTION, viewport: { width: 90.4, height: 9_000 } })?.viewport,
    ).toEqual({ width: 200, height: 4_000 });
  });
});

describe("the layout report fact", () => {
  it("derives the orientation and bounds every number", () => {
    const fact = layoutReportFact({
      ...REPORT,
      viewport: { width: 896, height: 414 },
      zoomPercent: 12,
      pageHeight: 250_000,
    });
    expect(fact).toMatchObject({
      fact: "layout-report",
      orientation: "landscape",
      zoomPercent: 25,
      pageHeight: 100_000,
    });
  });

  it("drops a finding that names no question id and keeps at most fifty", () => {
    const findings = [
      { questionId: "Label text", issue: "clipped" as const },
      ...Array.from({ length: 60 }, (_unused, index) => ({
        questionId: `q_${String(index)}`,
        issue: "overlap" as const,
      })),
    ];
    const fact = layoutReportFact({ ...REPORT, findings });
    expect(fact?.findings).toHaveLength(50);
    expect(fact?.findings[0]?.questionId).toBe("q_0");
  });
});

describe("the layout findings", () => {
  it("reports nothing for a clean step", () => {
    expect(
      layoutFindings(
        [
          question("q_a"),
          question("q_b", { box: { left: 16, top: 100, right: 300, bottom: 180 } }),
        ],
        390,
      ),
    ).toEqual([]);
  });

  it("names each issue once per question, in document order", () => {
    const findings = layoutFindings(
      [
        question("q_a", { overflows: true, labelTruncated: true, smallTarget: true }),
        question("q_b", { clipped: true, box: { left: 16, top: 40, right: 500, bottom: 120 } }),
      ],
      390,
    );
    expect(findings).toEqual([
      { questionId: "q_a", issue: "overflow-horizontal" },
      { questionId: "q_a", issue: "truncated-label" },
      { questionId: "q_a", issue: "target-too-small" },
      { questionId: "q_b", issue: "clipped" },
      { questionId: "q_b", issue: "off-screen" },
      { questionId: "q_b", issue: "overlap" },
    ]);
  });

  it("forgives a sub-pixel touch between neighbours", () => {
    expect(
      layoutFindings(
        [
          question("q_a"),
          question("q_b", { box: { left: 16, top: 79.5, right: 300, bottom: 160 } }),
        ],
        390,
      ),
    ).toEqual([]);
  });
});
